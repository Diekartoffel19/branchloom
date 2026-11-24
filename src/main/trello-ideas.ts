import { createHash } from 'node:crypto';
import type { IdeaCategory } from '../shared/ideas';
import type { TrelloIdeaComparison, TrelloIdeaImportResult, TrelloImportPreview } from '../shared/types';
import type { ParsedTrelloCard } from './trello-import';
import type { StudioStore } from './store';
import { saveIdea } from './ideas';

function ideaNotes(card: ParsedTrelloCard): string {
  const source = [`Trello-Liste: ${card.listName ?? 'Unbekannt'}`];
  if (card.labels.length) source.push(`Trello-Labels: ${card.labels.join(', ')}`);
  return [card.description.trim(), source.join('\n')].filter(Boolean).join('\n\n');
}

/** Same checked Trello source as the board import, with the tighter idea limits. */
export function previewTrelloIdeas(store: StudioStore, input: { projectId: string; json: string }): TrelloImportPreview {
  const preview = store.previewTrelloImport(input);
  const imported = new Map((store.db.prepare('SELECT source_id, source_title, source_body FROM trello_idea_imports WHERE project_id = ?').all(input.projectId) as Array<{ source_id: string; source_title: string | null; source_body: string | null }>).map((row) => [row.source_id, row]));
  const cards = preview.cards.map((card) => {
    const reason = card.reason ?? (card.title.length > 160 ? 'Ideentitel darf höchstens 160 Zeichen lang sein.'
      : ideaNotes(card).length > 8_000 ? 'Trello-Notizen plus Quellenangaben überschreiten 8.000 Zeichen.' : null);
    const baseline = imported.get(card.sourceId);
    const sourceChange: 'changed' | 'same' | 'unknown' | undefined = !baseline ? undefined : baseline.source_title === null || baseline.source_body === null ? 'unknown'
      : baseline.source_title === card.title && baseline.source_body === ideaNotes(card) ? 'same' : 'changed';
    return { ...card, eligible: reason === null, reason, sourceChange };
  });
  return { ...preview, cards, eligible: cards.filter((card) => card.eligible && !card.importedCardId && !card.importedIdeaId).length };
}

/** Only an explicit second action creates local ideas. No board cards or agent runs. */
export function acceptTrelloIdeas(store: StudioStore, input: {
  projectId: string; json: string; fingerprint: string; sourceIds: string[]; category: IdeaCategory;
}): TrelloIdeaImportResult {
  const preview = previewTrelloIdeas(store, input);
  if (preview.fingerprint !== input.fingerprint) throw new Error('Das Trello-Board hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
  if (!['idea', 'backlog', 'roadmap'].includes(input.category)) throw new Error('Ungültiger Ideenbereich.');
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > preview.cards.length || new Set(input.sourceIds).size !== input.sourceIds.length) {
    throw new Error('Bitte gültige Trello-Karten einmalig auswählen.');
  }
  const cards = new Map(preview.cards.map((card) => [card.sourceId, card]));
  for (const id of input.sourceIds) if (!cards.get(id)?.eligible) throw new Error('Eine gewählte Trello-Karte kann nicht als Idee übernommen werden.');
  return store.db.transaction(() => {
    const created: TrelloIdeaImportResult['created'] = [];
    const skippedDuplicateIds: string[] = [];
    const existingCard = store.db.prepare('SELECT 1 FROM trello_imports WHERE project_id = ? AND source_id = ?');
    const existingIdea = store.db.prepare('SELECT 1 FROM trello_idea_imports WHERE project_id = ? AND source_id = ?');
    const insert = store.db.prepare('INSERT INTO trello_idea_imports (project_id, source_id, idea_id, imported_at, source_title, source_body) VALUES (?, ?, ?, ?, ?, ?)');
    for (const sourceId of input.sourceIds) {
      if (existingCard.get(input.projectId, sourceId) || existingIdea.get(input.projectId, sourceId)) { skippedDuplicateIds.push(sourceId); continue; }
      const card = cards.get(sourceId)!;
      const notes = ideaNotes(card);
      const saved = saveIdea(store, { projectId: input.projectId, title: card.title, body: notes, category: input.category, turns: [] });
      insert.run(input.projectId, sourceId, saved.id, new Date().toISOString(), card.title, notes);
      created.push(saved);
    }
    return { created, skippedDuplicateIds };
  })();
}

/** Compare one imported idea with its current Trello source and the last acknowledged source fields. */
export function compareTrelloIdea(store: StudioStore, input: { projectId: string; json: string; sourceId: string }): TrelloIdeaComparison {
  const preview = previewTrelloIdeas(store, input);
  const source = preview.cards.find((card) => card.sourceId === input.sourceId && card.importedIdeaId);
  if (!source) throw new Error('Diese Trello-Karte ist in diesem Projekt nicht als Idee vorgemerkt.');
  const mapping = store.db.prepare('SELECT idea_id, source_title, source_body FROM trello_idea_imports WHERE project_id = ? AND source_id = ?')
    .get(input.projectId, input.sourceId) as { idea_id: string; source_title: string | null; source_body: string | null } | undefined;
  if (!mapping) throw new Error('Die vorgemerkte Idee ist nicht mehr verfügbar.');
  const local = store.db.prepare('SELECT id, title, body, category, turns_json, card_id, updated_at FROM ideas WHERE project_id = ? AND id = ?')
    .get(input.projectId, mapping.idea_id) as { id: string; title: string; body: string; category: IdeaCategory; turns_json: string; card_id: string | null; updated_at: string } | undefined;
  if (!local) throw new Error('Die vorgemerkte Idee ist nicht mehr verfügbar.');
  const sourceBody = ideaNotes(source);
  return {
    fingerprint: preview.fingerprint, sourceId: input.sourceId, ideaId: local.id, ideaCardId: local.card_id,
    sourceTitle: source.title, sourceBody, localTitle: local.title, localBody: local.body,
    baselineTitle: mapping.source_title, baselineBody: mapping.source_body, localUpdatedAt: local.updated_at,
    localSignature: createHash('sha256').update(JSON.stringify(local)).digest('hex'),
    sourceChange: source.sourceChange ?? 'unknown',
    localChange: mapping.source_title === null || mapping.source_body === null ? 'unknown'
      : mapping.source_title === local.title && mapping.source_body === local.body ? 'same' : 'changed',
    eligible: source.eligible, reason: source.reason,
  };
}

/** Copy only the chosen fields after rechecking board and local revisions. Unchosen source changes stay pending. */
export function applyTrelloIdeaSource(store: StudioStore, input: {
  projectId: string; json: string; sourceId: string; fingerprint: string; localSignature: string;
  copyTitle: boolean; copyBody: boolean;
}): TrelloIdeaComparison {
  if (typeof input.copyTitle !== 'boolean' || typeof input.copyBody !== 'boolean' || !input.copyTitle && !input.copyBody) {
    throw new Error('Wähle mindestens ein Feld zur Übernahme.');
  }
  return store.db.transaction(() => {
    const comparison = compareTrelloIdea(store, input);
    if (comparison.fingerprint !== input.fingerprint) throw new Error('Das Trello-Board hat sich seit dem Vergleich geändert. Bitte erneut prüfen.');
    if (comparison.localSignature !== input.localSignature) throw new Error('Die lokale Idee wurde seit dem Vergleich geändert. Bitte erneut prüfen.');
    if (!comparison.eligible) throw new Error(comparison.reason ?? 'Diese Trello-Karte kann nicht übernommen werden.');
    if (input.copyTitle || input.copyBody) {
      const row = store.db.prepare('SELECT category, turns_json FROM ideas WHERE project_id = ? AND id = ?')
        .get(input.projectId, comparison.ideaId) as { category: IdeaCategory; turns_json: string };
      const title = input.copyTitle ? comparison.sourceTitle : comparison.localTitle;
      const body = input.copyBody ? comparison.sourceBody : comparison.localBody;
      if (title !== comparison.localTitle || body !== comparison.localBody) {
        saveIdea(store, { projectId: input.projectId, id: comparison.ideaId, title, body, category: row.category, turns: JSON.parse(row.turns_json) });
      }
      store.db.prepare('UPDATE trello_idea_imports SET source_title = CASE WHEN ? THEN ? ELSE source_title END, source_body = CASE WHEN ? THEN ? ELSE source_body END WHERE project_id = ? AND source_id = ?')
        .run(input.copyTitle ? 1 : 0, comparison.sourceTitle, input.copyBody ? 1 : 0, comparison.sourceBody, input.projectId, input.sourceId);
    }
    return compareTrelloIdea(store, input);
  })();
}
