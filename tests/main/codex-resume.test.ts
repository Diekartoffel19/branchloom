import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const mock = vi.hoisted(() => ({ launches: [] as Array<{ executable: string; args: string[]; cwd: string; writes: string[]; data: (value: string) => void }> }));
vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn((executable: string, args: string[], options: { cwd: string }) => {
      const launch = { executable, args, cwd: options.cwd, writes: [] as string[], data: (_value: string) => undefined };
      mock.launches.push(launch);
      return {
        cols: 100, rows: 30,
        onData(callback: (value: string) => void) { launch.data = callback; return { dispose() {} }; },
        onExit() { return { dispose() {} }; },
        write(value: string) { launch.writes.push(value); },
        resize() {}, kill() {},
      };
    }),
  },
}));

const roots: string[] = [];
afterEach(() => {
  mock.launches.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-resume-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'store.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Task' });
  const agent = store.saveAgent({ name: 'Codex fixture', kind: 'codex', command: process.execPath, args: ['--search'], model: 'synthetic-model', enabled: true });
  const previous = store.createSession({ cardId: card.id, agentId: agent.id });
  store.finishSession(previous.id, 'failed', 1);
  return { root, store, project, card, agent, previous };
}

describe('explicit Codex conversation picker', () => {
  it('starts a fresh Studio session in the same directory without replaying a prompt or choosing --last', () => {
    const { root, store, previous } = fixture();
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const next = runner.resumeCodex({ sessionId: previous.id });
    expect(next.id).not.toBe(previous.id);
    expect(next.state).toBe('running');
    expect(mock.launches).toHaveLength(1);
    expect(mock.launches[0]).toMatchObject({ executable: process.execPath, args: ['resume', '--include-non-interactive'], cwd: root });
    expect(mock.launches[0]!.args).not.toContain('--last');
    expect(mock.launches[0]!.args).not.toContain('--search');
    expect(store.session(previous.id).state).toBe('failed');
    mock.launches[0]!.data('Picker ready');
    expect(store.session(next.id).output).toContain('Picker ready');
    runner.writeRaw({ sessionId: next.id, data: '\x1b[A' });
    expect(mock.launches[0]!.writes).toEqual(['\x1b[A']);
    runner.stop(next.id);
    expect(store.session(next.id).state).toBe('stopped');
    store.close();
  });

  it('rejects running, archived, and non-Codex source sessions without spawning', () => {
    const { store, card, previous } = fixture();
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const running = store.createSession({ cardId: card.id, agentId: previous.agentId });
    expect(() => runner.resumeCodex({ sessionId: running.id })).toThrow('Laufende');
    store.finishSession(running.id, 'exited', 0);
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => runner.resumeCodex({ sessionId: previous.id })).toThrow('Archivierte');
    store.setCardArchived({ id: card.id, archived: false });
    const other = store.saveAgent({ name: 'Other', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
    const nonCodex = store.createSession({ cardId: card.id, agentId: other.id });
    store.finishSession(nonCodex.id, 'failed', 1);
    expect(() => runner.resumeCodex({ sessionId: nonCodex.id })).toThrow('Codex');
    expect(mock.launches).toHaveLength(0);
    runner.dispose();
    store.close();
  });

  it('does not recreate a lost worktree from a previous session', () => {
    const { store, card, agent } = fixture();
    const old = store.createSession({ cardId: card.id, agentId: agent.id, worktreePath: join(tmpdir(), 'synthetic-missing-worktree') });
    store.finishSession(old.id, 'failed', 1);
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    expect(() => runner.resumeCodex({ sessionId: old.id })).toThrow('nicht mehr verknüpft');
    expect(mock.launches).toHaveLength(0);
    expect(store.snapshot(card.projectId).sessions).toHaveLength(2);
    runner.dispose();
    store.close();
  });
});
