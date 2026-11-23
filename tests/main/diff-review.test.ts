import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewComment, listReviewComments, parseCardDiff, previewCardDiff } from '../../src/main/diff-review';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-diff-review-'));
  roots.push(root);
  const repository = join(root, 'repository');
  const appData = join(root, 'app-data');
  mkdirSync(repository); mkdirSync(appData);
  git(repository, 'init', '-q');
  writeFileSync(join(repository, 'tracked.txt'), 'first\nsecond\n');
  git(repository, 'add', 'tracked.txt');
  git(repository, '-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Initial');
  const database = join(appData, 'studio.sqlite');
  const store = new StudioStore(database);
  const project = store.createProject({ name: 'Synthetic diff', path: repository });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Review me' });
  return { root, repository, database, store, project, card };
}

describe('card diff review', () => {
  it('shows tracked changes and persists a line comment, then rejects a stale preview', () => {
    const { store, database, repository, card } = fixture();
    expect(previewCardDiff(store, card.id)).toBeNull();
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, 'tracked.txt'), 'first\nchanged\n');
    writeFileSync(join(worktree.path, 'untracked.txt'), 'not in preview');
    const preview = previewCardDiff(store, card.id)!;
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]?.path).toBe('tracked.txt');
    expect(preview.files[0]?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'removed', oldLine: 2, text: 'second' }),
      expect.objectContaining({ kind: 'added', newLine: 2, text: 'changed' }),
    ]));
    expect(preview.warnings.join(' ')).toContain('Unversionierte');
    expect(preview.files[0]?.lines.some((line) => line.text.includes('not in preview'))).toBe(false);
    const saved = createReviewComment(store, { cardId: card.id, fingerprint: preview.fingerprint,
      filePath: 'tracked.txt', side: 'new', line: 2, body: '  Check this wording.  ' });
    expect(saved.body).toBe('Check this wording.');
    expect(listReviewComments(store, card.id)).toEqual([saved]);
    expect(readFileSync(join(repository, 'tracked.txt'), 'utf8')).toBe('first\nsecond\n');
    store.close();
    const reopened = new StudioStore(database);
    expect(listReviewComments(reopened, card.id)).toEqual([saved]);
    writeFileSync(join(worktree.path, 'tracked.txt'), 'first\nchanged again\n');
    const newer = previewCardDiff(reopened, card.id)!;
    expect(newer.fingerprint).not.toBe(preview.fingerprint);
    expect(() => createReviewComment(reopened, { cardId: card.id, fingerprint: preview.fingerprint,
      filePath: 'tracked.txt', side: 'new', line: 2, body: 'Stale' })).toThrow('seit der Vorschau geändert');
    expect(listReviewComments(reopened, card.id)).toEqual([saved]);
    reopened.close();
  });

  it('validates anchor and bounds before inserting', () => {
    const { store, card } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, 'tracked.txt'), 'first\nreplacement\n');
    const preview = previewCardDiff(store, card.id)!;
    const candidate = { cardId: card.id, fingerprint: preview.fingerprint, filePath: 'tracked.txt', side: 'new' as const, line: 2, body: 'Check.' };
    expect(() => createReviewComment(store, { ...candidate, filePath: '../outside' })).toThrow('nicht mehr vorhanden');
    expect(() => createReviewComment(store, { ...candidate, line: 99 })).toThrow('nicht mehr vorhanden');
    expect(() => createReviewComment(store, { ...candidate, body: 'x'.repeat(2_001) })).toThrow('ungültig');
    expect(listReviewComments(store, card.id)).toHaveLength(0);
    store.close();
  });

  it('fails closed for a diff larger than the preview limit', () => {
    const { store, card } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, 'tracked.txt'), 'x'.repeat(300_000));
    expect(() => previewCardDiff(store, card.id)).toThrow('zu groß');
    expect(existsSync(join(worktree.path, 'tracked.txt'))).toBe(true);
    store.close();
  });

  it('shows a binary change without inventing commentable text lines', () => {
    const { store, card, repository } = fixture();
    writeFileSync(join(repository, 'image.bin'), Buffer.from([0, 1, 2, 3]));
    git(repository, 'add', 'image.bin');
    git(repository, '-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Add binary fixture');
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, 'image.bin'), Buffer.from([0, 7, 8, 9]));
    const preview = previewCardDiff(store, card.id)!;
    const image = preview.files.find((file) => file.path === 'image.bin');
    expect(image?.lines.map((line) => line.text).join(' ')).toContain('Binary files');
    expect(image?.lines.every((line) => line.newLine === null && line.oldLine === null)).toBe(true);
    store.close();
  });

  it('does not confuse changed text resembling diff headers with file paths', () => {
    const { store, card, repository } = fixture();
    writeFileSync(join(repository, 'tracked.txt'), 'first\n-- a/fake\n');
    git(repository, 'add', 'tracked.txt');
    git(repository, '-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Header-like source');
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, 'tracked.txt'), 'first\n++ b/fake\n');
    const preview = previewCardDiff(store, card.id)!;
    expect(preview.files[0]?.path).toBe('tracked.txt');
    expect(preview.files[0]?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'removed', text: '-- a/fake' }),
      expect.objectContaining({ kind: 'added', text: '++ b/fake' }),
    ]));
    store.close();
  });

  it('anchors a comment to a tracked file whose name contains spaces', () => {
    const { store, card, repository } = fixture();
    const name = 'draft with spaces.txt';
    writeFileSync(join(repository, name), 'before\n');
    git(repository, 'add', name);
    git(repository, '-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Add spaced path');
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, name), 'after\n');
    const preview = previewCardDiff(store, card.id)!;
    expect(preview.files.find((file) => file.path === name)?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'added', newLine: 1, text: 'after' }),
    ]));
    const saved = createReviewComment(store, { cardId: card.id, fingerprint: preview.fingerprint,
      filePath: name, side: 'new', line: 1, body: 'Spaced name anchor.' });
    expect(listReviewComments(store, card.id)).toContainEqual(saved);
    store.close();
  });

  it('rejects ambiguous quoted Git paths instead of assigning comments to the wrong file', () => {
    const raw = 'diff --git "a/quoted \\"name\\".txt" "b/quoted \\"name\\".txt"\n'
      + '--- "a/quoted \\"name\\".txt"\n+++ "b/quoted \\"name\\".txt"\n'
      + '@@ -1 +1 @@\n-before\n+after\n';
    expect(() => parseCardDiff(raw)).toThrow('nicht unterstützten Dateipfad');
  });
});
