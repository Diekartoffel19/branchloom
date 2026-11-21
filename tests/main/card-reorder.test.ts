import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-card-order-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const todo = store.snapshot(project.id).columns[0]!;
  const first = store.createCard({ projectId: project.id, columnId: todo.id, title: 'First' });
  const second = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Second' });
  const third = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Third' });
  return { store, path, project, todo, first, second, third };
}

function ids(store: StudioStore, projectId: string, columnId: string) {
  return store.snapshot(projectId).cards.filter((card) => card.columnId === columnId).map((card) => card.id);
}

describe('card order within a board column', () => {
  it('changes the next To-Do queue card and persists across restart', () => {
    const { store, path, project, todo, first, second, third } = fixture();
    expect(store.nextQueueCard(project.id)?.id).toBe(first.id);
    store.reorderCard({ id: third.id, direction: 'up' });
    expect(ids(store, project.id, todo.id)).toEqual([first.id, third.id, second.id]);
    store.reorderCard({ id: third.id, direction: 'up' });
    expect(store.nextQueueCard(project.id)?.id).toBe(third.id);
    expect(store.projectQueue(project.id).state).toBe('off');
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();

    const reopened = new StudioStore(path);
    expect(ids(reopened, project.id, todo.id)).toEqual([third.id, first.id, second.id]);
    expect(reopened.nextQueueCard(project.id)?.id).toBe(third.id);
    const fourth = reopened.createCard({ projectId: project.id, columnId: todo.id, title: 'Fourth' });
    expect(ids(reopened, project.id, todo.id)).toEqual([third.id, first.id, second.id, fourth.id]);
    reopened.close();
  });

  it('moves only active cards and leaves archived cards in their slot', () => {
    const { store, project, todo, first, second, third } = fixture();
    store.setCardArchived({ id: second.id, archived: true });
    store.reorderCard({ id: third.id, direction: 'up' });
    expect(ids(store, project.id, todo.id)).toEqual([third.id, second.id, first.id]);
    expect(store.nextQueueCard(project.id)?.id).toBe(third.id);
    expect(() => store.reorderCard({ id: second.id, direction: 'down' })).toThrow('wiederherstellen');
    store.setCardArchived({ id: second.id, archived: false });
    expect(ids(store, project.id, todo.id)).toEqual([third.id, second.id, first.id]);
    store.close();
  });

  it('rejects invalid and boundary moves without changing positions', () => {
    const { store, project, todo, first, third } = fixture();
    const before = store.snapshot(project.id).cards.map((card) => [card.id, card.position]);
    expect(() => store.reorderCard({ id: first.id, direction: 'up' })).toThrow('Rand');
    expect(() => store.reorderCard({ id: third.id, direction: 'down' })).toThrow('Rand');
    expect(() => store.reorderCard({ id: first.id, direction: 'sideways' as 'up' })).toThrow('Ungültige');
    expect(() => store.reorderCard({ id: 'missing', direction: 'down' })).toThrow('Card not found');
    expect(store.snapshot(project.id).cards.map((card) => [card.id, card.position])).toEqual(before);
    expect(ids(store, project.id, todo.id)).toEqual(before.map((item) => item[0]));
    store.close();
  });

  it('rolls back every position when SQLite rejects an update', () => {
    const { store, project, first, second } = fixture();
    const before = store.snapshot(project.id).cards.map((card) => [card.id, card.position]);
    store.db.exec(`CREATE TRIGGER reject_second_order BEFORE UPDATE OF position ON cards WHEN NEW.id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect(() => store.reorderCard({ id: first.id, direction: 'down' })).toThrow('synthetic failure');
    expect(store.snapshot(project.id).cards.map((card) => [card.id, card.position])).toEqual(before);
    expect(store.nextQueueCard(project.id)?.id).toBe(first.id);
    store.close();
  });

  it('repairs duplicate legacy positions deterministically while moving', () => {
    const { store, project, todo, first, second, third } = fixture();
    store.db.prepare('UPDATE cards SET position = 0 WHERE id IN (?, ?)').run(second.id, third.id);
    store.db.prepare('UPDATE cards SET position = -1 WHERE id = ?').run(first.id);
    const ordered = ids(store, project.id, todo.id);
    expect(ordered[0]).toBe(first.id);
    store.reorderCard({ id: ordered[2]!, direction: 'up' });
    const cards = store.snapshot(project.id).cards.filter((card) => card.columnId === todo.id);
    expect(cards.map((card) => card.position)).toEqual([0, 1, 2]);
    expect(cards.map((card) => card.id)).toEqual([first.id, ordered[2], ordered[1]]);
    store.close();
  });
});
