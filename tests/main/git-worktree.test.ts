import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { SessionRunner } from '../../src/main/cli';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  // ConPTY can briefly retain directory handles after kill() on Windows.
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      // Git/ConPTY may retain a Windows directory handle for the rest of this
      // test process. The fixture lives in the runner's temporary directory.
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function fixture(withGit = true) {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-worktree-test-'));
  roots.push(root);
  const repository = join(root, 'repository');
  const data = join(root, 'app-data');
  mkdirSync(repository);
  mkdirSync(data);
  if (withGit) {
    git(repository, ['init', '-q']);
    writeFileSync(join(repository, 'tracked.txt'), 'original');
    git(repository, ['add', 'tracked.txt']);
    git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Initial test commit']);
  }
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Git fixture', path: repository });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic task' });
  return { root, repository, data, dbPath, store, project, card };
}

describe('per-card Git worktrees', () => {
  it('creates a branch outside the repo and reuses uncommitted changes after app restart', () => {
    const { repository, store, dbPath, card } = fixture();
    const first = ensureCardWorktree(store, card.id);
    expect(first.branch).toBe(`jarvis/card-${card.id}`);
    expect(relative(repository, first.path).startsWith('..')).toBe(true);
    expect(git(first.path, ['branch', '--show-current'])).toBe(first.branch);
    writeFileSync(join(first.path, 'draft.txt'), 'keep this work');
    store.close();
    const reopened = new StudioStore(dbPath);
    const second = ensureCardWorktree(reopened, card.id);
    expect(second).toEqual(first);
    expect(readFileSync(join(second.path, 'draft.txt'), 'utf8')).toBe('keep this work');
    expect(existsSync(join(repository, 'draft.txt'))).toBe(false);
    reopened.close();
  });

  it('runs an explicit session in its worktree, and stop does not delete its files', async () => {
    const { repository, store, card } = fixture();
    const agent = store.saveAgent({ name: 'Synthetic Node', kind: 'custom', command: process.execPath, args: ['-e', 'require("fs").writeFileSync("agent.txt", "worktree only"); setInterval(() => {}, 1000)'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const started = runner.start({ cardId: card.id, agentId: agent.id, prompt: '', useWorktree: true });
    expect(started.worktreePath).toBeTruthy();
    const output = started.worktreePath!;
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const check = (): void => {
        if (existsSync(join(output, 'agent.txt'))) resolve();
        else if (Date.now() >= deadline) reject(new Error('Agent did not write in worktree'));
        else setTimeout(check, 50);
      };
      check();
    });
    runner.stop(started.id);
    expect(store.session(started.id).state).toBe('stopped');
    expect(store.session(started.id).worktreePath).toBe(output);
    expect(readFileSync(join(output, 'agent.txt'), 'utf8')).toBe('worktree only');
    expect(existsSync(join(repository, 'agent.txt'))).toBe(false);
    runner.dispose();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    store.close();
  }, 60_000);

  it('keeps worktrees disabled by default and refuses a non-Git project without a session', () => {
    const { store, card } = fixture(false);
    const agent = store.saveAgent({ name: 'Synthetic Node', kind: 'custom', command: process.execPath, args: ['-e', 'console.log("ok")'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    expect(() => runner.start({ cardId: card.id, agentId: agent.id, useWorktree: true })).toThrow('Git-Repository');
    expect(store.latestSession(card.id)).toBeNull();
    expect(store.cardWorktree(card.id)).toBeNull();
    runner.dispose();
    store.close();
  });

  it('refuses a replaced worktree path and does not remove its contents', () => {
    const { store, card } = fixture();
    const first = ensureCardWorktree(store, card.id);
    writeFileSync(join(first.path, 'valuable.txt'), 'preserve');
    git(first.path, ['checkout', '--detach']);
    expect(() => ensureCardWorktree(store, card.id)).toThrow('Karten-Branch');
    expect(readFileSync(join(first.path, 'valuable.txt'), 'utf8')).toBe('preserve');
    store.close();
  });
});
