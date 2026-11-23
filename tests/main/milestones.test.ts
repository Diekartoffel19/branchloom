import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { checkoutMilestone, compareMilestone, createMilestone, listMilestones } from '../../src/main/milestones';

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
