import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { limitChangelogCommits, parseChangelogLog, projectChangelog } from '../../src/main/changelog';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function git(cwd: string, args: string[], date?: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function fixture(withGit = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-changelog-'));
  roots.push(root);
  const repository = join(root, 'repository');
  mkdirSync(repository);
  if (withGit) git(repository, ['init', '-q']);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic changelog', path: repository });
  return { repository, store, project };
}

function commit(repository: string, index: number, subject: string, date: string) {
  writeFileSync(join(repository, 'tracked.txt'), `revision ${index}\n`);
  git(repository, ['add', 'tracked.txt']);
  git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', subject], date);
  return git(repository, ['rev-parse', 'HEAD']);
}

describe('project changelog', () => {
  it('reads only reachable HEAD commits in the selected rolling period with exact Git evidence', async () => {
    const { repository, store, project } = fixture();
    try {
      commit(repository, 1, 'Older work', '2026-01-01T10:00:00+00:00');
      const branch = git(repository, ['branch', '--show-current']);
      git(repository, ['checkout', '-qb', 'other-work']);
      const otherHash = commit(repository, 2, 'Unmerged private branch', '2026-01-03T10:00:00+00:00');
      git(repository, ['checkout', '-q', branch]);
      const recentHash = commit(repository, 3, 'Add visible card flow', '2026-01-03T11:00:00+00:00');
      writeFileSync(join(repository, 'untracked.txt'), 'not committed');
      const now = new Date('2026-01-03T12:00:00.000Z');
      const day = await projectChangelog(store, project.id, 'day', now);
      expect(day).toMatchObject({ state: 'ready', period: 'day', head: recentHash, since: '2026-01-02T12:00:00.000Z', until: now.toISOString(), moreAvailable: false });
      expect(day.commits.map((item) => [item.hash, item.subject])).toEqual([[recentHash, 'Add visible card flow']]);
      const week = await projectChangelog(store, project.id, 'week', now);
      expect(week.commits).toHaveLength(2);
      expect(week.commits.some((item) => item.hash === otherHash)).toBe(false);
      expect(week.commits.some((item) => item.subject.includes('untracked'))).toBe(false);
    } finally { store.close(); }
  });

  it('distinguishes non-Git projects and unborn repositories, and rejects bad periods', async () => {
    const without = fixture(false);
    try { expect((await projectChangelog(without.store, without.project.id, 'week')).state).toBe('no-repository'); }
    finally { without.store.close(); }
    const unborn = fixture();
    try {
      expect((await projectChangelog(unborn.store, unborn.project.id, 'week')).state).toBe('no-commits');
      await expect(projectChangelog(unborn.store, unborn.project.id, 'month' as 'week')).rejects.toThrow('Ungültiger');
    } finally { unborn.store.close(); }
  });

  it('bounds a large history and reports when commits are hidden', () => {
    const all = Array.from({ length: 101 }, (_, index) => ({ hash: 'a'.repeat(40), committedAt: '2026-01-03T11:00:00Z', subject: `Revision ${101 - index}` }));
    const result = limitChangelogCommits(all);
    expect(result.commits).toHaveLength(100);
    expect(result.moreAvailable).toBe(true);
    expect(result.commits[0]?.subject).toBe('Revision 101');
  });

  it('rejects truncated and malformed Git records', () => {
    expect(() => parseChangelogLog('bad')).toThrow('unvollständig');
    expect(() => parseChangelogLog('bad\0date\0subject\0\0')).toThrow('ungültigen Commit');
  });
});
