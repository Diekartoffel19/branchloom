import { execFile } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Card } from '../shared/types';
import type { QaGitEvidence } from '../shared/qa-git-evidence';
import type { StudioStore } from './store';

type Point = { scope: QaGitEvidence['scope']; head: string | null; dirty: boolean | null };
const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true', ...args], {
      cwd, encoding: 'utf8', timeout: 3_000, maxBuffer: 64 * 1024, windowsHide: true, shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout.trim();
  } catch { return null; }
}

function sameDirectory(a: string, b: string): boolean {
  try {
    const first = statSync(a, { bigint: true });
    const second = statSync(b, { bigint: true });
    if (first.ino !== 0n && second.ino !== 0n) return first.dev === second.dev && first.ino === second.ino;
    const left = realpathSync.native(a);
    const right = realpathSync.native(b);
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  } catch { return false; }
}

async function verifiedWorktree(store: StudioStore, card: Card): Promise<string | null> {
  const record = store.cardWorktree(card.id);
  if (!record || record.projectId !== card.projectId) return null;
  try {
    if (lstatSync(record.path).isSymbolicLink()
      || !sameDirectory(record.path, join(store.worktreeBase, card.projectId, card.id))) return null;
  } catch { return null; }
  const projectPath = store.project(card.projectId).path;
  const [projectRoot, worktreeRoot, projectCommon, worktreeCommon, branch] = await Promise.all([
    git(projectPath, ['rev-parse', '--show-toplevel']),
    git(record.path, ['rev-parse', '--show-toplevel']),
    git(projectPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(record.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(record.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
  ]);
  if (!projectRoot || !worktreeRoot || !projectCommon || !worktreeCommon || branch !== record.branch
    || !sameDirectory(projectRoot, record.sourceRoot) || !sameDirectory(worktreeRoot, record.path)
    || !sameDirectory(projectCommon, worktreeCommon)) return null;
  return record.path;
}

async function readPoint(cwd: string, scope: Point['scope']): Promise<Point> {
  const [head, status] = await Promise.all([
    git(cwd, ['rev-parse', '--verify', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']),
  ]);
  const checkedHead = await git(cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!head || !checkedHead || head !== checkedHead || !/^[0-9a-f]{40,64}$/i.test(head)) {
    return { scope, head: null, dirty: null };
  }
  return { scope, head, dirty: status === null ? null : status.length > 0 };
}

/** Reads only the checkout associated with this card. It does not inspect or run the preview server. */
export async function qaGitPoint(store: StudioStore, card: Card): Promise<Point> {
  if (store.cardWorktree(card.id)) {
    const path = await verifiedWorktree(store, card);
    if (!path) return { scope: 'card-worktree', head: null, dirty: null };
    return readPoint(path, 'card-worktree');
  }
  return readPoint(store.project(card.projectId).path, 'project');
}

export function qaGitEvidence(start: Point, end: Point): QaGitEvidence {
  const state: QaGitEvidence['state'] = start.head === null || end.head === null || start.dirty === null || end.dirty === null
    ? 'unavailable'
    : start.scope !== end.scope || start.head !== end.head ? 'changed'
      : start.dirty || end.dirty ? 'dirty' : 'clean';
  return { scope: start.scope, startHead: start.head, endHead: end.head,
    dirtyAtStart: start.dirty, dirtyAtEnd: end.dirty, state };
}
