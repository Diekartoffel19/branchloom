import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { MemoryGitCommit, MemoryGitSource, MemoryGitSourceState } from '../shared/memory-git-source';
import { parseChangelogLog } from './changelog';
import type { StudioStore } from './store';

interface SourceRow { note_id: string; project_id: string; repository: string; commit_hash: string; subject: string; committed_at: string; attached_at: string }
const HASH = /^[a-f0-9]{40,64}$/i;
const GIT_TIMEOUT_MS = 5_000;

export function installMemoryGitSources(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS memory_git_sources (
    note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repository TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    subject TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    attached_at TEXT NOT NULL
  );`);
}

function git(cwd: string, args: string[]): Promise<{ output: string; exit: number }> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args], {
      cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 256_000, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout) => {
      if (error?.killed || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { reject(new Error('Git-Quellenprüfung überschritt das Zeit- oder Größenlimit.')); return; }
      if (error?.code === 'ENOENT') { reject(new Error('Git ist nicht installiert oder nicht erreichbar.')); return; }
      if (stdout.includes('\uFFFD')) { reject(new Error('Git-Quelle enthält unlesbare Zeichen.')); return; }
      const exit = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      resolve({ output: stdout.trim(), exit });
    });
  });
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function repositoryFor(store: StudioStore, projectId: string): Promise<string> {
  const project = store.project(projectId);
  const result = await git(project.path, ['rev-parse', '--show-toplevel']);
  if (result.exit !== 0 || !result.output) throw new Error('Der Projektordner gehört zu keinem lesbaren Git-Repository.');
  return realpath(result.output);
}

function checkedNote(store: StudioStore, projectId: string, noteId: string): void {
  if (!projectId || !noteId || store.note(noteId).projectId !== projectId) throw new Error('Memory-Notiz gehört nicht zu diesem Projekt.');
}

function validatedCommit(value: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('Ungültiger vollständiger Git-Commit-Hash.');
  return value.toLowerCase();
}

/** Candidates are intentionally limited to the current project HEAD history. */
export async function memoryGitCandidates(store: StudioStore, projectId: string): Promise<MemoryGitCommit[]> {
  const repository = await repositoryFor(store, projectId);
  const result = await git(repository, ['log', '--no-show-signature', '--no-decorate', '--no-ext-diff', '-z', '--max-count=20', '--format=%H%x00%cI%x00%s%x00', 'HEAD']);
  if (result.exit !== 0) throw new Error('Die aktuelle Git-Historie konnte nicht gelesen werden.');
  // trim() removes whitespace, not NUL record delimiters.
  return parseChangelogLog(result.output).map(({ hash, subject, committedAt }) => ({ hash, subject: subject.slice(0, 300), committedAt }));
}

async function commitDetails(repository: string, hash: string): Promise<MemoryGitCommit> {
  const result = await git(repository, ['show', '-s', '--no-show-signature', '--format=%H%x00%cI%x00%s', hash]);
  if (result.exit !== 0) throw new Error('Der ausgewählte Git-Commit ist nicht mehr verfügbar.');
  const [actual, committedAt, subject] = result.output.split('\0');
  if (actual?.toLowerCase() !== hash || !committedAt || !Number.isFinite(Date.parse(committedAt)) || !subject?.trim()) {
    throw new Error('Der ausgewählte Git-Commit konnte nicht eindeutig gelesen werden.');
  }
  return { hash, committedAt, subject: subject.slice(0, 300) };
}

export async function attachMemoryGitSource(store: StudioStore, input: { projectId: string; noteId: string; commit: string }): Promise<MemoryGitSource> {
  checkedNote(store, input.projectId, input.noteId);
  const hash = validatedCommit(input.commit);
  const repository = await repositoryFor(store, input.projectId);
  const ancestor = await git(repository, ['merge-base', '--is-ancestor', hash, 'HEAD']);
  if (ancestor.exit !== 0) throw new Error('Der Commit gehört nicht mehr zur aktuellen Projekt-Historie. Bitte Auswahl aktualisieren.');
  const details = await commitDetails(repository, hash);
  // Recheck after reading metadata so a moving HEAD cannot silently accept an old preview.
  const rechecked = await git(repository, ['merge-base', '--is-ancestor', hash, 'HEAD']);
  if (rechecked.exit !== 0) throw new Error('Die Projekt-Historie hat sich geändert. Bitte Auswahl aktualisieren.');
  checkedNote(store, input.projectId, input.noteId);
  const attachedAt = new Date().toISOString();
  store.db.prepare(`INSERT INTO memory_git_sources (note_id, project_id, repository, commit_hash, subject, committed_at, attached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(note_id) DO UPDATE SET project_id=excluded.project_id, repository=excluded.repository,
      commit_hash=excluded.commit_hash, subject=excluded.subject, committed_at=excluded.committed_at, attached_at=excluded.attached_at`)
    .run(input.noteId, input.projectId, repository, hash, details.subject, details.committedAt, attachedAt);
  return { ...details, noteId: input.noteId, attachedAt, state: 'in-history' };
}

export async function memoryGitSource(store: StudioStore, input: { projectId: string; noteId: string }): Promise<MemoryGitSource | null> {
  checkedNote(store, input.projectId, input.noteId);
  const row = store.db.prepare('SELECT * FROM memory_git_sources WHERE note_id = ? AND project_id = ?').get(input.noteId, input.projectId) as SourceRow | undefined;
  if (!row) return null;
  let state: MemoryGitSourceState = 'unavailable';
  try {
    const repository = await repositoryFor(store, input.projectId);
    if (!samePath(repository, row.repository)) state = 'repository-changed';
    else {
      const type = await git(repository, ['cat-file', '-t', row.commit_hash]);
      if (type.exit !== 0 || type.output !== 'commit') state = 'missing';
      else {
        const ancestor = await git(repository, ['merge-base', '--is-ancestor', row.commit_hash, 'HEAD']);
        state = ancestor.exit === 0 ? 'in-history' : ancestor.exit === 1 ? 'outside-history' : 'unavailable';
      }
    }
  } catch { /* Keep the stored citation visible when Git or the project is unavailable. */ }
  return { noteId: row.note_id, hash: row.commit_hash, subject: row.subject, committedAt: row.committed_at, attachedAt: row.attached_at, state };
}

export function removeMemoryGitSource(store: StudioStore, input: { projectId: string; noteId: string }): void {
  checkedNote(store, input.projectId, input.noteId);
  store.db.prepare('DELETE FROM memory_git_sources WHERE note_id = ? AND project_id = ?').run(input.noteId, input.projectId);
}
