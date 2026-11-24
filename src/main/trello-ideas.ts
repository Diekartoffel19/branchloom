import type { IdeaCategory } from '../shared/ideas';
import type { TrelloIdeaImportResult, TrelloImportPreview } from '../shared/types';
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
  const cards = preview.cards.map((card) => {
    const reason = card.reason ?? (card.title.length > 160 ? 'Ideentitel darf höchstens 160 Zeichen lang sein.'
      : ideaNotes(card).length > 8_000 ? 'Trello-Notizen plus Quellenangaben überschreiten 8.000 Zeichen.' : null);
    return { ...card, eligible: reason === null, reason };
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
    const insert = store.db.prepare('INSERT INTO trello_idea_imports (project_id, source_id, idea_id, imported_at) VALUES (?, ?, ?, ?)');
    for (const sourceId of input.sourceIds) {
      if (existingCard.get(input.projectId, sourceId) || existingIdea.get(input.projectId, sourceId)) { skippedDuplicateIds.push(sourceId); continue; }
      const card = cards.get(sourceId)!;
      const saved = saveIdea(store, { projectId: input.projectId, title: card.title, body: ideaNotes(card), category: input.category, turns: [] });
      insert.run(input.projectId, sourceId, saved.id, new Date().toISOString());
      created.push(saved);
    }
    return { created, skippedDuplicateIds };
  })();
}
