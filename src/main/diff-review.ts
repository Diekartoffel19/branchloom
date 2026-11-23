import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardDiffPreview, CreateReviewComment, DiffFile, DiffLine, ReviewComment } from '../shared/diff-review';
import type { StudioStore } from './store';
import { reviewCardWorktree } from './git-worktree';

const MAX_DIFF_BYTES = 256 * 1024;
const MAX_DIFF_LINES = 1_200;
const MAX_DIFF_FILES = 60;
const MAX_COMMENTS = 200;

type CommentRow = { id: string; card_id: string; fingerprint: string; file_path: string; side: 'old' | 'new'; line: number; body: string; created_at: string };

export function installReviewComments(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      file_path TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('old','new')),
      line INTEGER NOT NULL CHECK(line > 0),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_comments_card ON review_comments(card_id, created_at);
  `);
}

function git(cwd: string, args: string[], maxBuffer = 32_000): string {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args], {
    cwd, encoding: 'utf8', timeout: 10_000, maxBuffer, windowsHide: true, shell: false,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOBUFS') throw new Error('Diff ist für die erste Review-Vorschau zu groß (maximal 256 KiB). Bitte direkt in Git prüfen.');
  if (result.error || result.status !== 0) throw new Error(`Git-Diff konnte nicht gelesen werden: ${String(result.stderr || result.error?.message || 'Git-Fehler').trim().slice(0, 300)}`);
  return result.stdout;
}

function safePath(path: string): string {
  if (!path || path.length > 500 || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Diff enthält einen nicht unterstützten Dateipfad. Bitte direkt in Git prüfen.');
  return path;
}

/** Parses only standard unified Git diff records; no diff text is rendered as HTML. */
export function parseCardDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let headerPath: string | null = null;
  let oldLine: number | null = null;
  let newLine: number | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) { current.path = safePath(newPath ?? oldPath ?? headerPath ?? ''); files.push(current); }
      if (files.length >= MAX_DIFF_FILES) throw new Error('Diff enthält mehr als 60 Dateien. Bitte direkt in Git prüfen.');
      const separator = line.lastIndexOf(' b/');
      headerPath = line.startsWith('diff --git a/') && separator > 13 ? line.slice(separator + 3) : null;
      current = { path: '', lines: [] }; oldPath = null; newPath = null; oldLine = null; newLine = null;
      continue;
    }
    if (!current) continue;
    if (oldLine === null && newLine === null && line.startsWith('--- a/')) { oldPath = line.slice(6).split('\t', 1)[0] ?? null; continue; }
    if (oldLine === null && newLine === null && line.startsWith('+++ b/')) { newPath = line.slice(6).split('\t', 1)[0] ?? null; continue; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    let record: DiffLine | null = null;
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      record = { kind: 'hunk', text: line, oldLine: null, newLine: null };
    } else if (oldLine !== null && newLine !== null) {
      if (line.startsWith('+')) record = { kind: 'added', text: line.slice(1), oldLine: null, newLine: newLine++ };
      else if (line.startsWith('-')) record = { kind: 'removed', text: line.slice(1), oldLine: oldLine++, newLine: null };
      else if (line.startsWith(' ')) record = { kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ };
      else if (line.startsWith('\\')) record = { kind: 'meta', text: line, oldLine: null, newLine: null };
    } else if (line.startsWith('Binary files ') || line.startsWith('new file mode ') || line.startsWith('deleted file mode ')) {
      record = { kind: 'meta', text: line, oldLine: null, newLine: null };
    }
    if (record) {
      current.lines.push(record);
      if (files.reduce((sum, file) => sum + file.lines.length, 0) + current.lines.length > MAX_DIFF_LINES) throw new Error('Diff enthält mehr als 1.200 Zeilen. Bitte direkt in Git prüfen.');
    }
  }
  if (current) { current.path = safePath(newPath ?? oldPath ?? headerPath ?? ''); files.push(current); }
  return files;
}

/** Read-only preview of committed and tracked working-tree changes from the common base. */
export function previewCardDiff(store: StudioStore, cardId: string): CardDiffPreview | null {
  const review = reviewCardWorktree(store, cardId);
  if (!review) return null;
  const baseHead = git(review.path, ['merge-base', review.targetHead, review.sourceHead]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(baseHead)) throw new Error('Gemeinsamer Git-Ausgangspunkt nicht gefunden. Bitte direkt in Git prüfen.');
  const raw = git(review.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--unified=3', baseHead, '--'], MAX_DIFF_BYTES + 1);
  if (Buffer.byteLength(raw, 'utf8') > MAX_DIFF_BYTES) throw new Error('Diff ist für die erste Review-Vorschau zu groß (maximal 256 KiB). Bitte direkt in Git prüfen.');
  const files = parseCardDiff(raw);
  const warnings = review.sourceStatus.some((item) => item.startsWith('??')) ? ['Unversionierte Dateien sind nicht Teil dieser Diff-Vorschau.'] : [];
  const fingerprint = createHash('sha256').update(JSON.stringify([cardId, review.sourceHead, review.targetHead, baseHead, raw])).digest('hex');
  return { cardId, sourceHead: review.sourceHead, targetHead: review.targetHead, baseHead, fingerprint, files, warnings };
}

const comment = (row: CommentRow): ReviewComment => ({ id: row.id, cardId: row.card_id, fingerprint: row.fingerprint,
  filePath: row.file_path, side: row.side, line: row.line, body: row.body, createdAt: row.created_at });

export function listReviewComments(store: StudioStore, cardId: string): ReviewComment[] {
  store.card(cardId);
  const rows = store.db.prepare('SELECT * FROM review_comments WHERE card_id = ? ORDER BY created_at, id LIMIT ?').all(cardId, MAX_COMMENTS + 1) as CommentRow[];
  if (rows.length > MAX_COMMENTS) throw new Error('Zu viele Review-Kommentare für diese Karte.');
  return rows.map(comment);
}

export function createReviewComment(store: StudioStore, input: CreateReviewComment): ReviewComment {
  if (!input || typeof input.cardId !== 'string' || typeof input.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.fingerprint) || typeof input.filePath !== 'string'
    || (input.side !== 'old' && input.side !== 'new') || !Number.isSafeInteger(input.line) || input.line < 1
    || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 2_000 || input.body.includes('\0')) throw new Error('Review-Kommentar ist ungültig.');
  const preview = previewCardDiff(store, input.cardId);
  if (!preview) throw new Error('Für diese Karte gibt es keinen Git-Worktree.');
  if (preview.fingerprint !== input.fingerprint) throw new Error('Der Diff hat sich seit der Vorschau geändert. Bitte neu laden.');
  const file = preview.files.find((item) => item.path === input.filePath);
  if (!file?.lines.some((line) => input.side === 'old' ? line.oldLine === input.line : line.newLine === input.line)) {
    throw new Error('Diese Diff-Zeile ist nicht mehr vorhanden. Bitte neu laden.');
  }
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM review_comments WHERE card_id = ?').get(input.cardId) as { count: number };
  if (count.count >= MAX_COMMENTS) throw new Error('Maximal 200 Review-Kommentare pro Karte.');
  const row: CommentRow = { id: randomUUID(), card_id: input.cardId, fingerprint: preview.fingerprint,
    file_path: input.filePath, side: input.side, line: input.line, body: input.body.trim(), created_at: new Date().toISOString() };
  store.db.prepare('INSERT INTO review_comments (id, card_id, fingerprint, file_path, side, line, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.card_id, row.fingerprint, row.file_path, row.side, row.line, row.body, row.created_at);
  return comment(row);
}
