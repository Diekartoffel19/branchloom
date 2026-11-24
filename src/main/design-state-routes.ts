import type Database from 'better-sqlite3';
import type { DesignStateKind, DesignStateRoute, DesignStateRouteInput, DesignStateRouteKey } from '../shared/design-state-routes';
import { isLocalDevUrl, normalizeBrowserAddress } from './browser-policy';
import type { StudioStore } from './store';

const KINDS = new Set<DesignStateKind>(['normal', 'loading', 'empty', 'error']);
type RouteRow = { project_id: string; kind: DesignStateKind; url: string; updated_at: string };
const fromRow = (row: RouteRow): DesignStateRoute => ({ projectId: row.project_id, kind: row.kind, url: row.url, updatedAt: row.updated_at });

function checkedKind(kind: unknown): DesignStateKind {
  if (typeof kind !== 'string' || !KINDS.has(kind as DesignStateKind)) throw new Error('Unbekannter Designzustand.');
  return kind as DesignStateKind;
}

export function normalizeDesignStateRoute(value: unknown): string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) throw new Error('Gib eine vollständige lokale HTTP(S)-Adresse ein.');
  const url = normalizeBrowserAddress(value);
  if (!isLocalDevUrl(url)) throw new Error('Nur eine lokale Vorschau auf localhost, 127.0.0.1 oder [::1] ist erlaubt.');
  return url;
}

export function installDesignStateRoutes(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS design_state_routes (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('normal', 'loading', 'empty', 'error')),
    url TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, kind)
  );`);
}

export function designStateRoutes(store: StudioStore, projectId: string): DesignStateRoute[] {
  store.project(projectId);
  return (store.db.prepare('SELECT * FROM design_state_routes WHERE project_id = ? ORDER BY CASE kind WHEN \'normal\' THEN 0 WHEN \'loading\' THEN 1 WHEN \'empty\' THEN 2 ELSE 3 END').all(projectId) as RouteRow[]).map(fromRow);
}

export function designStateRoute(store: StudioStore, input: DesignStateRouteKey): DesignStateRoute {
  if (!input || typeof input.projectId !== 'string') throw new Error('Designzustand und Projekt fehlen.');
  const kind = checkedKind(input.kind);
  store.project(input.projectId);
  const row = store.db.prepare('SELECT * FROM design_state_routes WHERE project_id = ? AND kind = ?').get(input.projectId, kind) as RouteRow | undefined;
  if (!row) throw new Error('Für diesen Designzustand ist noch keine Route gespeichert.');
  const url = normalizeDesignStateRoute(row.url);
  return { ...fromRow(row), url };
}

export function saveDesignStateRoute(store: StudioStore, input: DesignStateRouteInput): DesignStateRoute {
  if (!input || typeof input.projectId !== 'string') throw new Error('Designzustand und Projekt fehlen.');
  const kind = checkedKind(input.kind);
  store.project(input.projectId);
  const url = normalizeDesignStateRoute(input.url);
  const origin = new URL(url).origin;
  return store.db.transaction(() => {
    const others = store.db.prepare('SELECT url FROM design_state_routes WHERE project_id = ? AND kind <> ?').all(input.projectId, kind) as Array<{ url: string }>;
    if (others.some((item) => new URL(normalizeDesignStateRoute(item.url)).origin !== origin)) {
      throw new Error('Alle gespeicherten Designzustände dieses Projekts müssen dieselbe lokale Origin verwenden. Entferne zuerst die anderen Routen.');
    }
    const updatedAt = new Date().toISOString();
    store.db.prepare('INSERT INTO design_state_routes (project_id, kind, url, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, kind) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at')
      .run(input.projectId, kind, url, updatedAt);
    return { projectId: input.projectId, kind, url, updatedAt };
  })();
}

export function removeDesignStateRoute(store: StudioStore, input: DesignStateRouteKey): void {
  if (!input || typeof input.projectId !== 'string') throw new Error('Designzustand und Projekt fehlen.');
  const kind = checkedKind(input.kind);
  store.project(input.projectId);
  store.db.prepare('DELETE FROM design_state_routes WHERE project_id = ? AND kind = ?').run(input.projectId, kind);
}
