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
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-column-delete-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  return { store, project, columns, dbPath };
}

describe('safe column deletion', () => {
  it('deletes only an empty unreferenced column and compacts the order after restart', () => {
    const { store, project, columns, dbPath } = fixture();
    store.deleteColumn(columns[1]!.id);
    expect(store.snapshot(project.id).columns.map((item) => item.position)).toEqual([0, 1, 2, 3, 4]);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(dbPath);
    stores.push(reopened);
    expect(reopened.snapshot(project.id).columns.map((item) => item.id)).toEqual([columns[0]!.id, ...columns.slice(2).map((item) => item.id)]);
  });

  it('protects active or archived cards, workflow steps and the queue To Do column', () => {
    const { store, project, columns } = fixture();
    const active = store.createCard({ projectId: project.id, columnId: columns[1]!.id, title: 'Active' });
    expect(() => store.deleteColumn(columns[1]!.id)).toThrow('Karten');
    store.setCardArchived({ id: active.id, archived: true });
    expect(() => store.deleteColumn(columns[1]!.id)).toThrow('archivierte');
    const routeCard = store.createCard({ projectId: project.id, columnId: columns[3]!.id, title: 'Route card' });
    store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [routeCard.id], steps: [{ id: 'step', columnId: columns[2]!.id, agentId: null, requireApproval: true }] });
    expect(() => store.deleteColumn(columns[2]!.id)).toThrow('Workflow');
    store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: null, activeWorkflowId: null, pauseReason: 'test' });
    expect(() => store.deleteColumn(columns[0]!.id)).toThrow('Warteschlange');
    expect(store.snapshot(project.id).columns).toHaveLength(columns.length);
  });

  it('restores the deleted column if position compaction fails', () => {
    const { store, project, columns } = fixture();
    store.db.exec(`CREATE TRIGGER reject_column_compaction BEFORE UPDATE ON columns WHEN NEW.id = '${columns[2]!.id}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect(() => store.deleteColumn(columns[1]!.id)).toThrow('synthetic failure');
    expect(store.snapshot(project.id).columns.map((item) => item.id)).toEqual(columns.map((item) => item.id));
  });

  it('keeps the final board column', () => {
    const { store, project, columns } = fixture();
    for (const item of columns.slice(1)) store.deleteColumn(item.id);
    expect(() => store.deleteColumn(columns[0]!.id)).toThrow('letzte');
    expect(store.snapshot(project.id).columns.map((item) => item.id)).toEqual([columns[0]!.id]);
  });
});
