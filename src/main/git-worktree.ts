import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { CardWorktree, StudioStore } from './store';

function git(cwd: string, args: string[], timeout = 30_000): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || 'Git-Aufruf fehlgeschlagen').trim().slice(0, 500);
    throw new Error(`Git-Worktree: ${detail}`);
  }
  return result.stdout.trim();
}

function within(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === '' || (part !== '..' && !part.startsWith(`..\\`) && !part.startsWith('../') && !isAbsolute(part));
}

function gitRoot(path: string): string {
  try { return realpathSync(git(path, ['rev-parse', '--show-toplevel'])); }
  catch { throw new Error('Für einen isolierten Worktree muss der Projektordner in einem Git-Repository liegen.'); }
}

function commonDir(path: string): string {
  const value = git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return realpathSync(value);
}

function sameDirectory(first: string, second: string): boolean {
  const left = statSync(first, { bigint: true });
  const right = statSync(second, { bigint: true });
  // Git can emit an 8.3 Windows path for one checkout and a long path for
  // another. File identity is more reliable than comparing their spellings.
  if (left.ino !== 0n && right.ino !== 0n) return left.dev === right.dev && left.ino === right.ino;
  const a = realpathSync.native(first);
  const b = realpathSync.native(second);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function verifyExisting(record: CardWorktree, sourceRoot: string, expectedPath: string): void {
  if (resolve(record.sourceRoot) !== resolve(sourceRoot) || resolve(record.path) !== resolve(expectedPath)) throw new Error('Der gespeicherte Worktree gehört nicht mehr zu diesem Projekt.');
  if (!existsSync(record.path) || lstatSync(record.path).isSymbolicLink() || !statSync(record.path).isDirectory()) throw new Error('Der gespeicherte Worktree fehlt oder wurde ersetzt. Keine Dateien wurden gelöscht.');
  if (!sameDirectory(gitRoot(record.path), record.path) || !sameDirectory(commonDir(record.path), commonDir(sourceRoot))) throw new Error('Der Worktree gehört zu einem anderen Git-Repository.');
  if (git(record.path, ['rev-parse', '--symbolic-full-name', 'HEAD']) !== `refs/heads/${record.branch}`) throw new Error('Der Worktree steht nicht mehr auf seinem Karten-Branch.');
}

/** Create or reuse an isolated, per-card checkout. Never remove a worktree or reset its branch. */
export function ensureCardWorktree(store: StudioStore, cardId: string): { path: string; cwd: string; branch: string } {
  const card = store.card(cardId);
  const project = store.project(card.projectId);
  const sourceRoot = gitRoot(project.path);
  git(sourceRoot, ['rev-parse', '--verify', 'HEAD']);
  const parent = join(store.worktreeBase, project.id);
  if (within(sourceRoot, parent)) throw new Error('Der Worktree-Speicherort liegt im Projekt-Repository.');
  mkdirSync(parent, { recursive: true });
  if (within(sourceRoot, realpathSync(parent))) throw new Error('Der Worktree-Speicherort verweist ins Projekt-Repository.');
  const path = join(parent, card.id);
  const branch = `jarvis/card-${card.id}`;
  const old = store.cardWorktree(card.id);
  if (old) verifyExisting(old, sourceRoot, path);
  else if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Der Worktree-Pfad ist ein symbolischer Link.');
    // Recovery if Git completed checkout but the app stopped before recording it.
    verifyExisting({ cardId, projectId: project.id, sourceRoot, path, branch, createdAt: '' }, sourceRoot, path);
    store.saveCardWorktree({ cardId, projectId: project.id, sourceRoot, path, branch });
  } else {
    // Generated UUID path and branch, argument array, no shell and no -B/--force.
    // A failed checkout is left untouched so valuable partial files are not lost.
    git(sourceRoot, ['worktree', 'add', '-b', branch, path, 'HEAD'], 120_000);
    verifyExisting({ cardId, projectId: project.id, sourceRoot, path, branch, createdAt: '' }, sourceRoot, path);
    store.saveCardWorktree({ cardId, projectId: project.id, sourceRoot, path, branch });
  }
  const subdirectory = relative(sourceRoot, project.path);
  const cwd = join(path, subdirectory);
  if (!within(path, cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('Das Projekt-Unterverzeichnis fehlt im Worktree.');
  return { path, cwd, branch };
}
