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
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-column-order-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  return { store, dbPath, project, columns };
}

describe('column order', () => {
  it('swaps adjacent columns, persists the order, and keeps card and workflow references', () => {
    const { store, dbPath, project, columns } = fixture();
    const card = store.createCard({ projectId: project.id, columnId: columns[1]!.id, title: 'Task' });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [card.id], steps: [{ id: 'step', columnId: columns[1]!.id, agentId: null, requireApproval: true }] });
    store.reorderColumn({ id: columns[1]!.id, direction: 'right' });
    expect(store.snapshot(project.id).columns.map((item) => item.id)).toEqual([columns[0]!.id, columns[2]!.id, columns[1]!.id, ...columns.slice(3).map((item) => item.id)]);
    expect(store.card(card.id).columnId).toBe(columns[1]!.id);
    expect(store.workflow(flow.id).steps[0]?.columnId).toBe(columns[1]!.id);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(dbPath);
    stores.push(reopened);
    expect(reopened.snapshot(project.id).columns[2]?.id).toBe(columns[1]!.id);
    reopened.close();
  });

  it('rejects edges and rolls back both positions when the second write fails', () => {
    const { store, columns, project } = fixture();
    expect(() => store.reorderColumn({ id: columns[0]!.id, direction: 'left' })).toThrow('Rand');
    expect(() => store.reorderColumn({ id: columns.at(-1)!.id, direction: 'right' })).toThrow('Rand');
    expect(() => store.reorderColumn({ id: columns[1]!.id, direction: 'up' as 'left' })).toThrow('Spaltenrichtung');
    store.db.exec(`CREATE TRIGGER reject_column_reorder BEFORE UPDATE ON columns WHEN NEW.id = '${columns[2]!.id}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect(() => store.reorderColumn({ id: columns[1]!.id, direction: 'right' })).toThrow('synthetic failure');
    expect(store.snapshot(project.id).columns.map((item) => item.id)).toEqual(columns.map((item) => item.id));
    store.close();
  });
});
