import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardView } from '../../src/renderer/components/BoardView';
import type { ProjectSnapshot } from '../../src/shared/types';

const stamp = '2026-01-01T00:00:00Z';
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Synthetic', path: 'C:\synthetic', createdAt: stamp },
  columns: [
    { id: 'second', projectId: 'p', name: 'Später', position: 1, agentId: null, model: null, effort: null, autoStart: false },
    { id: 'first', projectId: 'p', name: 'Zuerst', position: 0, agentId: null, model: null, effort: null, autoStart: false },
  ],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

describe('board column order controls', () => {
  it('renders sorted columns with an unavailable edge control', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html.indexOf('Spalte Zuerst')).toBeLessThan(html.indexOf('Spalte Später'));
    expect(html).toContain('aria-label="Spalte Zuerst nach links verschieben"');
    expect(html).toContain('aria-label="Spalte Später nach rechts verschieben"');
    expect(html).toContain('title="Erste Spalte"');
    expect(html).toContain('title="Letzte Spalte"');
  });
});
