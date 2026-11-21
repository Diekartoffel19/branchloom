import type { Card, CardPriority } from '../shared/types';

export type BoardVisibility = 'active' | 'archived' | 'all';
export interface BoardFilters { query: string; columnId: string; visibility: BoardVisibility; priority?: CardPriority | ''; label?: string }

export function filterBoardCards(cards: Card[], filters: BoardFilters): Card[] {
  const query = filters.query.trim().toLocaleLowerCase('de-DE');
  return cards.filter((card) => {
    if (filters.visibility === 'active' && card.archivedAt) return false;
    if (filters.visibility === 'archived' && !card.archivedAt) return false;
    if (filters.columnId && card.columnId !== filters.columnId) return false;
    if (filters.priority && card.priority !== filters.priority) return false;
    if (filters.label && !card.labels.some((label) => label.toLocaleLowerCase('de-DE') === filters.label!.toLocaleLowerCase('de-DE'))) return false;
    return !query || `${card.title} ${card.description} ${card.labels.join(' ')}`.toLocaleLowerCase('de-DE').includes(query);
  });
}
