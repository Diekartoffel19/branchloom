import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { WhiteboardEdge, WhiteboardNode, WhiteboardSnapshot, WhiteboardReference } from '../shared/types';
import type { StudioStore } from './store';

type NodeRow = { id: string; project_id: string; title: string; description: string; x: number; y: number; reference_kind: 'card' | 'folder' | 'file' | null; card_id: string | null; folder_path: string | null; created_at: string; updated_at: string };
type EdgeRow = { id: string; project_id: string; source_id: string; target_id: string; label: string; created_at: string };
export const MAX_WHITEBOARD_NODES = 500;
export const MAX_WHITEBOARD_EDGES = 1000;

const node = (row: NodeRow): WhiteboardNode => ({ id: row.id, projectId: row.project_id, title: row.title, description: row.description, x: row.x, y: row.y,
  reference: row.reference_kind === 'card' && row.card_id ? { kind: 'card', cardId: row.card_id } : (row.reference_kind === 'folder' || row.reference_kind === 'file') && row.folder_path ? { kind: row.reference_kind, path: row.folder_path } : null,
  createdAt: row.created_at, updatedAt: row.updated_at });
const edge = (row: EdgeRow): WhiteboardEdge => ({ id: row.id, projectId: row.project_id, sourceId: row.source_id, targetId: row.target_id, label: row.label, createdAt: row.created_at });

export function installWhiteboard(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_nodes (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      reference_kind TEXT, card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      folder_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS whiteboard_edges (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES whiteboard_nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES whiteboard_nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(project_id, source_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS whiteboard_nodes_project ON whiteboard_nodes(project_id);
    CREATE INDEX IF NOT EXISTS whiteboard_edges_project ON whiteboard_edges(project_id);
  `);
}

function label(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${field} ist ungültig.`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max || result.includes('\0')) throw new Error(`${field} muss ${allowEmpty ? '0' : '1'} bis ${max} Zeichen enthalten.`);
  return result;
}

function position(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000) throw new Error('Whiteboard-Position ist ungültig.');
  return Math.round(value * 100) / 100;
}

function checkedReference(store: StudioStore, projectId: string, reference: WhiteboardReference | null): WhiteboardReference | null {
  if (reference === null) return null;
  if (!reference || typeof reference !== 'object') throw new Error('Whiteboard-Verknüpfung ist ungültig.');
  if (reference.kind === 'card') {
    if (typeof reference.cardId !== 'string' || store.card(reference.cardId).projectId !== projectId) throw new Error('Karte gehört nicht zu diesem Projekt.');
    return { kind: 'card', cardId: reference.cardId };
  }
  if (reference.kind === 'folder' || reference.kind === 'file') {
    const input = label(reference.path, 'Projektpfad', 300);
    if (isAbsolute(input)) throw new Error('Projektpfad muss relativ zum Projekt sein.');
    const root = realpathSync(store.project(projectId).path);
    const candidate = resolve(root, input);
    const target = realpathSync(candidate);
    const within = relative(root, target);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Projektpfad liegt außerhalb des Projekts.');
    if (reference.kind === 'folder' && !statSync(target).isDirectory()) throw new Error('Projektpfad ist kein Ordner.');
    if (reference.kind === 'file' && (!lstatSync(candidate).isFile() || !statSync(target).isFile())) throw new Error('Projektpfad ist keine reguläre Datei.');
    return { kind: reference.kind, path: within || '.' };
  }
  throw new Error('Whiteboard-Verknüpfung ist ungültig.');
}

function requiredNode(store: StudioStore, id: string): WhiteboardNode {
  const row = store.db.prepare('SELECT * FROM whiteboard_nodes WHERE id = ?').get(id) as NodeRow | undefined;
  if (!row) throw new Error('Whiteboard-Box nicht gefunden.');
  return node(row);
}

export function whiteboardSnapshot(store: StudioStore, projectId: string): WhiteboardSnapshot {
  store.project(projectId);
  const nodes = store.db.prepare(`SELECT * FROM whiteboard_nodes WHERE project_id = ? ORDER BY created_at, id LIMIT ${MAX_WHITEBOARD_NODES + 1}`).all(projectId) as NodeRow[];
  const edges = store.db.prepare(`SELECT * FROM whiteboard_edges WHERE project_id = ? ORDER BY created_at, id LIMIT ${MAX_WHITEBOARD_EDGES + 1}`).all(projectId) as EdgeRow[];
  if (nodes.length > MAX_WHITEBOARD_NODES || edges.length > MAX_WHITEBOARD_EDGES) throw new Error('Whiteboard ist größer als das aktuelle Anzeige-Limit. Bitte Datenbestand prüfen.');
  return { nodes: nodes.map(node), edges: edges.map(edge) };
}

export function createWhiteboardNode(store: StudioStore, input: { projectId: string; title: string; description?: string; x: number; y: number; reference?: WhiteboardReference | null }): WhiteboardNode {
  store.project(input.projectId);
  const title = label(input.title, 'Titel', 120);
  const description = label(input.description ?? '', 'Beschreibung', 2000, true);
  const reference = checkedReference(store, input.projectId, input.reference ?? null);
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_nodes WHERE project_id = ?').get(input.projectId) as { count: number };
  if (count.count >= MAX_WHITEBOARD_NODES) throw new Error(`Maximal ${MAX_WHITEBOARD_NODES} Whiteboard-Boxen pro Projekt.`);
  const id = randomUUID();
  const stamp = new Date().toISOString();
  store.db.prepare('INSERT INTO whiteboard_nodes (id, project_id, title, description, x, y, reference_kind, card_id, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.projectId, title, description, position(input.x), position(input.y), reference?.kind ?? null, reference?.kind === 'card' ? reference.cardId : null, reference?.kind === 'folder' || reference?.kind === 'file' ? reference.path : null, stamp, stamp);
  return requiredNode(store, id);
}

export function updateWhiteboardNode(store: StudioStore, input: { projectId: string; id: string; title?: string; description?: string; x?: number; y?: number; reference?: WhiteboardReference | null }): WhiteboardNode {
  const existing = requiredNode(store, input.id);
  if (existing.projectId !== input.projectId) throw new Error('Whiteboard-Box gehört nicht zu diesem Projekt.');
  const reference = input.reference === undefined ? existing.reference : checkedReference(store, existing.projectId, input.reference);
  store.db.prepare('UPDATE whiteboard_nodes SET title = ?, description = ?, x = ?, y = ?, reference_kind = ?, card_id = ?, folder_path = ?, updated_at = ? WHERE id = ?')
    .run(input.title === undefined ? existing.title : label(input.title, 'Titel', 120),
      input.description === undefined ? existing.description : label(input.description, 'Beschreibung', 2000, true),
      input.x === undefined ? existing.x : position(input.x), input.y === undefined ? existing.y : position(input.y),
      reference?.kind ?? null, reference?.kind === 'card' ? reference.cardId : null, reference?.kind === 'folder' || reference?.kind === 'file' ? reference.path : null,
      new Date().toISOString(), input.id);
  return requiredNode(store, input.id);
}

export function deleteWhiteboardNode(store: StudioStore, input: { projectId: string; id: string }): void {
  if (requiredNode(store, input.id).projectId !== input.projectId) throw new Error('Whiteboard-Box gehört nicht zu diesem Projekt.');
  store.db.prepare('DELETE FROM whiteboard_nodes WHERE id = ? AND project_id = ?').run(input.id, input.projectId);
}

export function createWhiteboardEdge(store: StudioStore, input: { projectId: string; sourceId: string; targetId: string; label?: string }): WhiteboardEdge {
  store.project(input.projectId);
  if (input.sourceId === input.targetId) throw new Error('Eine Box kann nicht mit sich selbst verbunden werden.');
  if (requiredNode(store, input.sourceId).projectId !== input.projectId || requiredNode(store, input.targetId).projectId !== input.projectId) throw new Error('Verbindung überschreitet die Projektgrenze.');
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_edges WHERE project_id = ?').get(input.projectId) as { count: number };
  if (count.count >= MAX_WHITEBOARD_EDGES) throw new Error(`Maximal ${MAX_WHITEBOARD_EDGES} Whiteboard-Verbindungen pro Projekt.`);
  const id = randomUUID();
  try {
    store.db.prepare('INSERT INTO whiteboard_edges (id, project_id, source_id, target_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.projectId, input.sourceId, input.targetId, label(input.label ?? '', 'Verbindungsname', 120, true), new Date().toISOString());
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE constraint')) throw new Error('Diese Verbindung existiert bereits.');
    throw error;
  }
  return edge(store.db.prepare('SELECT * FROM whiteboard_edges WHERE id = ?').get(id) as EdgeRow);
}

export function deleteWhiteboardEdge(store: StudioStore, input: { projectId: string; id: string }): void {
  const result = store.db.prepare('DELETE FROM whiteboard_edges WHERE id = ? AND project_id = ?').run(input.id, input.projectId);
  if (!result.changes) throw new Error('Whiteboard-Verbindung nicht gefunden.');
}
