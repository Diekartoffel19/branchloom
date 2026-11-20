import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import type { SessionRunner } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-archive-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Synthetic task', description: 'Persist this card' });
  return { store, dbPath, project, columns, card };
}

describe('card archive', () => {
  it('persists archive and restore without deleting card, work history or board position', () => {
    const { store, dbPath, project, columns, card } = fixture();
    const originalPosition = card.position;
    const archived = store.setCardArchived({ id: card.id, archived: true });
    expect(archived.archivedAt).toBeTruthy();
    expect(store.setCardArchived({ id: card.id, archived: true }).archivedAt).toBe(archived.archivedAt);
    expect(() => store.updateCard({ id: card.id, title: 'Changed' })).toThrow('wiederherstellen');
    expect(() => store.moveCard({ id: card.id, columnId: columns[1]!.id })).toThrow('wiederherstellen');
    store.close();

    const reopened = new StudioStore(dbPath);
    expect(reopened.snapshot(project.id).cards[0]?.archivedAt).toBe(archived.archivedAt);
    expect(reopened.card(card.id).position).toBe(originalPosition);
    const restored = reopened.setCardArchived({ id: card.id, archived: false });
    expect(restored.archivedAt).toBeNull();
    expect(restored.position).toBe(originalPosition);
    expect(reopened.updateCard({ id: card.id, title: 'Changed' }).title).toBe('Changed');
    reopened.close();
  });

  it('blocks archiving running work and blocks archived cards from sessions or workflow start', () => {
    const { store, project, columns, card } = fixture();
    const agent = store.agents()[0]!;
    const running = store.createSession({ cardId: card.id, agentId: agent.id });
    expect(() => store.setCardArchived({ id: card.id, archived: true })).toThrow('stoppen');
    store.finishSession(running.id, 'stopped', null);
    const workflow = store.createWorkflow({ projectId: project.id, name: 'Draft', cardIds: [card.id], steps: [{ id: 'step', columnId: columns[1]!.id, agentId: agent.id, requireApproval: false }] });
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => store.createSession({ cardId: card.id, agentId: agent.id })).toThrow('wiederherstellen');
    expect(() => store.createWorkflow({ projectId: project.id, name: 'Another', cardIds: [card.id], steps: workflow.steps })).toThrow('wiederherstellen');
    expect(() => store.setWorkflowState(workflow.id, 'running')).toThrow('wiederherstellen');
    const engine = new WorkflowEngine(store, { start: () => { throw new Error('must not start'); }, stop: () => undefined } as unknown as SessionRunner);
    expect(() => engine.setState({ id: workflow.id, state: 'running' })).toThrow('wiederherstellen');
    expect(store.workflowProgress(workflow.id, 0)).toEqual([]);
    store.setCardArchived({ id: card.id, archived: false });
    store.setWorkflowState(workflow.id, 'running');
    expect(() => store.setCardArchived({ id: card.id, archived: true })).toThrow('pausieren');
    store.close();
  });

  it('migrates a database with legacy cards without losing their data', () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-legacy-card-'));
    roots.push(root);
    const dbPath = join(root, 'legacy.sqlite');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE columns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, agent_id TEXT);
      CREATE TABLE cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, column_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const stamp = '2026-01-01T00:00:00.000Z';
    legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run('legacy-project', 'Legacy', root, stamp);
    legacy.prepare('INSERT INTO columns VALUES (?, ?, ?, ?, ?, ?)').run('legacy-column', 'legacy-project', 'To Do', 0, 0, null);
    legacy.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-card', 'legacy-project', 'legacy-column', 'Old-style card', 'Keep this text', 3, stamp, stamp);
    legacy.close();
    const store = new StudioStore(dbPath);
    expect((store.db.pragma('table_info(cards)') as Array<{ name: string }>).some((column) => column.name === 'archived_at')).toBe(true);
    expect(store.snapshot('legacy-project').cards).toMatchObject([{ id: 'legacy-card', title: 'Old-style card', description: 'Keep this text', position: 3, archivedAt: null }]);
    store.setCardArchived({ id: 'legacy-card', archived: true });
    expect(store.card('legacy-card').archivedAt).toBeTruthy();
    store.close();
  });
});
