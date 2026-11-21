import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-edit-flow-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const [todo, executing, testing] = store.snapshot(project.id).columns;
  const first = store.createCard({ projectId: project.id, columnId: todo!.id, title: 'First' });
  const second = store.createCard({ projectId: project.id, columnId: todo!.id, title: 'Second' });
  const flow = store.createWorkflow({ projectId: project.id, name: 'Initial', cardIds: [first.id], steps: [{ id: 'old', columnId: executing!.id, agentId: null, requireApproval: false }] });
  return { store, path, root, project, first, second, flow, testing };
}

describe('edit unused workflow draft', () => {
  it('updates name, cards and route atomically and frees the removed card for the queue', () => {
    const { store, path, project, first, second, flow, testing } = fixture();
    const changed = store.updateDraftWorkflow({ id: flow.id, name: 'Revised', cardIds: [second.id], steps: [{ id: 'test', columnId: testing!.id, agentId: null, requireApproval: true }] });
    expect(changed.id).toBe(flow.id);
    expect(changed.name).toBe('Revised');
    expect(changed.cardIds).toEqual([second.id]);
    expect(changed.steps[0]?.columnId).toBe(testing!.id);
    expect(store.queueCandidates(project.id).map((card) => card.id)).toEqual([first.id]);
    store.close();
    const reopened = new StudioStore(path);
    expect(reopened.workflow(flow.id).name).toBe('Revised');
    expect(reopened.queueCandidates(project.id).map((card) => card.id)).toEqual([first.id]);
    reopened.close();
  });

  it('rejects invalid replacement data without changing the existing route', () => {
    const { store, root, flow, second, testing } = fixture();
    try {
      expect(() => store.updateDraftWorkflow({ id: flow.id, name: 'Invalid', cardIds: [second.id], steps: [{ id: 'wrong', columnId: 'missing', agentId: null, requireApproval: false }] })).toThrow();
      expect(store.workflow(flow.id).name).toBe('Initial');
      const otherPath = join(root, 'other');
      mkdirSync(otherPath);
      const other = store.createProject({ name: 'Other', path: otherPath });
      const foreign = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Foreign' });
      expect(() => store.updateDraftWorkflow({ id: flow.id, name: 'Invalid', cardIds: [foreign.id], steps: [{ id: 'test', columnId: testing!.id, agentId: null, requireApproval: false }] })).toThrow('anderen Projekt');
      expect(store.workflow(flow.id).cardIds).toEqual([flow.cardIds[0]]);
    } finally { store.close(); }
  });

  it('protects started history and the selected route of a running queue', () => {
    const { store, project, flow, second, testing } = fixture();
    const edit = () => store.updateDraftWorkflow({ id: flow.id, name: 'Revised', cardIds: [second.id], steps: [{ id: 'test', columnId: testing!.id, agentId: null, requireApproval: false }] });
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: flow.id, activeWorkflowId: null, pauseReason: null });
    expect(edit).toThrow('Warteschlange verwendet');
    store.saveProjectQueue({ projectId: project.id, state: 'off', templateWorkflowId: flow.id, activeWorkflowId: null, pauseReason: null });
    expect(edit().name).toBe('Revised');
    store.setWorkflowState(flow.id, 'paused');
    expect(edit).toThrow('Nur ungestartete');
    store.close();
  });
});
