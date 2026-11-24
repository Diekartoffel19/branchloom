import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { CardContextKind, CardContextPreview, CardContextReference } from '../shared/types';
import { attachmentAvailable } from './card-attachments';
import type { StudioStore } from './store';

const MAX_REFS = 20;
const MAX_FILE_BYTES = 128_000;
const MAX_PREVIEW_BYTES = 4_096;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.yml', '.yaml', '.toml', '.py', '.rs', '.go', '.sql']);
type ContextRow = { id: string; card_id: string; project_id: string; kind: CardContextKind; target: string; added_at: string };

export function installCardContext(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS card_context_refs (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, target TEXT NOT NULL, added_at TEXT NOT NULL,
    UNIQUE(card_id, kind, target)
  ); CREATE INDEX IF NOT EXISTS card_context_refs_card ON card_context_refs(card_id, added_at);`);
}

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function checkedFile(store: StudioStore, projectId: string, input: string): { target: string; path: string; size: number } {
  if (typeof input !== 'string' || !input.trim() || input.length > 300 || /[\x00-\x1f\x7f]/u.test(input) || isAbsolute(input)) throw new Error('Projektdatei braucht einen relativen Pfad bis 300 Zeichen.');
  const root = realpathSync(store.project(projectId).path);
  const candidate = resolve(root, input.trim());
  if (!within(root, candidate)) throw new Error('Projektdatei liegt außerhalb des Projekts.');
  let path: string;
  try { path = realpathSync(candidate); } catch { throw new Error('Projektdatei wurde nicht gefunden.'); }
  if (!within(root, path)) throw new Error('Projektdatei liegt außerhalb des Projekts.');
  const leaf = lstatSync(candidate);
  const info = statSync(path);
  if (!leaf.isFile() || leaf.isSymbolicLink() || !info.isFile()) throw new Error('Projektdatei muss eine reguläre Datei sein.');
  if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error('Projektdatei hat eine ungültige Größe.');
  return { target: relative(root, path).split(sep).join('/'), path, size: info.size };
}

function checkedFolder(store: StudioStore, projectId: string, input: string): { target: string; path: string } {
  if (typeof input !== 'string' || !input.trim() || input.length > 300 || /[\x00-\x1f\x7f]/u.test(input) || isAbsolute(input)) throw new Error('Projektordner braucht einen relativen Pfad bis 300 Zeichen.');
  const root = realpathSync(store.project(projectId).path);
  const candidate = resolve(root, input.trim());
  if (!within(root, candidate)) throw new Error('Projektordner liegt außerhalb des Projekts.');
  const segments = relative(root, candidate).split(sep).filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    const segment = join(root, ...segments.slice(0, index + 1));
    try { if (lstatSync(segment).isSymbolicLink()) throw new Error('Projektordner darf keine Pfadverknüpfung enthalten.'); }
    catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Projektordner wurde nicht gefunden.');
      throw reason;
    }
  }
  let path: string;
  try { path = realpathSync(candidate); } catch { throw new Error('Projektordner wurde nicht gefunden.'); }
  if (!within(root, path)) throw new Error('Projektordner liegt außerhalb des Projekts.');
  const leaf = lstatSync(candidate);
  if (leaf.isSymbolicLink() || !leaf.isDirectory() || !statSync(path).isDirectory()) throw new Error('Projektordner muss ein echter Ordner sein.');
  return { target: relative(root, path).split(sep).join('/') || '.', path };
}

export function checkedDocumentationUrl(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(input)) throw new Error('Doku-Adresse ist ungültig.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Doku-Adresse ist ungültig.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || isIP(host.replace(/^\[|\]$/g, ''))
    || /(^|\.)(localhost|local|internal|lan)$/u.test(host)) throw new Error('Nur öffentliche HTTPS-Doku-Adressen ohne Zugangsdaten sind erlaubt.');
  return url.href;
}

function rowToReference(store: StudioStore, row: ContextRow): CardContextReference {
  let available = row.kind === 'url';
  if (row.kind === 'file') {
    try { available = checkedFile(store, row.project_id, row.target).target === row.target; } catch { available = false; }
  } else if (row.kind === 'folder') {
    try { available = checkedFolder(store, row.project_id, row.target).target === row.target; } catch { available = false; }
  }
  return { id: row.id, cardId: row.card_id, projectId: row.project_id, kind: row.kind, target: row.target, addedAt: row.added_at, available };
}

export function cardContextReferences(store: StudioStore, cardId: string): CardContextReference[] {
  store.card(cardId);
  const rows = store.db.prepare(`SELECT * FROM card_context_refs WHERE card_id = ? ORDER BY added_at, rowid LIMIT ${MAX_REFS + 1}`).all(cardId) as ContextRow[];
  if (rows.length > MAX_REFS) throw new Error('Kartenkontext überschreitet das Anzeigelimit.');
  return rows.map((row) => rowToReference(store, row));
}

/** Prepare a card attachment as project context without storing it or exposing its absolute path. */
export function cardContextCandidateFromAttachment(store: StudioStore, input: { cardId: string; attachmentId: string }): string {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  if (typeof input.attachmentId !== 'string' || !input.attachmentId) throw new Error('Anhang ist ungültig.');
  const row = store.db.prepare('SELECT path FROM card_attachments WHERE id = ? AND card_id = ?').get(input.attachmentId, card.id) as { path: string } | undefined;
  if (!row) throw new Error('Anhang gehört nicht zu dieser Karte.');
  if (!attachmentAvailable(row.path)) throw new Error('Die verknüpfte Datei fehlt oder ihr Pfad hat sich geändert.');
  const root = realpathSync(store.project(card.projectId).path);
  const candidate = checkedFile(store, card.projectId, relative(root, row.path));
  if (process.platform === 'win32' ? candidate.path.toLowerCase() !== row.path.toLowerCase() : candidate.path !== row.path) {
    throw new Error('Die verknüpfte Datei wurde verschoben oder ersetzt.');
  }
  return candidate.target;
}

/** Resolve an opaque saved Whiteboard box to a current project file or folder. */
export function cardContextCandidateFromWhiteboardNode(store: StudioStore, input: { cardId: string; nodeId: string }): { kind: 'file' | 'folder'; target: string } {
  if (!input || typeof input.cardId !== 'string' || typeof input.nodeId !== 'string' || !input.nodeId || input.nodeId.length > 200) throw new Error('Whiteboard-Quelle ist ungültig.');
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const row = store.db.prepare('SELECT project_id, reference_kind, folder_path FROM whiteboard_nodes WHERE id = ?').get(input.nodeId) as
    { project_id: string; reference_kind: string | null; folder_path: string | null } | undefined;
  if (!row) throw new Error('Whiteboard-Box wurde entfernt. Quelle neu wählen.');
  if (row.project_id !== card.projectId) throw new Error('Whiteboard-Box gehört zu einem anderen Projekt.');
  if ((row.reference_kind !== 'file' && row.reference_kind !== 'folder') || !row.folder_path) throw new Error('Whiteboard-Box hat keine gespeicherte Datei- oder Ordnerverknüpfung.');
  return { kind: row.reference_kind, target: row.reference_kind === 'file'
    ? checkedFile(store, card.projectId, row.folder_path).target
    : checkedFolder(store, card.projectId, row.folder_path).target };
}

/** Confirmation rechecks kind and target; changed sources cannot silently save old drafts. */
export function addCardContextReferenceFromWhiteboardNode(store: StudioStore, input: { cardId: string; nodeId: string; expectedKind: 'file' | 'folder'; expectedTarget: string }): CardContextReference[] {
  if (!input || (input.expectedKind !== 'file' && input.expectedKind !== 'folder') || typeof input.expectedTarget !== 'string' || !input.expectedTarget || input.expectedTarget.length > 300) throw new Error('Whiteboard-Entwurf ist ungültig.');
  const candidate = cardContextCandidateFromWhiteboardNode(store, input);
  if (candidate.kind !== input.expectedKind || candidate.target !== input.expectedTarget) throw new Error('Whiteboard-Verknüpfung wurde geändert. Quelle erneut vorbereiten.');
  return addCardContextReference(store, { cardId: input.cardId, kind: candidate.kind, target: candidate.target });
}

export function addCardContextReference(store: StudioStore, input: { cardId: string; kind: CardContextKind; target: string }): CardContextReference[] {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  if (input.kind !== 'file' && input.kind !== 'folder' && input.kind !== 'url') throw new Error('Kontexttyp ist ungültig.');
  const target = input.kind === 'file' ? checkedFile(store, card.projectId, input.target).target
    : input.kind === 'folder' ? checkedFolder(store, card.projectId, input.target).target : checkedDocumentationUrl(input.target);
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM card_context_refs WHERE card_id = ?').get(card.id) as { count: number };
  if (count.count >= MAX_REFS) throw new Error(`Maximal ${MAX_REFS} Kontextbezüge pro Karte.`);
  try {
    store.db.prepare('INSERT INTO card_context_refs (id, card_id, project_id, kind, target, added_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), card.id, card.projectId, input.kind, target, new Date().toISOString());
  } catch (reason) {
    if ((reason as Error).message.includes('UNIQUE constraint')) throw new Error('Dieser Kontextbezug ist bereits an der Karte.');
    throw reason;
  }
  return cardContextReferences(store, card.id);
}

function requiredReference(store: StudioStore, input: { cardId: string; referenceId: string }): ContextRow {
  store.card(input.cardId);
  const row = store.db.prepare('SELECT * FROM card_context_refs WHERE id = ? AND card_id = ?').get(input.referenceId, input.cardId) as ContextRow | undefined;
  if (!row) throw new Error('Kontextbezug gehört nicht zu dieser Karte.');
  return row;
}

export function previewCardContextReference(store: StudioStore, input: { cardId: string; referenceId: string }): CardContextPreview {
  const row = requiredReference(store, input);
  if (row.kind === 'url') return { id: row.id, kind: 'url', target: row.target, text: null, truncated: false, note: 'Adresse gespeichert. Branchloom hat die Webseite nicht abgerufen.' };
  if (row.kind === 'folder') {
    const folder = checkedFolder(store, row.project_id, row.target);
    if (folder.target !== row.target) throw new Error('Projektordner wurde verschoben oder ersetzt.');
    return { id: row.id, kind: 'folder', target: row.target, text: null, truncated: false, note: 'Projektordner geprüft. Inhalte wurden nicht gelesen oder an Agenten übergeben.' };
  }
  const file = checkedFile(store, row.project_id, row.target);
  if (file.target !== row.target) throw new Error('Projektdatei wurde verschoben oder ersetzt.');
  if (!TEXT_EXTENSIONS.has(extname(file.path).toLowerCase())) throw new Error('Nur bekannte Textdateien können als Vorschau gelesen werden.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Datei ist für die Vorschau größer als 128 KB.');
  const descriptor = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    const pathInfo = lstatSync(file.path);
    if (!opened.isFile() || !pathInfo.isFile() || pathInfo.isSymbolicLink()
      || opened.dev !== pathInfo.dev || opened.ino !== pathInfo.ino || opened.size > MAX_FILE_BYTES) throw new Error('Projektdatei hat sich während der Vorschau geändert.');
    const bytes = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
    const used = readSync(descriptor, bytes, 0, bytes.length, 0);
    const slice = bytes.subarray(0, Math.min(used, MAX_PREVIEW_BYTES));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(slice, { stream: used > MAX_PREVIEW_BYTES });
    if (text.includes('\0')) throw new Error('Binärdatei kann nicht als Text angezeigt werden.');
    return { id: row.id, kind: 'file', target: row.target, text, truncated: opened.size > MAX_PREVIEW_BYTES || used > MAX_PREVIEW_BYTES, note: 'Lokale Momentaufnahme; Dateiinhalt wird nicht an Agenten übergeben.' };
  } finally { closeSync(descriptor); }
}

export function removeCardContextReference(store: StudioStore, input: { cardId: string; referenceId: string }): CardContextReference[] {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  requiredReference(store, input);
  store.db.prepare('DELETE FROM card_context_refs WHERE id = ? AND card_id = ?').run(input.referenceId, card.id);
  return cardContextReferences(store, card.id);
}
