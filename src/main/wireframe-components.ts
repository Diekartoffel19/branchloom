import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { WIREFRAME_ARTBOARDS, type WireframeArtboard } from '../shared/card-wireframe';
import type { SaveWireframeComponentInput, WireframeComponent } from '../shared/wireframe-components';
import { checkedWireframeElements } from './card-wireframe';
import type { StudioStore } from './store';

interface ComponentRow {
  id: string;
  project_id: string;
  name: string;
  source_artboard: string;
  width: number;
  height: number;
  elements_json: string;
  created_at: string;
}

function checkedName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /\0/.test(value)) {
    throw new Error('Bausteinname muss 1 bis 80 Zeichen enthalten.');
  }
  return value.trim();
}

function fromRow(row: ComponentRow): WireframeComponent {
  if (!Object.hasOwn(WIREFRAME_ARTBOARDS, row.source_artboard)) throw new Error('Unbekannte Baustein-Zeichenfläche.');
  return {
    id: row.id, projectId: row.project_id, name: row.name,
    sourceArtboard: row.source_artboard as WireframeArtboard,
    width: row.width, height: row.height,
    elements: checkedWireframeElements(JSON.parse(row.elements_json) as unknown, row.width, row.height),
    createdAt: row.created_at,
  };
}

export function installWireframeComponents(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS wireframe_components (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_artboard TEXT NOT NULL CHECK (source_artboard IN ('desktop', 'tablet', 'mobile')),
    width INTEGER NOT NULL CHECK (width >= 24 AND width <= 960),
    height INTEGER NOT NULL CHECK (height >= 24 AND height <= 1024),
    elements_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wireframe_components_project ON wireframe_components(project_id, created_at DESC);`);
}

export function listWireframeComponents(store: StudioStore, projectId: string): WireframeComponent[] {
  if (typeof projectId !== 'string') throw new Error('Projekt fehlt.');
  store.project(projectId);
  const rows = store.db.prepare('SELECT * FROM wireframe_components WHERE project_id = ? ORDER BY created_at DESC, id DESC').all(projectId) as ComponentRow[];
  return rows.map(fromRow);
}

export function saveWireframeComponent(store: StudioStore, input: SaveWireframeComponentInput): WireframeComponent {
  if (!input || typeof input.projectId !== 'string' || typeof input.cardId !== 'string') throw new Error('Projekt und Karte fehlen.');
  const card = store.card(input.cardId);
  if (card.projectId !== input.projectId) throw new Error('Die Karte gehört nicht zu diesem Projekt.');
  if (!Object.hasOwn(WIREFRAME_ARTBOARDS, input.sourceArtboard)) throw new Error('Unbekannte Zeichenfläche.');
  const artboard = WIREFRAME_ARTBOARDS[input.sourceArtboard];
  const elements = checkedWireframeElements(input.elements, artboard.width, artboard.height);
  if (!elements.length) throw new Error('Wähle mindestens ein Element für den Baustein.');
  const minX = Math.min(...elements.map((item) => item.x));
  const minY = Math.min(...elements.map((item) => item.y));
  const width = Math.max(...elements.map((item) => item.x + item.width)) - minX;
  const height = Math.max(...elements.map((item) => item.y + item.height)) - minY;
  const relative = checkedWireframeElements(elements.map((item) => ({ ...item, x: item.x - minX, y: item.y - minY })), width, height);
  const name = checkedName(input.name);
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM wireframe_components WHERE project_id = ?').get(input.projectId) as { count: number };
  if (count.count >= 50) throw new Error('Ein Projekt erlaubt höchstens 50 Designbausteine.');
  const component: WireframeComponent = {
    id: randomUUID(), projectId: input.projectId, name,
    sourceArtboard: input.sourceArtboard, width, height, elements: relative,
    createdAt: new Date().toISOString(),
  };
  store.db.prepare('INSERT INTO wireframe_components (id, project_id, name, source_artboard, width, height, elements_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(component.id, component.projectId, component.name, component.sourceArtboard, component.width, component.height, JSON.stringify(component.elements), component.createdAt);
  return component;
}

export function removeWireframeComponent(store: StudioStore, input: { projectId: string; id: string }): void {
  if (!input || typeof input.projectId !== 'string' || typeof input.id !== 'string') throw new Error('Projekt und Baustein fehlen.');
  store.project(input.projectId);
  const result = store.db.prepare('DELETE FROM wireframe_components WHERE id = ? AND project_id = ?').run(input.id, input.projectId);
  if (!result.changes) throw new Error('Designbaustein in diesem Projekt nicht gefunden.');
}
