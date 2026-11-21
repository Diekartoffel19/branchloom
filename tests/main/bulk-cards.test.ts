import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-bulk-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const todo = store.snapshot(project.id).columns[0]!;
  const destination = store.createColumn({ projectId: project.id, name: 'Executing', agentId: store.agents()[0]!.id, autoStart: true });
  const first = store.createCard({ projectId: project.id, columnId: todo.id, title: 'First' });
  const second = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Second' });
  const third = store.createCard({ projectId: project.id, columnId: destination.id, title: 'Existing' });
  return { store, path, root, project, todo, destination, first, second, third };
}

describe('bulk card actions', () => {
  it('appends selected cards in request order, persists, and never creates an agent session', () => {
    const { store, path, project, destination, first, second, third } = fixture();
    const moved = store.bulkUpdateCards({ projectId: project.id, cardIds: [second.id, first.id], action: 'move', columnId: destination.id });
    expect(moved.map((card) => card.id)).toEqual([second.id, first.id]);
    expect(moved.map((card) => card.position)).toEqual([third.position + 1, third.position + 2]);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(path);
    expect(reopened.snapshot(project.id).cards.filter((card) => card.columnId === destination.id).map((card) => card.id)).toEqual([third.id, second.id, first.id]);
    reopened.close();
  });

  it('archives a selection atomically and keeps cards restorable', () => {
    const { store, project, first, second } = fixture();
    const changed = store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, second.id], action: 'archive' });
    expect(changed.every((card) => Boolean(card.archivedAt))).toBe(true);
    expect(store.nextQueueCard(project.id)).toBeNull();
    expect(store.setCardArchived({ id: first.id, archived: false }).archivedAt).toBeNull();
    expect(store.card(second.id).archivedAt).toBeTruthy();
    store.close();
  });

  it('rejects mixed-project, archived, duplicate and malformed selections without partial writes', () => {
    const { store, root, project, destination, first, second } = fixture();
    mkdirSync(join(root, 'other'));
    const other = store.createProject({ name: 'Other', path: join(root, 'other') });
    const outside = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Outside' });
    const before = store.card(first.id);
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, outside.id], action: 'move', columnId: destination.id })).toThrow('anderen Projekt');
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, first.id], action: 'archive' })).toThrow('unterschiedliche');
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [], action: 'archive' })).toThrow('1 bis 100');
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id], action: 'move', columnId: store.snapshot(other.id).columns[0]!.id })).toThrow('anderen Projekt');
    store.setCardArchived({ id: second.id, archived: true });
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, second.id], action: 'archive' })).toThrow('wiederherstellen');
    expect(store.card(first.id)).toEqual(before);
    store.close();
  });

  it('requires a paused queue and stops bulk changes to cards with running sessions or workflows', () => {
    const { store, project, destination, first, second } = fixture();
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id], action: 'move', columnId: destination.id })).toThrow('Warteschlange');
    store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: null, activeWorkflowId: null, pauseReason: 'user' });
    const session = store.createSession({ cardId: second.id, agentId: store.agents()[0]!.id });
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, second.id], action: 'archive' })).toThrow('Agentensitzung');
    store.finishSession(session.id, 'stopped', null);
    const flow = store.createWorkflow({ projectId: project.id, name: 'Synthetic flow', cardIds: [second.id], steps: [{ id: 'one', columnId: destination.id, agentId: null, requireApproval: false }] });
    store.setWorkflowState(flow.id, 'paused');
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, second.id], action: 'move', columnId: destination.id })).toThrow('Workflow');
    expect(store.card(first.id).columnId).not.toBe(destination.id);
    store.close();
  });

  it('rolls back every card when SQLite rejects a later update', () => {
    const { store, project, destination, first, second } = fixture();
    const before = [store.card(first.id), store.card(second.id)];
    store.db.exec(`CREATE TRIGGER reject_second_bulk BEFORE UPDATE ON cards WHEN NEW.id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect(() => store.bulkUpdateCards({ projectId: project.id, cardIds: [first.id, second.id], action: 'move', columnId: destination.id })).toThrow('synthetic failure');
    expect([store.card(first.id), store.card(second.id)]).toEqual(before);
    store.close();
  });
});
