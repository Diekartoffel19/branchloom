import type { Card } from '../shared/types';

export type BoardVisibility = 'active' | 'archived' | 'all';
export interface BoardFilters { query: string; columnId: string; visibility: BoardVisibility }

export function filterBoardCards(cards: Card[], filters: BoardFilters): Card[] {
  const query = filters.query.trim().toLocaleLowerCase('de-DE');
  return cards.filter((card) => {
    if (filters.visibility === 'active' && card.archivedAt) return false;
    if (filters.visibility === 'archived' && !card.archivedAt) return false;
    if (filters.columnId && card.columnId !== filters.columnId) return false;
    return !query || `${card.title} ${card.description}`.toLocaleLowerCase('de-DE').includes(query);
  });
}
