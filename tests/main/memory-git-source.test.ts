import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachMemoryGitSource, memoryGitCandidates, memoryGitSource, removeMemoryGitSource } from '../../src/main/memory-git-source';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-memory-git-'));
  roots.push(root);
  const repository = join(root, 'repository');
  mkdirSync(repository);
  git(repository, 'init', '-q');
  const file = join(repository, 'README.md');
  writeFileSync(file, 'First synthetic revision\n');
  git(repository, 'add', 'README.md');
  git(repository, '-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial synthetic work');
  const firstHash = git(repository, 'rev-parse', 'HEAD');
  writeFileSync(file, 'Second synthetic revision\n');
  git(repository, 'add', 'README.md');
  git(repository, '-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Improve synthetic memory');
  const latestHash = git(repository, 'rev-parse', 'HEAD');
  const database = join(root, 'studio.sqlite');
  const store = new StudioStore(database);
  const project = store.createProject({ name: 'Synthetic memory', path: repository });
  const note = store.saveNote({ projectId: project.id, title: 'Decision', body: 'Only local test data', tags: [], links: [] });
  return { root, repository, database, store, project, note, firstHash, latestHash };
}

describe('explicit Memory Git source', () => {
  it('lists bounded current history, stores an exact commit and checks it again after database restart', async () => {
    const item = fixture();
    try {
      const candidates = await memoryGitCandidates(item.store, item.project.id);
      expect(candidates.map((row) => row.hash)).toEqual([item.latestHash, item.firstHash]);
      expect(candidates[0]?.subject).toBe('Improve synthetic memory');
      expect(await memoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id })).toBeNull();
      const source = await attachMemoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id, commit: item.firstHash });
      expect(source).toMatchObject({ hash: item.firstHash, state: 'in-history', subject: 'Initial synthetic work' });
      item.store.close();
      const reopened = new StudioStore(item.database);
      try {
        expect(await memoryGitSource(reopened, { projectId: item.project.id, noteId: item.note.id })).toMatchObject({ hash: item.firstHash, state: 'in-history', subject: 'Initial synthetic work' });
        expect(reopened.note(item.note.id).body).toBe('Only local test data');
        removeMemoryGitSource(reopened, { projectId: item.project.id, noteId: item.note.id });
        expect(await memoryGitSource(reopened, { projectId: item.project.id, noteId: item.note.id })).toBeNull();
      } finally { reopened.close(); }
    } finally { if (item.store.db.open) item.store.close(); }
  });

  it('marks an existing commit outside current HEAD history, then a missing commit after repository replacement', async () => {
    const item = fixture();
    try {
      await attachMemoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id, commit: item.latestHash });
      git(item.repository, 'checkout', '--orphan', 'replacement');
      writeFileSync(join(item.repository, 'README.md'), 'New branch root\n');
      git(item.repository, 'add', 'README.md');
      git(item.repository, '-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Other history');
      expect(await memoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id })).toMatchObject({ state: 'outside-history', hash: item.latestHash });
      rmSync(join(item.repository, '.git'), { recursive: true, force: true });
      expect(await memoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id })).toMatchObject({ state: 'unavailable', hash: item.latestHash });
      git(item.root, 'init', '-q');
      expect(await memoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id })).toMatchObject({ state: 'repository-changed', hash: item.latestHash });
      rmSync(join(item.root, '.git'), { recursive: true, force: true });
      git(item.repository, 'init', '-q');
      git(item.repository, 'add', 'README.md');
      git(item.repository, '-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fresh repository');
      expect(await memoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id })).toMatchObject({ state: 'missing', hash: item.latestHash, subject: 'Improve synthetic memory' });
    } finally { item.store.close(); }
  });

  it('rejects wrong project, invalid hashes and a commit from an unmerged branch without replacing the source', async () => {
    const item = fixture();
    try {
      await attachMemoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id, commit: item.firstHash });
      const otherDirectory = join(item.root, 'other');
      mkdirSync(otherDirectory);
      const other = item.store.createProject({ name: 'Other', path: otherDirectory });
      await expect(memoryGitSource(item.store, { projectId: other.id, noteId: item.note.id })).rejects.toThrow('gehört nicht');
      await expect(attachMemoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id, commit: 'HEAD;echo leak' })).rejects.toThrow('Hash');
      const main = git(item.repository, 'branch', '--show-current');
      git(item.repository, 'checkout', '-qb', 'unmerged');
      writeFileSync(join(item.repository, 'README.md'), 'Unmerged branch\n');
      git(item.repository, 'add', 'README.md');
      git(item.repository, '-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Unmerged change');
      const unrelated = git(item.repository, 'rev-parse', 'HEAD');
      git(item.repository, 'checkout', '-q', main);
      await expect(attachMemoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id, commit: unrelated })).rejects.toThrow('aktuellen Projekt-Historie');
      expect(await memoryGitSource(item.store, { projectId: item.project.id, noteId: item.note.id })).toMatchObject({ hash: item.firstHash, state: 'in-history' });
      item.store.deleteNote(item.note.id);
      expect((item.store.db.prepare('SELECT COUNT(*) AS count FROM memory_git_sources').get() as { count: number }).count).toBe(0);
    } finally { item.store.close(); }
  });
});
