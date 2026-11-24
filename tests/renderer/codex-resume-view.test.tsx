import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../../src/shared/types';
import { CardPanel } from '../../src/renderer/components/CardPanel';

const stamp = '2026-01-01T00:00:00.000Z';
const card = { id: 'card', projectId: 'project', columnId: 'todo', title: 'Synthetic task', description: '', position: 0, priority: 'none' as const, labels: [], createdAt: stamp, updatedAt: stamp, archivedAt: null };
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetic', path: 'C:\\synthetic', createdAt: stamp },
  columns: [{ id: 'todo', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null }],
  cards: [card],
  agents: [{ id: 'codex', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [{ id: 'previous', projectId: 'project', cardId: 'card', agentId: 'codex', state: 'failed', startedAt: stamp, endedAt: stamp, exitCode: 1, output: 'Interrupted', worktreePath: null }],
  workflows: [], notes: [],
  queue: { projectId: 'project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

describe('Codex resume card control', () => {
  it('offers a deliberate picker on a finished Codex card and explains that prompts are not replayed', () => {
    const html = renderToStaticMarkup(createElement(CardPanel, { card, snapshot, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(html).toContain('Codex-Gespräch auswählen');
    expect(html).toContain('der alte Auftrag wird nicht erneut gesendet');
    expect(html).toContain('Terminal wird geladen');
  });

  it('does not offer resume for an archived card', () => {
    const archived = { ...card, archivedAt: stamp };
    const html = renderToStaticMarkup(createElement(CardPanel, { card: archived, snapshot: { ...snapshot, cards: [archived] }, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(html).not.toContain('Codex-Gespräch auswählen');
  });
});
