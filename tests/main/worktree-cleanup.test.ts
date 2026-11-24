import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCardWorktree, mergeCardWorktree, previewCardWorktreeCleanup, reviewCardWorktree } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function commit(cwd: string, path: string, value: string): string {
  writeFileSync(join(cwd, path), value);
  git(cwd, ['add', '--', path]);
  git(cwd, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Synthetic worktree check']);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-cleanup-preview-'));
  roots.push(root);
  const repository = join(root, 'repo');
  const data = join(root, 'app-data');
  mkdirSync(repository); mkdirSync(data);
  git(repository, ['init', '-q']);
  commit(repository, '.gitignore', 'scratch.log\n');
  const store = new StudioStore(join(data, 'studio.sqlite'));
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: repository });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Cleanup preview' });
  return { root, repository, store, project, card };
}

describe('read-only card worktree cleanup preview', () => {
  it('never creates a missing worktree and distinguishes a merged clean checkout from ignored and untracked files', () => {
    const { store, card } = fixture();
    expect(previewCardWorktreeCleanup(store, card.id)).toBeNull();
    expect(store.cardWorktree(card.id)).toBeNull();
    const worktree = ensureCardWorktree(store, card.id);
    const initial = previewCardWorktreeCleanup(store, card.id)!;
    expect(initial).toMatchObject({ cardId: card.id, branch: worktree.branch, sourceClean: true, targetClean: true, ignoredFilesPresent: false, mergedIntoTarget: true, blockers: [] });
    expect(initial.sourceHead).toBe(initial.targetHead);
    writeFileSync(join(worktree.path, 'scratch.log'), 'ignored but valuable');
    const ignored = previewCardWorktreeCleanup(store, card.id)!;
    expect(ignored).toMatchObject({ sourceClean: true, ignoredFilesPresent: true, mergedIntoTarget: true });
    expect(ignored.blockers.join(' ')).toContain('ignorierte Dateien');
    writeFileSync(join(worktree.path, 'untracked.txt'), 'not yet committed');
    const untracked = previewCardWorktreeCleanup(store, card.id)!;
    expect(untracked.sourceClean).toBe(false);
    expect(untracked.blockers.join(' ')).toContain('unversionierte Dateien');
    expect(existsSync(join(worktree.path, 'scratch.log'))).toBe(true);
    expect(existsSync(join(worktree.path, 'untracked.txt'))).toBe(true);
    expect(store.cardWorktree(card.id)?.path).toBe(worktree.path);
  });

  it('requires the exact source commit in the target and shows divergence separately from later target commits', () => {
    const { store, card, repository } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    const sourceHead = commit(worktree.path, 'feature.txt', 'worktree change');
    const before = previewCardWorktreeCleanup(store, card.id)!;
    expect(before.sourceHead).toBe(sourceHead);
    expect(before.mergedIntoTarget).toBe(false);
    expect(before.blockers.join(' ')).toContain('nicht enthalten');
    const review = reviewCardWorktree(store, card.id)!;
    mergeCardWorktree(store, { cardId: card.id, previewToken: review.previewToken, confirm: true });
    const merged = previewCardWorktreeCleanup(store, card.id)!;
    expect(merged.mergedIntoTarget).toBe(true);
    expect(merged.blockers).toEqual([]);
    commit(repository, 'later.txt', 'new target commit');
    const behind = previewCardWorktreeCleanup(store, card.id)!;
    expect(behind.mergedIntoTarget).toBe(true);
    expect(behind.sourceHead).not.toBe(behind.targetHead);
    commit(worktree.path, 'second.txt', 'unmerged source commit');
    commit(repository, 'third.txt', 'diverged target commit');
    expect(previewCardWorktreeCleanup(store, card.id)?.mergedIntoTarget).toBe(false);
  });

  it('rejects a substituted saved path and leaves both repositories untouched', () => {
    const { root, store, card, repository } = fixture();
    const original = ensureCardWorktree(store, card.id);
    const other = join(root, 'other');
    mkdirSync(other);
    git(other, ['init', '-q']);
    commit(other, 'other.txt', 'keep');
    store.db.prepare('UPDATE card_worktrees SET path = ? WHERE card_id = ?').run(other, card.id);
    expect(() => previewCardWorktreeCleanup(store, card.id)).toThrow();
    expect(existsSync(original.path)).toBe(true);
    expect(existsSync(join(other, 'other.txt'))).toBe(true);
    expect(existsSync(join(repository, '.gitignore'))).toBe(true);
  });

  it('reports a dirty target and a running project agent as separate blockers', () => {
    const { store, card, repository } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(repository, 'local.txt'), 'valuable target file');
    const session = store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id });
    const preview = previewCardWorktreeCleanup(store, card.id)!;
    expect(preview).toMatchObject({ sourceClean: true, targetClean: false, activeSession: true });
    expect(preview.blockers.join(' ')).toContain('Ziel-Checkout enthält');
    expect(preview.blockers.join(' ')).toContain('läuft noch ein Agent');
    expect(existsSync(join(repository, 'local.txt'))).toBe(true);
    expect(existsSync(worktree.path)).toBe(true);
    store.finishSession(session.id, 'stopped', null);
  });
});
