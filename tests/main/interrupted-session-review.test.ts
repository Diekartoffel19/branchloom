import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-recovery-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'First project', path: root });
  const otherRoot = join(root, 'second-project');
  mkdirSync(otherRoot);
  const second = store.createProject({ name: 'Second project', path: otherRoot });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic interrupted card' });
  const agent = store.agents()[0]!;
  return { root, dbPath, store, project, second, card, agent };
}

describe('interrupted session review', () => {
  it('adds recovery columns to an existing database without replacing old sessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-recovery-legacy-'));
    roots.push(root);
    const dbPath = join(root, 'studio.sqlite');
    const old = new Database(dbPath);
    old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, card_id TEXT NOT NULL,
      agent_id TEXT NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL,
      ended_at TEXT, exit_code INTEGER, output TEXT NOT NULL DEFAULT '')`);
    old.close();
    const store = new StudioStore(dbPath);
    try {
      const columns = store.db.pragma('table_info(sessions)') as Array<{ name: string }>;
      expect(columns.map((item) => item.name)).toEqual(expect.arrayContaining(['worktree_path', 'interrupted_at', 'interruption_reviewed_at', 'codex_thread_id']));
      expect(store.interruptedSessions(store.createProject({ name: 'Legacy', path: root }).id)).toEqual([]);
    } finally { store.close(); }
  });

  it('persists an actionable interruption without replay, scopes acknowledgement, and keeps the transcript', () => {
    const { dbPath, store, project, second, card, agent } = fixture();
    const regularFailure = store.createSession({ cardId: card.id, agentId: agent.id });
    store.finishSession(regularFailure.id, 'failed', 1);
    const interrupted = store.createSession({ cardId: card.id, agentId: agent.id });
    store.appendOutput(interrupted.id, 'Synthetic partial output.');
    store.close();

    const reopened = new StudioStore(dbPath);
    try {
      expect(reopened.session(interrupted.id).state).toBe('failed');
      expect(reopened.session(interrupted.id).output).toContain('Synthetic partial output.');
      expect(reopened.interruptedSessions(project.id)).toEqual([
        expect.objectContaining({ sessionId: interrupted.id, cardId: card.id, cardTitle: card.title, projectId: project.id }),
      ]);
      expect(reopened.interruptedSessions(second.id)).toEqual([]);
      expect(() => reopened.acknowledgeInterruptedSession({ projectId: second.id, sessionId: interrupted.id })).toThrow('diesem Projekt');
      expect(reopened.interruptedSessions(project.id)).toHaveLength(1);
      reopened.acknowledgeInterruptedSession({ projectId: project.id, sessionId: interrupted.id });
      expect(() => reopened.acknowledgeInterruptedSession({ projectId: project.id, sessionId: interrupted.id })).toThrow('bereits geprüft');
      expect(reopened.interruptedSessions(project.id)).toEqual([]);
      expect(reopened.session(interrupted.id).state).toBe('failed');
    } finally { reopened.close(); }

    const secondOpen = new StudioStore(dbPath);
    expect(secondOpen.interruptedSessions(project.id)).toEqual([]);
    expect(secondOpen.session(interrupted.id).output).toContain('Synthetic partial output.');
    secondOpen.close();
  });

  it('keeps an older unreviewed interruption accessible beyond the normal 200-session snapshot cap', () => {
    const { dbPath, store, project, card, agent } = fixture();
    const interrupted = store.createSession({ cardId: card.id, agentId: agent.id });
    store.db.prepare('UPDATE sessions SET started_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', interrupted.id);
    const historyCard = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Completed history' });
    for (let index = 0; index < 205; index += 1) {
      const later = store.createSession({ cardId: historyCard.id, agentId: agent.id });
      store.finishSession(later.id, 'exited', 0);
    }
    store.close();
    const reopened = new StudioStore(dbPath);
    try {
      const snapshot = reopened.snapshot(project.id);
      expect(snapshot.sessions.some((session) => session.id === interrupted.id)).toBe(true);
      expect(snapshot.interruptedSessions?.map((item) => item.sessionId)).toContain(interrupted.id);
      expect(snapshot.sessions.length).toBe(201);
    } finally { reopened.close(); }
  });
});
