import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { StudioStore } from '../../src/main/store';
import { checkoutMilestone, compareMilestone, createMilestone, createMilestoneWithPreview, listMilestones, milestonePreviewImage } from '../../src/main/milestones';
import { normalizeMilestonePreviewUrl } from '../../src/main/milestone-preview';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nAAAAABJRU5ErkJggg==', 'base64');
const localUrl = 'http://127.0.0.1:5173/preview?token=synthetic';
const captured = () => ({ png: tinyPng, source: `${localUrl}#state`, capturedAt: '2026-01-01T00:00:00.000Z' });

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* The test may already have closed it. */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-milestones-test-'));
  roots.push(root);
  const projectPath = join(root, 'project');
  const dataPath = join(root, 'local');
  mkdirSync(projectPath); mkdirSync(dataPath);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: projectPath, encoding: 'utf8', windowsHide: true });
  git('init', '-q');
  writeFileSync(join(projectPath, 'README.md'), 'first\n');
  git('add', 'README.md');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'First');
  const file = join(dataPath, 'studio.sqlite');
  const store = new StudioStore(file);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: projectPath });
  return { root, projectPath, store, project, file, git };
}

describe('manual Git milestones', () => {
  it('keeps exact commit and label across app restart, compares real commits, and opens an isolated checkout', () => {
    const { projectPath, store, project, file, git } = setup();
    const first = createMilestone(store, { projectId: project.id, label: '  Erste Abnahme  ' });
    expect(first.label).toBe('Erste Abnahme');
    expect(first.commit).toBe(git('rev-parse', 'HEAD').trim());
    expect(listMilestones(store, project.id)).toEqual([first]);
    expect(compareMilestone(store, { projectId: project.id, milestoneId: first.id }).changedFiles).toEqual([]);
    store.close();

    const reopened = new StudioStore(file);
    stores.push(reopened);
    expect(listMilestones(reopened, project.id)).toEqual([first]);
    writeFileSync(join(projectPath, 'README.md'), 'second\n');
    git('add', 'README.md');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Second');
    const comparison = compareMilestone(reopened, { projectId: project.id, milestoneId: first.id });
    expect(comparison.currentCommit).not.toBe(first.commit);
    expect(comparison.isAncestor).toBe(true);
    expect(comparison.workingTreeClean).toBe(true);
    expect(comparison.changedFiles).toEqual([{ status: 'M', path: 'README.md' }]);
    expect(() => checkoutMilestone(reopened, { projectId: project.id, milestoneId: first.id, confirm: false })).toThrow('Bestätigung');
    const isolated = checkoutMilestone(reopened, { projectId: project.id, milestoneId: first.id, confirm: true });
    expect(relative(projectPath, isolated.path).startsWith('..')).toBe(true);
    expect(isolated.commit).toBe(first.commit);
    expect(isolated.reused).toBe(false);
    expect(isolated.workingTreeClean).toBe(true);
    expect(git('rev-parse', 'HEAD').trim()).toBe(comparison.currentCommit);
    expect(checkoutMilestone(reopened, { projectId: project.id, milestoneId: first.id, confirm: true }).reused).toBe(true);
    writeFileSync(join(isolated.path, 'README.md'), 'local checkout edit\n');
    expect(checkoutMilestone(reopened, { projectId: project.id, milestoneId: first.id, confirm: true }).workingTreeClean).toBe(false);
    reopened.close();
  });

  it('rejects dirty source, forged project, changed local refs, and subfolder projects', () => {
    const { projectPath, store, project, git } = setup();
    writeFileSync(join(projectPath, 'untracked.txt'), 'unsaved');
    expect(() => createMilestone(store, { projectId: project.id, label: 'Dirty' })).toThrow('Arbeitsbaum');
    rmSync(join(projectPath, 'untracked.txt'));
    expect(() => createMilestone(store, { projectId: project.id, label: '\n' })).toThrow('Name');
    const item = createMilestone(store, { projectId: project.id, label: 'Safe' });
    expect(() => compareMilestone(store, { projectId: 'another', milestoneId: item.id })).toThrow();
    git('update-ref', '-d', `refs/branchloom/milestones/${item.id}`);
    expect(() => compareMilestone(store, { projectId: project.id, milestoneId: item.id })).toThrow('Verweis');
    const nested = join(projectPath, 'nested'); mkdirSync(nested);
    const other = store.createProject({ name: 'Nested', path: nested });
    expect(() => createMilestone(store, { projectId: other.id, label: 'Nested' })).toThrow('Repository-Stamm');
    store.close();
  });
});

describe('optional local milestone screenshots', () => {
  it('saves a bounded image with the Git marker across restart and isolates access by project', async () => {
    const { store, project, file, root } = setup();
    const marked = await createMilestoneWithPreview(store, { projectId: project.id, label: 'Mit Bild', url: localUrl }, async () => captured());
    expect(marked.previewAvailable).toBe(true);
    expect(marked.previewSource).toBe('http://127.0.0.1:5173/preview');
    expect(marked.previewCapturedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(milestonePreviewImage(store, { projectId: project.id, milestoneId: marked.id })).toBe(`data:image/png;base64,${tinyPng.toString('base64')}`);
    const otherPath = join(root, 'other-project'); mkdirSync(otherPath);
    const second = store.createProject({ name: 'Other', path: otherPath });
    expect(() => milestonePreviewImage(store, { projectId: second.id, milestoneId: marked.id })).toThrow('nicht gefunden');
    store.close();
    const reopened = new StudioStore(file); stores.push(reopened);
    expect(listMilestones(reopened, project.id)).toEqual([marked]);
    expect(milestonePreviewImage(reopened, { projectId: project.id, milestoneId: marked.id })).toContain(tinyPng.toString('base64'));
  });

  it('migrates old milestone rows without removing their Git references', () => {
    const { store, project, file } = setup();
    const legacy = createMilestone(store, { projectId: project.id, label: 'Vor Update' });
    store.close();
    const db = new Database(file);
    db.exec('ALTER TABLE project_milestones DROP COLUMN preview_png; ALTER TABLE project_milestones DROP COLUMN preview_source; ALTER TABLE project_milestones DROP COLUMN preview_captured_at;');
    db.close();
    const reopened = new StudioStore(file); stores.push(reopened);
    expect(listMilestones(reopened, project.id)).toEqual([legacy]);
    expect(legacy.previewAvailable).toBe(false);
    expect(() => milestonePreviewImage(reopened, { projectId: project.id, milestoneId: legacy.id })).toThrow('kein gültiges Vorschau-Bild');
    expect(compareMilestone(reopened, { projectId: project.id, milestoneId: legacy.id }).currentCommit).toBe(legacy.commit);
  });

  it('rejects foreign URLs and invalid captures before a Git marker is saved', async () => {
    const { store, project, git } = setup();
    for (const url of ['https://example.invalid/', 'http://192.168.1.2:5173/', 'file:///C:/secret', 'http://user:pass@127.0.0.1/']) {
      expect(() => normalizeMilestonePreviewUrl(url)).toThrow();
    }
    let invoked = false;
    await expect(createMilestoneWithPreview(store, { projectId: project.id, label: 'External', url: 'https://example.invalid/' }, async () => { invoked = true; return captured(); })).rejects.toThrow('localhost');
    expect(invoked).toBe(false);
    await expect(createMilestoneWithPreview(store, { projectId: project.id, label: 'Oversize', url: localUrl }, async () => ({ ...captured(), png: Buffer.alloc(1_000_001) }))).rejects.toThrow('ungültig');
    await expect(createMilestoneWithPreview(store, { projectId: project.id, label: 'Wrong origin', url: localUrl }, async () => ({ ...captured(), source: 'http://localhost:5173/' }))).rejects.toThrow('Origin');
    expect(listMilestones(store, project.id)).toEqual([]);
    expect(git('for-each-ref', '--format=%(refname)', 'refs/branchloom/milestones')).toBe('');
  });

  it('rejects a commit changed during capture without saving a stale milestone', async () => {
    const { store, project, projectPath, git } = setup();
    await expect(createMilestoneWithPreview(store, { projectId: project.id, label: 'Moving target', url: localUrl }, async () => {
      writeFileSync(join(projectPath, 'README.md'), 'changed during screenshot\n');
      git('add', 'README.md');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Second');
      return captured();
    })).rejects.toThrow('während der Vorschauaufnahme geändert');
    expect(listMilestones(store, project.id)).toEqual([]);
    expect(git('for-each-ref', '--format=%(refname)', 'refs/branchloom/milestones')).toBe('');
  });
});
