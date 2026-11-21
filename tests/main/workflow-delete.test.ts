import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-delete-flow-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const [todo, executing] = store.snapshot(project.id).columns;
  const card = store.createCard({ projectId: project.id, columnId: todo!.id, title: 'Free after draft deletion' });
  const flow = store.createWorkflow({ projectId: project.id, name: 'Unused route', cardIds: [card.id], steps: [{ id: 'execute', columnId: executing!.id, agentId: null, requireApproval: false }] });
  return { store, path, project, card, flow };
}

describe('delete unused workflow draft', () => {
  it('frees its cards for the queue without deleting cards, and persists deletion', () => {
    const { store, path, project, card, flow } = fixture();
    expect(store.queueCandidates(project.id)).toEqual([]);
    expect(store.deleteDraftWorkflow(flow.id)).toBe(project.id);
    expect(store.queueCandidates(project.id).map((item) => item.id)).toEqual([card.id]);
    expect(store.card(card.id).title).toBe('Free after draft deletion');
    store.close();
    const reopened = new StudioStore(path);
    expect(reopened.snapshot(project.id).workflows).toEqual([]);
    expect(reopened.queueCandidates(project.id).map((item) => item.id)).toEqual([card.id]);
    reopened.close();
  });

  it('clears an inactive template reference but protects a running queue', () => {
    const { store, project, flow } = fixture();
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: flow.id, activeWorkflowId: null, pauseReason: null });
    expect(() => store.deleteDraftWorkflow(flow.id)).toThrow('Warteschlange verwendet');
    expect(store.workflow(flow.id).id).toBe(flow.id);
    store.saveProjectQueue({ projectId: project.id, state: 'off', templateWorkflowId: flow.id, activeWorkflowId: null, pauseReason: null });
    store.deleteDraftWorkflow(flow.id);
    expect(store.projectQueue(project.id).templateWorkflowId).toBeNull();
    store.close();
  });

  it('keeps paused or started workflow history', () => {
    const { store, flow } = fixture();
    store.setWorkflowState(flow.id, 'paused');
    expect(() => store.deleteDraftWorkflow(flow.id)).toThrow('Nur ungestartete');
    expect(store.workflow(flow.id).state).toBe('paused');
    store.close();
  });
});
