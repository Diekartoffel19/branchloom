import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { previewPrDraft } from '../../src/main/pr-draft';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function commit(cwd: string, file: string, message: string): void {
  writeFileSync(join(cwd, file), message);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', message]);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-pr-draft-'));
  roots.push(root);
  const repository = join(root, 'repo');
  mkdirSync(repository);
  git(repository, ['init', '-q']);
  commit(repository, 'base.txt', 'Base');
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic PR draft', path: repository });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Feature A', description: 'Eine nutzbare Änderung.' });
  const other = store.createCard({ projectId: project.id, columnId, title: 'Other' });
  return { store, project, card, other };
}

describe('read-only PR draft', () => {
  it('requires a real card worktree commit and never creates one while previewing', () => {
    const { store, card } = fixture();
    expect(previewPrDraft(store, card.id)).toBeNull();
    expect(store.cardWorktree(card.id)).toBeNull();
    ensureCardWorktree(store, card.id);
    expect(() => previewPrDraft(store, card.id)).toThrow('noch keinen neuen Commit');
    store.close();
  });

  it('uses Git evidence and labels local QA as unbound to the commit', () => {
    const { store, project, card, other } = fixture();
    const tree = ensureCardWorktree(store, card.id);
    commit(tree.path, 'feature.txt', 'Add feature A');
    const otherTree = ensureCardWorktree(store, other.id);
    commit(otherTree.path, 'other.txt', 'Other change');
    store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, viewport_width, viewport_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('qa-1', card.id, project.id, 'http://127.0.0.1:5173/', '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:01.000Z', 'passed', '[]', 390, 844);
    const preview = previewPrDraft(store, card.id)!;
    expect(preview.reportCount).toBe(1);
    expect(preview.text).toContain('Add feature A');
    expect(preview.text).toContain('`feature.txt`');
    expect(preview.text).toContain('Eine nutzbare Änderung.');
    expect(preview.text).toContain('nicht an diesen Commit gebunden');
    expect(preview.text).toContain('390 × 844');
    expect(preview.text).toContain('Automatisierte Tests: noch nicht');
    expect(preview.text).not.toContain('Other change');
    expect(preview.text).not.toContain('other.txt');
    store.close();
  });
});
