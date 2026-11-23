import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { CardContextPreview, CardContextReference } from '../shared/types';
import type { StudioStore } from './store';

const MAX_REFS = 20;
const MAX_FILE_BYTES = 128_000;
const MAX_PREVIEW_BYTES = 4_096;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.yml', '.yaml', '.toml', '.py', '.rs', '.go', '.sql']);
type ContextRow = { id: string; card_id: string; project_id: string; kind: 'file' | 'url'; target: string; added_at: string };

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
  }
  return { id: row.id, cardId: row.card_id, projectId: row.project_id, kind: row.kind, target: row.target, addedAt: row.added_at, available };
}

export function cardContextReferences(store: StudioStore, cardId: string): CardContextReference[] {
  store.card(cardId);
  const rows = store.db.prepare(`SELECT * FROM card_context_refs WHERE card_id = ? ORDER BY added_at, rowid LIMIT ${MAX_REFS + 1}`).all(cardId) as ContextRow[];
  if (rows.length > MAX_REFS) throw new Error('Kartenkontext überschreitet das Anzeigelimit.');
  return rows.map((row) => rowToReference(store, row));
}

export function addCardContextReference(store: StudioStore, input: { cardId: string; kind: 'file' | 'url'; target: string }): CardContextReference[] {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  if (input.kind !== 'file' && input.kind !== 'url') throw new Error('Kontexttyp ist ungültig.');
  const target = input.kind === 'file' ? checkedFile(store, card.projectId, input.target).target : checkedDocumentationUrl(input.target);
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
