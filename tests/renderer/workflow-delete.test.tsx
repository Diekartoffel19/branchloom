import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { orderedStepColumns, stepAgentId, WorkflowView } from '../../src/renderer/components/WorkflowView';
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
    expect(draft).toContain('Entwurf bearbeiten');
    const paused = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, workflows: [{ ...flow, state: 'paused' }] }, mutate }));
    expect(paused).not.toContain('Entwurf löschen');
    expect(paused).not.toContain('Entwurf bearbeiten');
  });

  it('preserves an existing route order and appends newly selected columns', () => {
    const a = { ...snapshot.columns[0]!, id: 'a', position: 0 };
    const b = { ...snapshot.columns[0]!, id: 'b', position: 1 };
    const c = { ...snapshot.columns[0]!, id: 'c', position: 2 };
    const previous = [{ id: 'second', columnId: b.id, agentId: null, requireApproval: false }, { id: 'first', columnId: a.id, agentId: null, requireApproval: false }];
    expect(orderedStepColumns([a, b, c], ['a', 'b', 'c'], previous).map((column) => column.id)).toEqual(['b', 'a', 'c']);
    expect(orderedStepColumns([a, b, c], ['a', 'c'], previous).map((column) => column.id)).toEqual(['a', 'c']);
    expect(orderedStepColumns([a, b, c], ['a', 'b']).map((column) => column.id)).toEqual(['a', 'b']);
  });

  it('keeps an explicitly manual step even when its column has a default agent', () => {
    const column = { ...snapshot.columns[0]!, agentId: 'default-agent' };
    expect(stepAgentId(column, {})).toBe('default-agent');
    expect(stepAgentId(column, { [column.id]: '' })).toBeNull();
    expect(stepAgentId(column, { [column.id]: 'chosen-agent' })).toBe('chosen-agent');
  });
});
