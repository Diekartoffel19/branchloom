import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowView } from '../../src/renderer/components/WorkflowView';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';

const at = '2026-11-24T04:00:00.000Z';
const workflow: Workflow = {
  id: 'workflow', projectId: 'project', name: 'Implement then review', cardIds: ['card'],
  steps: [
    { id: 'implement', columnId: 'implement', agentId: 'agent', model: 'implement-model', effort: 'medium', requireApproval: false },
    { id: 'review', columnId: 'review', agentId: 'agent', model: 'review-model', effort: 'high', requireApproval: false },
  ],
  state: 'paused', currentStep: 1, pauseReason: 'review', createdAt: at, updatedAt: at,
};
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetic', path: 'C:\\synthetic', createdAt: at },
  columns: [
    { id: 'todo', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null },
    { id: 'implement', projectId: 'project', name: 'Executing', position: 1, autoStart: false, agentId: null, model: null, effort: null },
    { id: 'review', projectId: 'project', name: 'Code Review', position: 2, autoStart: false, agentId: null, model: null, effort: null },
  ],
  cards: [{ id: 'card', projectId: 'project', columnId: 'review', title: 'Synthetic card', description: '', priority: 'none', labels: [], position: 0, createdAt: at, updatedAt: at, archivedAt: null }],
  agents: [{ id: 'agent', name: 'Local agent', kind: 'antigravity', command: 'agy', args: [], model: null, enabled: true }],
  sessions: [], workflows: [workflow], notes: [],
  queue: { projectId: 'project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};
const mutate = async <T,>(action: () => Promise<T>): Promise<T> => action();

describe('paused multi-step workflow view', () => {
  it('marks the paused step by name and exposes an explicit resume action', () => {
    const html = renderToStaticMarkup(createElement(WorkflowView, { snapshot, mutate }));
    expect(html).toContain('Executing');
    expect(html).toContain('Code Review');
    expect(html).toContain('review-model');
    expect(html).toContain('Hier pausiert');
    expect(html).toContain('Schritt erneut starten');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/class="route-step paused" aria-current="step"/);
    const done = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, workflows: [{ ...workflow, state: 'done', currentStep: 2, pauseReason: undefined }] }, mutate }));
    expect(done).not.toContain('Hier pausiert');
    expect(done).not.toContain('aria-current="step"');
  });

  it('shows a persisted prelaunch error on the paused workflow', () => {
    const failed = { ...workflow, pauseReason: 'user' as const, startError: { message: 'Kein Git-Repository gefunden', at } };
    const html = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, workflows: [failed] }, mutate }));
    expect(html).toContain('Start vor Agentenlauf fehlgeschlagen: Kein Git-Repository gefunden');
    expect(html).toContain('bewussten Fortsetzung');
    expect(html).toContain('Fortsetzen');
  });
});
