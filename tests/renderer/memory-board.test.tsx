import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemoryNote, ProjectSnapshot } from '../../src/shared/types';
import { backlinks, layoutNotes, linkedIdsForBody, noteEdges } from '../../src/renderer/memory-graph';
import { BoardView } from '../../src/renderer/components/BoardView';

function note(id: string, title: string, body = '', links: string[] = []): MemoryNote {
  return { id, projectId: 'p', title, body, links, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
}

describe('memory graph', () => {
  it('combines stored links and wiki links, deduplicates them, and exposes backlinks', () => {
    const notes = [note('a', 'Alpha', 'See [[Beta]] and [[Missing]].', ['b']), note('b', 'Beta'), note('c', 'Gamma', '[[Beta]]')];
    expect(noteEdges(notes)).toEqual([{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }]);
    expect(backlinks(notes, 'b').map((item) => item.id)).toEqual(['a', 'c']);
    expect(linkedIdsForBody('[[Beta]] [[Beta]] [[Unknown]]', notes)).toEqual(['b']);
  });

  it('places a single note in the center and multiple notes within the viewport', () => {
    expect(layoutNotes([note('a', 'Alpha')], 600, 300)[0]).toMatchObject({ x: 300, y: 150 });
    for (const node of layoutNotes([note('a', 'Alpha'), note('b', 'Beta'), note('c', 'Gamma')], 600, 300)) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(600);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(300);
    }
  });
});

describe('board view', () => {
  it('renders real snapshot cards and escapes user supplied markup', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Test', path: 'C:\\test', createdAt: '2026-01-01T00:00:00Z' },
      columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null }],
      cards: [{ id: 'card', projectId: 'p', columnId: 'todo', title: '<script>alert(1)</script>', description: 'Beschreibung', position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
      agents: [], sessions: [], workflows: [], notes: [],
    };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('To Do');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Beschreibung');
  });
});
