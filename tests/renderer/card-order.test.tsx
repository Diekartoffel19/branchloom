import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, ProjectSnapshot } from '../../src/shared/types';
import { BoardView } from '../../src/renderer/components/BoardView';
import { filterBoardCards } from '../../src/renderer/board-filters';

const stamp = '2026-01-01T00:00:00.000Z';
function card(id: string, position: number, archivedAt: string | null = null): Card {
  return { id, projectId: 'p', columnId: 'todo', title: id, description: '', priority: 'none', labels: [], position, createdAt: stamp, updatedAt: stamp, archivedAt };
}

describe('board card order controls', () => {
  it('renders active cards in saved order with accessible neighboring actions', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Synthetic', path: 'C:\\synthetic', createdAt: stamp },
      columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
      cards: [card('third', 2), card('first', 0), card('archived', 3, stamp), card('second', 1)],
      agents: [], sessions: [], workflows: [], notes: [],
      queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
    };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html.indexOf('board-card-first')).toBeLessThan(html.indexOf('board-card-second'));
    expect(html.indexOf('board-card-second')).toBeLessThan(html.indexOf('board-card-third'));
    expect(html).toContain('„second“ in „To Do“ nach oben setzen, vor „first“');
    expect(html).toContain('„second“ in „To Do“ nach unten setzen, hinter „third“');
    expect(html).toContain('„first“ in „To Do“ nach oben setzen');
    expect(html).not.toContain('„archived“ in „To Do“ nach oben setzen');
    expect(html).toContain('auch wenn Karten ausgefiltert sind');
    expect(filterBoardCards(snapshot.cards, { query: 'second', columnId: 'todo', visibility: 'active' }).map((item) => item.id)).toEqual(['second']);
    expect(snapshot.cards.map((item) => item.position)).toEqual([2, 0, 3, 1]);
  });
});
