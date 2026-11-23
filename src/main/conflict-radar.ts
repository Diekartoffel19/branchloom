import { execFile } from 'node:child_process';
import { lstat, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConflictRadarPeer, ConflictRadarResult } from '../shared/conflict-radar';
import type { Session } from '../shared/types';
import type { StudioStore } from './store';

const MAX_PATHS = 5_000;
const MAX_OUTPUT = 2 * 1024 * 1024;
const CHECK_BUDGET_MS = 20_000;

function git(cwd: string, args: string[], deadline: number): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('Zeitlimit für die Konfliktprüfung erreicht.'));
  return new Promise<string>((resolveResult, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: Math.min(4_000, remaining),
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout) => {
      if (error) { reject(new Error('Git-Status konnte nicht vollständig gelesen werden.')); return; }
      if (stdout.includes('\uFFFD')) { reject(new Error('Git-Pfadkodierung ist nicht eindeutig.')); return; }
      resolveResult(stdout);
    });
  });
}

function names(output: string): string[] {
  if (!output) return [];
  if (!output.endsWith('\0')) throw new Error('Git-Pfadausgabe ist unvollständig.');
  const paths = output.slice(0, -1).split('\0');
  if (paths.length > MAX_PATHS || paths.some((path) => !path || path.includes('\uFFFD'))) throw new Error('Zu viele oder unlesbare Git-Pfade.');
  return paths;
}

function normalize(path: string): string {
  const value = process.platform === 'win32' ? path.replaceAll('\\', '/') : path;
  if (!value || value.startsWith('/') || value.split('/').some((piece) => piece === '..' || piece === '.')) throw new Error('Git lieferte einen ungültigen Pfad.');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function worktreePaths(output: string): string[] {
  return names(output).map((line) => {
    if (!/^[ MADRCU?!]{2} /.test(line) || line.length < 4) throw new Error('Git-Status hat ein unbekanntes Format.');
    return line.slice(3);
  });
}

/** All observed working and committed changes since the worktree split from the target branch. */
export async function changedPaths(worktreePath: string, targetPath: string, deadline = Date.now() + CHECK_BUDGET_MS): Promise<Set<string>> {
  const targetHead = (await git(targetPath, ['rev-parse', '--verify', 'HEAD'], deadline)).trim();
  const common = (await git(worktreePath, ['merge-base', 'HEAD', targetHead], deadline)).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(common)) throw new Error('Gemeinsamer Git-Stand fehlt.');
  const committed = names(await git(worktreePath, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', `${common}..HEAD`], deadline));
  const working = worktreePaths(await git(worktreePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], deadline));
  const paths = new Set([...committed, ...working].map(normalize));
  if (paths.size > MAX_PATHS) throw new Error('Zu viele geänderte Git-Pfade.');
  return paths;
}

async function samePath(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([stat(left, { bigint: true }), stat(right, { bigint: true })]);
  if (leftStat.ino !== 0n && rightStat.ino !== 0n) return leftStat.ino === rightStat.ino && leftStat.dev === rightStat.dev;
  const [a, b] = await Promise.all([realpath(left), realpath(right)]);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function verifiedWorktree(store: StudioStore, session: Session, targetRoot: string, targetCommon: string, deadline: number): Promise<string> {
  if (!session.worktreePath) throw new Error('Sitzung verwendet keinen isolierten Worktree.');
  const record = store.cardWorktree(session.cardId);
  if (!record || record.projectId !== session.projectId) throw new Error('Gespeicherter Karten-Worktree fehlt.');
  if ((await lstat(record.path)).isSymbolicLink()) throw new Error('Der Worktree-Pfad ist ein symbolischer Link.');
  const expected = join(store.worktreeBase, session.projectId, session.cardId);
  if (!await samePath(record.path, expected) || !await samePath(record.path, session.worktreePath)
    || !await samePath(record.sourceRoot, targetRoot)) throw new Error('Sitzungs-Worktree ist nicht mehr eindeutig zugeordnet.');
  const actualRoot = (await git(record.path, ['rev-parse', '--show-toplevel'], deadline)).trim();
  const actualCommon = (await git(record.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'], deadline)).trim();
  const branch = (await git(record.path, ['rev-parse', '--symbolic-full-name', 'HEAD'], deadline)).trim();
  if (!await samePath(actualRoot, record.path) || !await samePath(actualCommon, targetCommon)
    || branch !== `refs/heads/${record.branch}`) throw new Error('Worktree gehört nicht mehr zum erwarteten Projekt und Branch.');
  return record.path;
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  const common: string[] = [];
  const sortedRight = [...right].sort();
  for (const item of left) {
    let shared = right.has(item);
    for (let slash = item.indexOf('/'); !shared && slash >= 0; slash = item.indexOf('/', slash + 1)) shared = right.has(item.slice(0, slash));
    if (!shared) {
      const prefix = `${item}/`;
      let low = 0;
      let high = sortedRight.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (sortedRight[middle]! < prefix) low = middle + 1;
        else high = middle;
      }
      shared = sortedRight[low]?.startsWith(prefix) ?? false;
    }
    if (shared) common.push(item);
  }
  return common.sort();
}

/** Read-only snapshot. Never starts, stops, merges or changes an agent session. */
export async function reviewCardConflicts(store: StudioStore, cardId: string, running: Session[]): Promise<ConflictRadarResult> {
  const card = store.card(cardId);
  const checkedAt = new Date().toISOString();
  const current = running.find((item) => item.cardId === cardId && item.projectId === card.projectId && item.state === 'running');
  if (!current) return { cardId, sessionId: null, checkedAt, state: 'idle', ownChangedCount: null, peers: [], reason: 'Diese Karte hat derzeit keinen laufenden Agenten.' };
  const otherRuns = running.filter((item) => item.cardId !== cardId && item.projectId === card.projectId && item.state === 'running');
  if (!otherRuns.length) return { cardId, sessionId: current.id, checkedAt, state: 'clear', ownChangedCount: null, peers: [], reason: 'Keine weitere Karte hat gerade einen laufenden Agenten.' };
  if (otherRuns.length > 20) return { cardId, sessionId: current.id, checkedAt, state: 'unknown', ownChangedCount: null, peers: [], reason: 'Mehr als 20 parallele Sitzungen; diese Prüfung wäre unvollständig.' };

  const project = store.project(card.projectId);
  const deadline = Date.now() + CHECK_BUDGET_MS;
  let ownPaths: Set<string> | null = null;
  let ownReason: string | null = null;
  let targetRoot = '';
  let targetCommon = '';
  try {
    targetRoot = (await git(project.path, ['rev-parse', '--show-toplevel'], deadline)).trim();
    targetCommon = (await git(targetRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'], deadline)).trim();
    const path = await verifiedWorktree(store, current, targetRoot, targetCommon, deadline);
    ownPaths = await changedPaths(path, targetRoot, deadline);
  } catch (error) { ownReason = error instanceof Error ? error.message : 'Git-Prüfung fehlgeschlagen.'; }

  const peers: ConflictRadarPeer[] = [];
  for (const peer of otherRuns) {
    let cardTitle = 'Unbekannte Karte';
    try {
      cardTitle = store.card(peer.cardId).title;
      if (!ownPaths) throw new Error(ownReason ?? 'Diese Karte konnte nicht geprüft werden.');
      if (!peer.worktreePath) throw new Error('Andere Sitzung verwendet keinen isolierten Worktree.');
      const path = await verifiedWorktree(store, peer, targetRoot, targetCommon, deadline);
      if (await samePath(current.worktreePath!, peer.worktreePath)) throw new Error('Beide Sitzungen teilen denselben Worktree.');
      const otherPaths = await changedPaths(path, targetRoot, deadline);
      const commonPaths = overlap(ownPaths, otherPaths);
      peers.push({ cardId: peer.cardId, cardTitle, sessionId: peer.id, state: commonPaths.length ? 'overlap' : 'clear', changedCount: otherPaths.size, commonPaths: commonPaths.slice(0, 30), commonCount: commonPaths.length, reason: null });
    } catch (error) {
      peers.push({ cardId: peer.cardId, cardTitle, sessionId: peer.id, state: 'unknown', changedCount: null, commonPaths: [], commonCount: 0, reason: error instanceof Error ? error.message : 'Git-Prüfung fehlgeschlagen.' });
    }
  }
  const state = peers.some((peer) => peer.state === 'overlap') ? 'overlap' : peers.some((peer) => peer.state === 'unknown') ? 'unknown' : 'clear';
  return { cardId, sessionId: current.id, checkedAt, state, ownChangedCount: ownPaths?.size ?? null, peers, reason: ownReason };
}
