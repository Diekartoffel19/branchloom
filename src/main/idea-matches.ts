import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { IdeaMatchCandidate, IdeaMatchKind, IdeaMatchLink, IdeaMatchPreview } from '../shared/idea-matches';
import { listIdeas } from './ideas';
import type { StudioStore } from './store';

interface SourceRow { id: string; title: string; body: string; updated_at: string; archived_at?: string | null; trello_id: string | null; card_id?: string | null }
interface LinkRow { source_kind: IdeaMatchKind; source_id: string; linked_at: string }
const STOP = new Set('a an and auf das der des die ein eine einer einem fur for im in ist mit of oder the to und von zu zum zur with'.split(' '));

export function installIdeaMatches(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS idea_match_links (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('idea', 'card')),
    source_id TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (project_id, source_kind, source_id)
  );
  CREATE INDEX IF NOT EXISTS idea_match_links_idea ON idea_match_links(idea_id, linked_at);`);
}

const normalize = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (value: string): Set<string> => new Set(normalize(value).split(/\s+/).filter((word) => word.length >= 3 && !STOP.has(word)));

/** Deliberately conservative lexical title match. It never asks a model or sends project data away. */
export function titleMatch(a: string, b: string): { score: number; reason: string } | null {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return null;
  if (left === right) return { score: 100, reason: 'Gleicher Titel' };
  const leftWords = words(a);
  const rightWords = words(b);
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  if (shared < 2 || !union || shared / union < 0.45) return null;
  return { score: Math.round(100 * shared / union), reason: `${shared} gemeinsame Titelbegriffe` };
}

function signature(target: SourceRow, source: SourceRow, kind: IdeaMatchKind): string {
  return createHash('sha256').update(JSON.stringify([target.id, target.title, target.body, target.updated_at,
    kind, source.id, source.title, source.body, source.updated_at, source.archived_at ?? null])).digest('hex');
}

function targetIdea(store: StudioStore, projectId: string, ideaId: string): SourceRow {
  store.project(projectId);
  const row = store.db.prepare('SELECT id, title, body, updated_at FROM ideas WHERE project_id = ? AND id = ?').get(projectId, ideaId) as SourceRow | undefined;
  if (!row) throw new Error('Idee in diesem Projekt nicht gefunden.');
  return row;
}

function sources(store: StudioStore, projectId: string): { ideas: SourceRow[]; cards: SourceRow[]; limited: boolean } {
  const ideas = store.db.prepare(`SELECT i.id, i.title, i.body, i.updated_at, i.card_id, t.source_id AS trello_id
    FROM ideas i LEFT JOIN trello_idea_imports t ON t.project_id = i.project_id AND t.idea_id = i.id
    WHERE i.project_id = ? ORDER BY i.updated_at DESC, i.id LIMIT 2001`).all(projectId) as SourceRow[];
  const cards = store.db.prepare(`SELECT c.id, c.title, c.description AS body, c.updated_at, c.archived_at, t.source_id AS trello_id
    FROM cards c LEFT JOIN trello_imports t ON t.project_id = c.project_id AND t.card_id = c.id
    WHERE c.project_id = ? ORDER BY c.updated_at DESC, c.id LIMIT 2001`).all(projectId) as SourceRow[];
  return { ideas: ideas.slice(0, 2000), cards: cards.slice(0, 2000), limited: ideas.length > 2000 || cards.length > 2000 };
}

function origin(kind: IdeaMatchKind, row: SourceRow): string {
  if (kind === 'idea') return `${row.trello_id ? 'Trello → Ideenraum' : 'Ideenraum'}${row.card_id ? ' · Board-Karte vorhanden' : ''}`;
  return row.trello_id ? 'Trello → Board' : 'Board';
}

export function previewIdeaMatches(store: StudioStore, input: { projectId: string; ideaId: string }): IdeaMatchPreview {
  const target = targetIdea(store, input.projectId, input.ideaId);
  const idea = listIdeas(store, input.projectId).find((item) => item.id === input.ideaId)!;
  if (idea.mergedIntoIdeaId) return { idea, candidates: [], links: [], limited: false };
  const { ideas, cards, limited } = sources(store, input.projectId);
  const links = store.db.prepare('SELECT source_kind, source_id, linked_at FROM idea_match_links WHERE project_id = ? AND idea_id = ? ORDER BY linked_at DESC')
    .all(input.projectId, input.ideaId) as LinkRow[];
  const assignments = store.db.prepare('SELECT idea_id, source_kind, source_id FROM idea_match_links WHERE project_id = ?').all(input.projectId) as Array<LinkRow & { idea_id: string }>;
  const linkedElsewhere = new Set(assignments
    .map((row) => `${row.source_kind}:${row.source_id}`));
  const canonicalIds = new Set(assignments.map((row) => row.idea_id));
  const connectedCards = new Set(ideas.map((row) => row.card_id).filter(Boolean));
  const all = [
    ...ideas.filter((row) => row.id !== input.ideaId).map((row) => ({ kind: 'idea' as const, row })),
    ...cards.filter((row) => row.id !== idea.cardId && !connectedCards.has(row.id)).map((row) => ({ kind: 'card' as const, row })),
  ];
  const candidates: Array<IdeaMatchCandidate & { score: number }> = [];
  for (const { kind, row } of all) {
    if (linkedElsewhere.has(`${kind}:${row.id}`)) continue;
    // Keep groups flat: a canonical idea with existing links cannot become somebody else's duplicate.
    if (kind === 'idea' && canonicalIds.has(row.id)) continue;
    const matched = titleMatch(target.title, row.title);
    if (!matched) continue;
    candidates.push({ kind, id: row.id, title: row.title, body: row.body, origin: origin(kind, row), archived: Boolean(row.archived_at), reason: matched.reason,
      signature: signature(target, row, kind), score: matched.score });
  }
  candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));
  const resolvedLinks: IdeaMatchLink[] = links.map((link) => {
    const row = (link.source_kind === 'idea' ? ideas : cards).find((item) => item.id === link.source_id);
    return { kind: link.source_kind, id: link.source_id, title: row?.title ?? 'Quelle nicht mehr vorhanden',
      origin: row ? origin(link.source_kind, row) : 'Quelle fehlt', linkedAt: link.linked_at, available: Boolean(row) };
  });
  return { idea, candidates: candidates.slice(0, 12).map(({ score: _score, ...candidate }) => candidate), links: resolvedLinks, limited };
}

export function linkIdeaMatch(store: StudioStore, input: { projectId: string; ideaId: string; kind: IdeaMatchKind; sourceId: string; expectedSignature: string }): IdeaMatchPreview {
  return store.db.transaction(() => {
    if (!['idea', 'card'].includes(input.kind) || typeof input.sourceId !== 'string' || !input.sourceId) throw new Error('Ungültige Vergleichsquelle.');
    const preview = previewIdeaMatches(store, input);
    const candidate = preview.candidates.find((item) => item.kind === input.kind && item.id === input.sourceId);
    if (!candidate || candidate.signature !== input.expectedSignature) throw new Error('Die Idee oder Quelle hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
    if (store.db.prepare('SELECT 1 FROM idea_match_links WHERE project_id = ? AND source_kind = ? AND source_id = ?').get(input.projectId, input.kind, input.sourceId)) throw new Error('Diese Quelle wurde bereits verknüpft.');
    if (store.db.prepare("SELECT 1 FROM idea_match_links WHERE project_id = ? AND source_kind = 'idea' AND source_id = ?").get(input.projectId, input.ideaId)) throw new Error('Diese Idee ist bereits einer anderen Idee zugeordnet.');
    store.db.prepare('INSERT INTO idea_match_links VALUES (?, ?, ?, ?, ?)').run(input.projectId, input.ideaId, input.kind, input.sourceId, new Date().toISOString());
    return previewIdeaMatches(store, input);
  })();
}

export function unlinkIdeaMatch(store: StudioStore, input: { projectId: string; ideaId: string; kind: IdeaMatchKind; sourceId: string }): IdeaMatchPreview {
  targetIdea(store, input.projectId, input.ideaId);
  if (!['idea', 'card'].includes(input.kind) || typeof input.sourceId !== 'string' || !input.sourceId) throw new Error('Ungültige Vergleichsquelle.');
  const result = store.db.prepare('DELETE FROM idea_match_links WHERE project_id = ? AND idea_id = ? AND source_kind = ? AND source_id = ?')
    .run(input.projectId, input.ideaId, input.kind, input.sourceId);
  if (!result.changes) throw new Error('Verknüpfung auf dieser Idee nicht gefunden.');
  return previewIdeaMatches(store, input);
}
