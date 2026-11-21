import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) try { store.close(); } catch { /* already closed */ }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-column-rename-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  return { store, project, columns, dbPath };
}

describe('column rename', () => {
  it('persists a new name without changing card or workflow links', () => {
    const { store, project, columns, dbPath } = fixture();
    const card = store.createCard({ projectId: project.id, columnId: columns[1]!.id, title: 'Synthetic card' });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [card.id], steps: [{ id: 'step', columnId: columns[1]!.id, agentId: null, requireApproval: true }] });
    expect(store.updateColumn({ id: columns[1]!.id, name: '  Vorbereitung  ' }).name).toBe('Vorbereitung');
    expect(store.card(card.id).columnId).toBe(columns[1]!.id);
    expect(store.workflow(flow.id).steps[0]?.columnId).toBe(columns[1]!.id);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(dbPath);
    stores.push(reopened);
    expect(reopened.column(columns[1]!.id).name).toBe('Vorbereitung');
  });

  it('rejects duplicate names and protects To Do while a queue is active', () => {
    const { store, project, columns } = fixture();
    expect(() => store.createColumn({ projectId: project.id, name: 'to do' })).toThrow('existiert');
    expect(() => store.updateColumn({ id: columns[1]!.id, name: columns[2]!.name.toUpperCase() })).toThrow('existiert');
    store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: null, activeWorkflowId: null, pauseReason: 'test' });
    expect(() => store.updateColumn({ id: columns[0]!.id, name: 'Inbox' })).toThrow('Warteschlange');
    expect(store.column(columns[0]!.id).name).toBe('To Do');
    store.saveProjectQueue({ projectId: project.id, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(store.updateColumn({ id: columns[0]!.id, name: 'Inbox' }).name).toBe('Inbox');
  });
});
