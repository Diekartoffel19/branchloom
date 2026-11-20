import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, ProjectSnapshot } from '../../src/shared/types';
import { filterBoardCards } from '../../src/renderer/board-filters';
import { BoardView } from '../../src/renderer/components/BoardView';
import { CardPanel } from '../../src/renderer/components/CardPanel';

const stamp = '2026-01-01T00:00:00.000Z';
const cards: Card[] = [
  { id: 'active', projectId: 'p', columnId: 'todo', title: 'Aktive Suche', description: 'Wichtig', position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null },
  { id: 'archived', projectId: 'p', columnId: 'done', title: 'Alte Aufgabe', description: 'Historie behalten', position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: stamp },
];

describe('board filters and archive visibility', () => {
  it('filters by text, column and archive state without removing stored cards', () => {
    expect(filterBoardCards(cards, { query: '', columnId: '', visibility: 'active' }).map((card) => card.id)).toEqual(['active']);
    expect(filterBoardCards(cards, { query: 'historie', columnId: '', visibility: 'all' }).map((card) => card.id)).toEqual(['archived']);
    expect(filterBoardCards(cards, { query: '', columnId: 'done', visibility: 'archived' }).map((card) => card.id)).toEqual(['archived']);
    expect(filterBoardCards(cards, { query: '', columnId: 'todo', visibility: 'archived' })).toEqual([]);
    expect(cards).toHaveLength(2);
  });

  it('renders only active cards on the normal board and exposes archive filter', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Synthetic', path: 'C:\\test', createdAt: stamp },
      columns: [
        { id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null },
        { id: 'done', projectId: 'p', name: 'Done', position: 1, autoStart: false, agentId: null },
      ],
      cards, agents: [], sessions: [], workflows: [], notes: [],
    };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('Aktive Suche');
    expect(html).not.toContain('Alte Aufgabe');
    expect(html).toContain('Archiv (1)');
    expect(html).toContain('Karten suchen');
    expect(html).toContain('Spalte filtern');
    const archived = renderToStaticMarkup(createElement(CardPanel, { card: cards[1]!, snapshot, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(archived).toContain('Wiederherstellen');
    expect(archived).toContain('ARCHIVIERT');
    expect(archived).toContain('disabled=""');
  });
});
