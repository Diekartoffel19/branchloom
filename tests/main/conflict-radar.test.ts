import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedPaths, reviewCardConflicts } from '../../src/main/conflict-radar';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function commit(cwd: string, file: string, content: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Synthetic change']);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-radar-'));
  roots.push(root);
  const repository = join(root, 'repo');
  const data = join(root, 'app-data');
  mkdirSync(repository); mkdirSync(data);
  git(repository, ['init', '-q']);
  commit(repository, 'shared.txt', 'base');
  const store = new StudioStore(join(data, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: repository });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'Erste Karte' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'Zweite Karte' });
  const firstTree = ensureCardWorktree(store, first.id);
  const secondTree = ensureCardWorktree(store, second.id);
  const agent = store.agents()[0]!;
  const firstRun = store.createSession({ cardId: first.id, agentId: agent.id, worktreePath: firstTree.path });
  const secondRun = store.createSession({ cardId: second.id, agentId: agent.id, worktreePath: secondTree.path });
  return { store, project, first, second, firstRun, secondRun, firstTree, secondTree, repository };
}

describe('conflict radar', () => {
  it('detects the same touched file in two active worktrees and clears when paths differ', async () => {
    const { store, project, first, firstTree, secondTree, repository } = fixture();
    writeFileSync(join(firstTree.path, 'shared.txt'), 'first');
    writeFileSync(join(secondTree.path, 'shared.txt'), 'second');
    const overlap = await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id));
    expect(overlap.state).toBe('overlap');
    expect(overlap.peers[0]).toMatchObject({ cardTitle: 'Zweite Karte', state: 'overlap', commonPaths: ['shared.txt'], commonCount: 1 });
    writeFileSync(join(secondTree.path, 'shared.txt'), 'base');
    writeFileSync(join(secondTree.path, 'elsewhere.txt'), 'other');
    const clear = await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id));
    expect(clear.state).toBe('clear');
    expect(clear.peers[0]).toMatchObject({ state: 'clear', commonPaths: [], changedCount: 1 });
    expect(git(repository, ['status', '--porcelain'])).toBe('');
    store.close();
  });

  it('includes committed changes and untracked files in the comparison', async () => {
    const { store, project, first, firstTree, secondTree } = fixture();
    commit(firstTree.path, 'shared.txt', 'committed first');
    writeFileSync(join(secondTree.path, 'shared.txt'), 'uncommitted second');
    expect((await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id))).state).toBe('overlap');
    writeFileSync(join(secondTree.path, 'shared.txt'), 'base');
    writeFileSync(join(firstTree.path, 'new.txt'), 'first untracked');
    writeFileSync(join(secondTree.path, 'new.txt'), 'second untracked');
    expect((await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id))).peers[0]?.commonPaths).toContain('new.txt');
    await expect(changedPaths(firstTree.path, join(firstTree.path, '..', '..', '..', 'does-not-exist'))).rejects.toThrow('Git-Status');
    store.close();
  });

  it('warns when one worktree changes a file where another creates a directory', async () => {
    const { store, project, first, firstTree, secondTree } = fixture();
    writeFileSync(join(firstTree.path, 'module'), 'file on first branch');
    mkdirSync(join(secondTree.path, 'module'));
    writeFileSync(join(secondTree.path, 'module', 'index.ts'), 'nested file on second branch');
    const result = await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id));
    expect(result.state).toBe('overlap');
    expect(result.peers[0]?.commonPaths).toContain('module');
    store.close();
  });

  it('shows unknown instead of clear when one session has no valid worktree', async () => {
    const { store, project, first, secondRun, repository } = fixture();
    store.finishSession(secondRun.id, 'stopped', null);
    const agent = store.agents()[0]!;
    const missing = store.createSession({ cardId: secondRun.cardId, agentId: agent.id, worktreePath: null });
    const result = await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id));
    expect(result.state).toBe('unknown');
    expect(result.peers[0]?.reason).toContain('keinen isolierten Worktree');
    store.finishSession(missing.id, 'stopped', null);
    store.createSession({ cardId: secondRun.cardId, agentId: agent.id, worktreePath: repository });
    const mismatched = await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id));
    expect(mismatched.state).toBe('unknown');
    expect(mismatched.peers[0]?.reason).toContain('nicht mehr eindeutig zugeordnet');
    store.close();
  });

  it('marks an oversized peer set as unknown before a partial comparison', async () => {
    const { store, project, first } = fixture();
    const agent = store.agents()[0]!;
    const columnId = store.snapshot(project.id).columns[0]!.id;
    for (let index = 0; index < 20; index += 1) {
      const card = store.createCard({ projectId: project.id, columnId, title: `Weitere Karte ${index}` });
      store.createSession({ cardId: card.id, agentId: agent.id });
    }
    const result = await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id));
    expect(result.state).toBe('unknown');
    expect(result.reason).toContain('Mehr als 20');
    expect(result.peers).toEqual([]);
    store.close();
  });

  it('queries every running session even after more than 200 completed runs', async () => {
    const { store, project, first, firstRun, secondRun } = fixture();
    const agent = store.agents()[0]!;
    for (let index = 0; index < 205; index += 1) {
      const done = store.createSession({ cardId: first.id, agentId: agent.id });
      store.finishSession(done.id, 'exited', 0);
    }
    expect(store.snapshot(project.id).sessions.some((item) => item.id === firstRun.id)).toBe(false);
    store.appendOutput(firstRun.id, 'Synthetic transcript that the radar should not load');
    const running = store.runningSessionsForProject(project.id);
    expect(running.map((item) => item.id).sort()).toEqual([firstRun.id, secondRun.id].sort());
    expect(running.every((item) => item.output === '')).toBe(true);
    store.finishSession(firstRun.id, 'stopped', null);
    expect((await reviewCardConflicts(store, first.id, store.runningSessionsForProject(project.id))).state).toBe('idle');
    store.close();
  });
});
