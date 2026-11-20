import type { ProjectSnapshot } from '../shared/types';

export type SearchKind = 'card' | 'note' | 'workflow';
export interface ProjectSearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  context: string;
  snippet: string;
  updatedAt: string;
}
interface IndexedResult extends ProjectSearchResult { searchable: string }

function normalize(value: string): string {
  return value.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[-_]/g, '');
}

function snippet(value: string, firstTerm?: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const match = firstTerm ? normalize(clean).indexOf(firstTerm) : -1;
  const start = match > 45 ? Math.max(0, match - 38) : 0;
  return `${start ? '…' : ''}${clean.slice(start, start + 130)}${start + 130 < clean.length ? '…' : ''}`;
}

export function projectSearchResults(snapshot: ProjectSnapshot, query: string, limit = 30): ProjectSearchResult[] {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const all: IndexedResult[] = [
    ...snapshot.cards.map((card) => ({
      kind: 'card' as const, id: card.id, title: card.title,
      context: `Karte · ${snapshot.columns.find((column) => column.id === card.columnId)?.name ?? 'Unbekannte Spalte'}`,
      snippet: snippet(card.description, terms[0]), searchable: card.description, updatedAt: card.updatedAt,
    })),
    ...snapshot.notes.map((note) => ({
      kind: 'note' as const, id: note.id, title: note.title,
      context: `Memory${note.tags.length ? ` · ${note.tags.slice(0, 3).join(', ')}` : ''}`,
      snippet: snippet(note.body, terms[0]), searchable: `${note.body} ${note.tags.join(' ')}`, updatedAt: note.updatedAt,
    })),
    ...snapshot.workflows.map((workflow) => ({
      kind: 'workflow' as const, id: workflow.id, title: workflow.name,
      context: `Workflow · ${workflow.state === 'running' ? 'Läuft' : workflow.state === 'paused' ? 'Pausiert' : workflow.state === 'done' ? 'Fertig' : 'Entwurf'}`,
      snippet: `${workflow.cardIds.length} Karten · ${workflow.steps.length} Schritte`,
      searchable: `${workflow.cardIds.map((id) => snapshot.cards.find((card) => card.id === id)?.title ?? '').join(' ')} ${workflow.steps.map((step) => snapshot.columns.find((column) => column.id === step.columnId)?.name ?? '').join(' ')}`,
      updatedAt: workflow.updatedAt,
    })),
  ];
  if (terms.length === 0) return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map(({ searchable: _unused, ...item }) => item);
  return all.map((item) => {
    const title = normalize(item.title);
    const context = normalize(item.context);
    const body = normalize(item.searchable);
    if (!terms.every((term) => title.includes(term) || context.includes(term) || body.includes(term))) return null;
    const score = terms.reduce((sum, term) => sum + (title.startsWith(term) ? 100 : title.includes(term) ? 70 : context.includes(term) ? 25 : 10), 0);
    return { item, score };
  }).filter((value): value is { item: IndexedResult; score: number } => value !== null)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
    .slice(0, limit).map(({ item: { searchable: _unused, ...item } }) => item);
}
