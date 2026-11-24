import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { MilestoneCheckout, MilestoneComparison, ProjectMilestone } from '../shared/milestones';
import { diagnosticSource } from './browser-policy';
import { captureLocalMilestonePreview, normalizeMilestonePreviewUrl, type MilestonePreviewImage } from './milestone-preview';
import type { StudioStore } from './store';

type Row = { id: string; project_id: string; label: string; repository: string; branch: string | null; commit_hash: string; created_at: string; preview_available: number; preview_source: string | null; preview_captured_at: string | null };
const rowColumns = 'id, project_id, label, repository, branch, commit_hash, created_at, preview_source, preview_captured_at, CASE WHEN preview_png IS NOT NULL THEN 1 ELSE 0 END AS preview_available';
const map = (row: Row): ProjectMilestone => ({ id: row.id, projectId: row.project_id, label: row.label, repository: row.repository, branch: row.branch, commit: row.commit_hash, createdAt: row.created_at, previewAvailable: row.preview_available === 1, previewSource: row.preview_source, previewCapturedAt: row.preview_captured_at });
const refName = (id: string): string => `refs/branchloom/milestones/${id}`;
const within = (parent: string, child: string): boolean => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
const sameDirectory = (first: string, second: string): boolean => {
  const left = statSync(first, { bigint: true });
  const right = statSync(second, { bigint: true });
  if (left.ino !== 0n && right.ino !== 0n) return left.dev === right.dev && left.ino === right.ino;
  const a = realpathSync.native(first);
  const b = realpathSync.native(second);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};

export function installMilestones(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS project_milestones (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT,
    commit_hash TEXT NOT NULL, created_at TEXT NOT NULL,
    preview_png BLOB, preview_source TEXT, preview_captured_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_project_milestones ON project_milestones(project_id, created_at DESC);`);
  const columns = db.pragma('table_info(project_milestones)') as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'preview_png')) db.exec('ALTER TABLE project_milestones ADD COLUMN preview_png BLOB');
  if (!columns.some((column) => column.name === 'preview_source')) db.exec('ALTER TABLE project_milestones ADD COLUMN preview_source TEXT');
  if (!columns.some((column) => column.name === 'preview_captured_at')) db.exec('ALTER TABLE project_milestones ADD COLUMN preview_captured_at TEXT');
}

function git(cwd: string, ...args: string[]): string {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 2_000_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw new Error('Git-Abfrage fehlgeschlagen. Repository und Git-Installation prüfen.'); }
}

function repoFor(store: StudioStore, projectId: string): string {
  const project = store.project(projectId);
  const path = realpathSync(project.path);
  const root = realpathSync(git(path, 'rev-parse', '--show-toplevel'));
  if (!sameDirectory(path, root)) throw new Error('Meilensteine benötigen derzeit einen Projektordner am Git-Repository-Stamm.');
  return root;
}

function branch(cwd: string): string | null {
  try { return git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'); }
  catch { return null; }
}

function head(cwd: string): string { return git(cwd, 'rev-parse', '--verify', 'HEAD^{commit}'); }
function clean(cwd: string): boolean { return git(cwd, 'status', '--porcelain=v1', '--untracked-files=all') === ''; }
function milestone(store: StudioStore, projectId: string, id: string): ProjectMilestone {
  store.project(projectId);
  const row = store.db.prepare(`SELECT ${rowColumns} FROM project_milestones WHERE id = ? AND project_id = ?`).get(id, projectId) as Row | undefined;
  if (!row) throw new Error('Meilenstein in diesem Projekt nicht gefunden.');
  return map(row);
}

function verifiedRepository(store: StudioStore, item: ProjectMilestone): string {
  const root = repoFor(store, item.projectId);
  if (!sameDirectory(root, item.repository)) throw new Error('Das Projekt zeigt inzwischen auf ein anderes Repository.');
  let storedRef: string;
  try { storedRef = git(root, 'rev-parse', '--verify', refName(item.id)); }
  catch { throw new Error('Der lokale Meilenstein-Verweis fehlt oder zeigt auf einen anderen Commit.'); }
  if (storedRef !== item.commit) throw new Error('Der lokale Meilenstein-Verweis fehlt oder zeigt auf einen anderen Commit.');
  return root;
}

function commonDir(cwd: string): string {
  const value = git(cwd, 'rev-parse', '--git-common-dir');
  return realpathSync(isAbsolute(value) ? value : join(cwd, value));
}

export function listMilestones(store: StudioStore, projectId: string): ProjectMilestone[] {
  store.project(projectId);
  return (store.db.prepare(`SELECT ${rowColumns} FROM project_milestones WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(projectId) as Row[]).map(map);
}

function validLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f]/.test(value)) throw new Error('Der Name muss 1 bis 80 Zeichen ohne Steuerzeichen enthalten.');
  return value.trim();
}

export function createMilestone(store: StudioStore, input: { projectId: string; label: string }, expectedCommit?: string, preview?: MilestonePreviewImage): ProjectMilestone {
  const label = validLabel(input?.label);
  const root = repoFor(store, input.projectId);
  const count = store.db.prepare('SELECT COUNT(*) AS value FROM project_milestones WHERE project_id = ?').get(input.projectId) as { value: number };
  if (count.value >= 100) throw new Error('Maximal 100 lokale Meilensteine pro Projekt.');
  if (!clean(root)) throw new Error('Der Git-Arbeitsbaum enthält Änderungen. Bitte zuerst committen oder bereinigen; nur ein Commit kann als Meilenstein markiert werden.');
  const commit = head(root);
  if (expectedCommit && commit !== expectedCommit) throw new Error('Der Git-Commit hat sich während der Vorschauaufnahme geändert. Bitte erneut markieren.');
  const id = randomUUID();
  git(root, 'update-ref', refName(id), commit, '0'.repeat(commit.length));
  try {
    if (head(root) !== commit || !clean(root)) throw new Error('Der Git-Stand hat sich während der Anlage geändert. Bitte erneut prüfen.');
    store.db.prepare('INSERT INTO project_milestones (id, project_id, label, repository, branch, commit_hash, created_at, preview_png, preview_source, preview_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.projectId, label, root, branch(root), commit, new Date().toISOString(), preview?.png ?? null, preview?.source ?? null, preview?.capturedAt ?? null);
  } catch (error) {
    try { git(root, 'update-ref', '-d', refName(id), commit); } catch { /* A dangling local ref is safer than deleting an unexpected target. */ }
    throw error;
  }
  return milestone(store, input.projectId, id);
}

export async function createMilestoneWithPreview(store: StudioStore, input: { projectId: string; label: string; url: string },
  capture: (url: string) => Promise<MilestonePreviewImage> = captureLocalMilestonePreview): Promise<ProjectMilestone> {
  if (!input || typeof input.projectId !== 'string' || typeof input.label !== 'string') throw new Error('Ungültiger Meilenstein.');
  validLabel(input.label);
  // Validate before loading a page, and verify the exact clean commit again before saving.
  const url = normalizeMilestonePreviewUrl(input.url);
  const root = repoFor(store, input.projectId);
  const count = store.db.prepare('SELECT COUNT(*) AS value FROM project_milestones WHERE project_id = ?').get(input.projectId) as { value: number };
  if (count.value >= 100) throw new Error('Maximal 100 lokale Meilensteine pro Projekt.');
  if (!clean(root)) throw new Error('Der Git-Arbeitsbaum enthält Änderungen. Bitte zuerst committen oder bereinigen.');
  const expectedCommit = head(root);
  const preview = await capture(url);
  if (!Buffer.isBuffer(preview.png) || preview.png.length < 8 || preview.png.length > 1_000_000
    || !preview.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || typeof preview.source !== 'string' || preview.source.length > 2048 || !normalizeMilestonePreviewUrl(preview.source)
    || typeof preview.capturedAt !== 'string' || Number.isNaN(Date.parse(preview.capturedAt))) throw new Error('Die Vorschauaufnahme ist ungültig.');
  if (new URL(preview.source).origin !== new URL(url).origin) throw new Error('Die Vorschau verließ die gewählte lokale Origin.');
  const safeSource = diagnosticSource(preview.source);
  if (!safeSource) throw new Error('Die Vorschauquelle ist ungültig.');
  return createMilestone(store, { projectId: input.projectId, label: input.label }, expectedCommit, { ...preview, source: safeSource });
}

export function milestonePreviewImage(store: StudioStore, input: { projectId: string; milestoneId: string }): string {
  milestone(store, input.projectId, input.milestoneId);
  const row = store.db.prepare('SELECT preview_png FROM project_milestones WHERE id = ? AND project_id = ?').get(input.milestoneId, input.projectId) as { preview_png: Buffer | null } | undefined;
  const png = row?.preview_png;
  if (!Buffer.isBuffer(png) || png.length < 8 || png.length > 1_000_000 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Für diesen Meilenstein ist kein gültiges Vorschau-Bild gespeichert.');
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function compareMilestone(store: StudioStore, input: { projectId: string; milestoneId: string }): MilestoneComparison {
  const item = milestone(store, input.projectId, input.milestoneId);
  const root = verifiedRepository(store, item);
  const currentCommit = head(root);
  const fields = git(root, 'diff', '--name-status', '--no-renames', '-z', item.commit, currentCommit).split('\0');
  const changedFiles: MilestoneComparison['changedFiles'] = [];
  for (let index = 0; index + 1 < fields.length && changedFiles.length < 200; index += 2) {
    if (fields[index]) changedFiles.push({ status: fields[index]!, path: fields[index + 1]! });
  }
  const fileCount = Math.floor((fields.length - 1) / 2);
  let isAncestor = false;
  try { execFileSync('git', ['merge-base', '--is-ancestor', item.commit, currentCommit], { cwd: root, windowsHide: true, stdio: 'ignore', timeout: 10_000 }); isAncestor = true; } catch { /* Divergence is a normal comparison result. */ }
  return { milestone: item, currentCommit, currentBranch: branch(root), workingTreeClean: clean(root), isAncestor, changedFiles, truncated: fileCount > 200 };
}

export function checkoutMilestone(store: StudioStore, input: { projectId: string; milestoneId: string; confirm: boolean }): MilestoneCheckout {
  if (input.confirm !== true) throw new Error('Das isolierte Checkout erfordert eine ausdrückliche Bestätigung.');
  const item = milestone(store, input.projectId, input.milestoneId);
  const root = verifiedRepository(store, item);
  const base = store.worktreeBase;
  mkdirSync(base, { recursive: true });
  const resolvedBase = realpathSync(base);
  if (within(root, resolvedBase)) throw new Error('Der Speicherort für Meilenstein-Checkouts liegt im Projekt-Repository.');
  const path = join(resolvedBase, `milestone-${item.id}`);
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink() || !within(resolvedBase, realpathSync(path))) throw new Error('Der bestehende Checkout-Pfad ist nicht sicher.');
    if (!sameDirectory(git(path, 'rev-parse', '--show-toplevel'), path) || !sameDirectory(commonDir(path), commonDir(root))) throw new Error('Das bestehende Checkout gehört nicht zum Projekt-Repository.');
    if (head(path) !== item.commit) throw new Error('Das bestehende Meilenstein-Checkout wurde auf einen anderen Commit verschoben.');
    return { path, commit: item.commit, reused: true, workingTreeClean: clean(path) };
  }
  git(root, 'worktree', 'add', '--detach', path, item.commit);
  if (!within(resolvedBase, realpathSync(path)) || !sameDirectory(commonDir(path), commonDir(root)) || head(path) !== item.commit) throw new Error('Das isolierte Checkout konnte nicht verifiziert werden.');
  return { path, commit: item.commit, reused: false, workingTreeClean: clean(path) };
}
