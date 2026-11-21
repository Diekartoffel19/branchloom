import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-session-search-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic task' });
  const agent = store.agents()[0]!;
  return { store, file, project, card, agent };
}

describe('local session transcript search', () => {
  it('indexes finished output, returns bounded readable snippets, and respects project identity', () => {
    const { store, file, project, card, agent } = fixture();
    const running = store.createSession({ cardId: card.id, agentId: agent.id });
    store.appendOutput(running.id, '\x1b[32mDie wichtige Frist ist morgen\x1b[0m');
    expect(store.searchSessionTranscripts(project.id, 'frist')).toEqual([]);
    store.finishSession(running.id, 'exited', 0);
    const hits = store.searchSessionTranscripts(project.id, 'Frist');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId: running.id, cardId: card.id, cardTitle: card.title, agentName: agent.name });
    expect(hits[0]!.snippet).toContain('Frist');
    expect(hits[0]!.snippet).not.toContain('\x1b');
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(220);
    expect(store.searchSessionTranscripts(project.id, 'absolut-unbekannt')).toEqual([]);
    expect(store.searchSessionTranscripts(project.id, 'a')).toEqual([]);
    expect(() => store.searchSessionTranscripts(project.id, 'x'.repeat(161))).toThrow('160 Zeichen');
    expect(store.sessionForProject(project.id, running.id).id).toBe(running.id);
    mkdirSync(join(project.path, 'other'));
    const other = store.createProject({ name: 'Other', path: join(project.path, 'other') });
    expect(store.searchSessionTranscripts(other.id, 'frist')).toEqual([]);
    expect(() => store.sessionForProject(other.id, running.id)).toThrow('anderen Projekt');
    store.close();
    const reopened = new StudioStore(file);
    expect(reopened.searchSessionTranscripts(project.id, 'frist')[0]?.sessionId).toBe(running.id);
    reopened.close();
  });

  it('finds an older run beyond the 200-session snapshot and rebuilds legacy output', () => {
    const { store, file, project, card, agent } = fixture();
    const old = store.createSession({ cardId: card.id, agentId: agent.id });
    store.appendOutput(old.id, 'Archivsignal tief im Verlauf');
    store.finishSession(old.id, 'exited', 0);
    store.db.prepare('UPDATE sessions SET started_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', old.id);
    for (let index = 0; index < 201; index += 1) {
      const recent = store.createSession({ cardId: card.id, agentId: agent.id });
      store.finishSession(recent.id, 'exited', 0);
    }
    expect(store.snapshot(project.id).sessions).toHaveLength(200);
    expect(store.snapshot(project.id).sessions.some((item) => item.id === old.id)).toBe(false);
    expect(store.searchSessionTranscripts(project.id, 'Archivsignal')[0]?.sessionId).toBe(old.id);
    store.close();
    const raw = new Database(file);
    raw.exec('DROP TRIGGER session_output_fts_finished; DROP TRIGGER session_output_fts_changed; DROP TRIGGER session_output_fts_added; DROP TRIGGER session_output_fts_cleared; DROP TRIGGER session_output_fts_deleted; DROP TABLE session_output_fts;');
    raw.close();
    const migrated = new StudioStore(file);
    expect(migrated.searchSessionTranscripts(project.id, 'Archivsignal')[0]?.sessionId).toBe(old.id);
    migrated.db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    expect(() => migrated.searchSessionTranscripts(project.id, 'Archivsignal')).toThrow();
    migrated.close();
  });

  it('indexes the preserved output of a session marked failed after restart', () => {
    const { store, file, project, card, agent } = fixture();
    const running = store.createSession({ cardId: card.id, agentId: agent.id });
    store.appendOutput(running.id, 'WLAN-Ausfall während Antwort');
    store.close();
    const restarted = new StudioStore(file);
    expect(restarted.session(running.id).state).toBe('failed');
    expect(restarted.searchSessionTranscripts(project.id, 'WLAN')[0]?.sessionId).toBe(running.id);
    restarted.close();
  });
});
