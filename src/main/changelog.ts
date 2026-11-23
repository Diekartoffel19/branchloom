import { execFile } from 'node:child_process';
import type { ChangelogCommit, ChangelogPeriod, ProjectChangelog } from '../shared/changelog';
import type { StudioStore } from './store';

const MAX_VISIBLE = 100;
const MAX_OUTPUT = 512 * 1024;
const GIT_TIMEOUT_MS = 5_000;

function git(cwd: string, args: string[]): Promise<{ stdout: string; failed: boolean }> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args], {
      cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout) => {
      if (error?.killed || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { reject(new Error('Git-Changelog überschritt das Zeit- oder Größenlimit.')); return; }
      if (error && error.code === 'ENOENT') { reject(new Error('Git ist nicht installiert oder nicht erreichbar.')); return; }
      if (stdout.includes('\uFFFD')) { reject(new Error('Git-Historie enthält unlesbare Zeichen.')); return; }
      resolve({ stdout, failed: Boolean(error) });
    });
  });
}

export function parseChangelogLog(output: string): ChangelogCommit[] {
  if (!output) return [];
  if (!output.endsWith('\0\0')) throw new Error('Git-Changelog ist unvollständig.');
  return output.slice(0, -2).split('\0\0').map((record) => {
    const parts = record.split('\0');
    if (parts.length !== 3 || !/^[a-f0-9]{40,64}$/i.test(parts[0]!) || !Number.isFinite(Date.parse(parts[1]!)) || !parts[2]!.trim()) {
      throw new Error('Git-Changelog enthält einen ungültigen Commit.');
    }
    return { hash: parts[0]!, committedAt: parts[1]!, subject: parts[2]! };
  });
}

export function limitChangelogCommits(all: ChangelogCommit[]): { commits: ChangelogCommit[]; moreAvailable: boolean } {
  return { commits: all.slice(0, MAX_VISIBLE), moreAvailable: all.length > MAX_VISIBLE };
}

/** Read-only history of commits reachable from this project's current HEAD. */
export async function projectChangelog(store: StudioStore, projectId: string, period: ChangelogPeriod, now = new Date()): Promise<ProjectChangelog> {
  if (period !== 'day' && period !== 'week') throw new Error('Ungültiger Changelog-Zeitraum.');
  if (!Number.isFinite(now.getTime())) throw new Error('Ungültiger Prüfzeitpunkt.');
  const project = store.project(projectId);
  const checkedAt = now.toISOString();
  const since = new Date(now.getTime() - (period === 'day' ? 24 : 7 * 24) * 60 * 60 * 1_000).toISOString();
  const base = { projectId, period, since, until: checkedAt, checkedAt, head: null, commits: [] as ChangelogCommit[], moreAvailable: false };
  const inside = await git(project.path, ['rev-parse', '--is-inside-work-tree']);
  if (inside.failed || inside.stdout.trim() !== 'true') return { ...base, state: 'no-repository' };
  const head = await git(project.path, ['rev-parse', '--verify', 'HEAD']);
  if (head.failed) return { ...base, state: 'no-commits' };
  const hash = head.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/i.test(hash)) throw new Error('Git-HEAD ist ungültig.');
  const result = await git(project.path, [
    'log', '--no-show-signature', '--no-decorate', '--no-ext-diff', '-z',
    `--since=${since}`, `--until=${checkedAt}`, `--max-count=${MAX_VISIBLE + 1}`,
    '--format=%H%x00%cI%x00%s%x00', 'HEAD',
  ]);
  if (result.failed) throw new Error('Git-Changelog konnte nicht gelesen werden.');
  const all = parseChangelogLog(result.stdout);
  return { ...base, state: 'ready', head: hash, ...limitChangelogCommits(all) };
}
