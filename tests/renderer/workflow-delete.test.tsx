import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowView } from '../../src/renderer/components/WorkflowView';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';

const time = '2026-01-01T00:00:00.000Z';
const flow: Workflow = { id: 'flow', projectId: 'p', name: 'Unused route', cardIds: ['card'], steps: [{ id: 'step', columnId: 'done', agentId: null, requireApproval: false }], state: 'draft', currentStep: 0, createdAt: time, updatedAt: time };
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Synthetic', path: 'C:\\synthetic', createdAt: time },
  columns: [{ id: 'done', projectId: 'p', name: 'Done', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [{ id: 'card', projectId: 'p', columnId: 'done', title: 'Card', description: '', priority: 'none', labels: [], position: 0, archivedAt: null, createdAt: time, updatedAt: time }],
  agents: [], sessions: [], workflows: [flow], notes: [],
  queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};
const mutate = async <T,>(action: () => Promise<T>): Promise<T> => action();

describe('workflow draft delete control', () => {
  it('offers deletion for a draft and hides it for started history', () => {
    const draft = renderToStaticMarkup(createElement(WorkflowView, { snapshot, mutate }));
    expect(draft).toContain('Entwurf löschen');
    const paused = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, workflows: [{ ...flow, state: 'paused' }] }, mutate }));
    expect(paused).not.toContain('Entwurf löschen');
  });
});
