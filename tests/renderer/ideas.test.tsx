import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdeasView } from '../../src/renderer/components/IdeasView';
import type { ProjectSnapshot } from '../../src/shared/types';

const snapshot = {
  project: { id: 'synthetic-project', name: 'Synthetic project', path: 'synthetic-path', createdAt: '' },
  columns: [{ id: 'todo', projectId: 'synthetic-project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'synthetic-project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
} satisfies ProjectSnapshot;

describe('ideas room surface', () => {
  it('shows the manual save, disclosed agent context and explicit board conversion', () => {
    const html = renderToStaticMarkup(createElement(IdeasView, { snapshot, mutate: async () => null, onOpenCard: () => undefined }));
    expect(html).toContain('Ideenraum');
    expect(html).toContain('Idee speichern');
    expect(html).toContain('Projekt-README (maximal 12 KB)');
    expect(html).toContain('Antworten ändern nichts automatisch');
    expect(html).toContain('Karte anlegen');
    expect(html).toContain('disabled');
    expect(html).toContain('Roadmap');
  });
});
