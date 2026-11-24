import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { qaGitEvidence, qaGitPoint } from '../../src/main/qa-git-evidence';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}

function fixture(withGit = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-qa-git-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  if (withGit) {
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'tracked.txt'), 'first\n');
    git(repo, 'add', 'tracked.txt');
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'first');
  }
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic Git QA', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Check' });
  return { root, repo, store, card };
}

describe('QA checkout evidence', () => {
  it('records a stable clean HEAD from the project checkout and distinguishes dirty and changed states', async () => {
    const { repo, store, card } = fixture();
    const start = await qaGitPoint(store, card);
    expect(start).toMatchObject({ scope: 'project', head: git(repo, 'rev-parse', 'HEAD'), dirty: false });
    expect(qaGitEvidence(start, await qaGitPoint(store, card))).toMatchObject({ state: 'clean', startHead: start.head, endHead: start.head });
    writeFileSync(join(repo, 'tracked.txt'), 'dirty\n');
    expect(qaGitEvidence(start, await qaGitPoint(store, card))).toMatchObject({ state: 'dirty', dirtyAtEnd: true });
    git(repo, 'add', 'tracked.txt');
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'second');
    expect(qaGitEvidence(start, await qaGitPoint(store, card))).toMatchObject({ state: 'changed', startHead: start.head, endHead: git(repo, 'rev-parse', 'HEAD') });
    store.close();
  });

  it('uses the verified card worktree when present and keeps invalid or absent Git unknown', async () => {
    const { repo, store, card } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    const point = await qaGitPoint(store, card);
    expect(point).toMatchObject({ scope: 'card-worktree', head: git(worktree.path, 'rev-parse', 'HEAD'), dirty: false });
    writeFileSync(join(repo, 'tracked.txt'), 'project only\n');
    expect(await qaGitPoint(store, card)).toMatchObject({ scope: 'card-worktree', dirty: false });
    writeFileSync(join(worktree.path, 'untracked.txt'), 'worktree only\n');
    expect(await qaGitPoint(store, card)).toMatchObject({ scope: 'card-worktree', dirty: true });
    rmSync(worktree.path, { recursive: true, force: true });
    expect(await qaGitPoint(store, card)).toEqual({ scope: 'card-worktree', head: null, dirty: null });
    store.close();
    const other = fixture(false);
    expect(qaGitEvidence(await qaGitPoint(other.store, other.card), await qaGitPoint(other.store, other.card))).toMatchObject({ scope: 'project', state: 'unavailable', startHead: null });
    other.store.close();
  });
});
