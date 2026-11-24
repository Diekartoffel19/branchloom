import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardQaReport, CardQaViewport } from '../shared/types';
import type { QaCoverageCell, QaCoverageRoute, SaveQaCoverageRoute } from '../shared/qa-coverage';
import { normalizeCardQaUrl, runCardQa } from './card-qa';
import type { StudioStore } from './store';

const VIEWPORTS: readonly CardQaViewport[] = ['desktop', 'tablet', 'mobile'];
const SIZES: Record<CardQaViewport, [number, number]> = { desktop: [1280, 800], tablet: [768, 1024], mobile: [390, 844] };
const MAX_ROUTES = 8;
export const QA_COVERAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type RouteRow = { id: string; project_id: string; card_id: string; url: string; viewports_json: string; created_at: string };
type ReportRow = { id: string; card_id: string; status: CardQaReport['status']; ended_at: string; page_check: CardQaReport['pageCheck']; page_observations_json: string };

export function installQaCoverage(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS qa_coverage_routes (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, url TEXT NOT NULL,
    viewports_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(project_id, card_id, url)
  ); CREATE INDEX IF NOT EXISTS qa_coverage_project ON qa_coverage_routes(project_id, created_at);`);
}

function checkedViewports(value: unknown): CardQaViewport[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3
    || value.some((item) => !VIEWPORTS.includes(item)) || new Set(value).size !== value.length) {
    throw new Error('Wähle eine bis drei unterschiedliche Prüfgrößen.');
  }
  return VIEWPORTS.filter((item) => value.includes(item));
}

function checkedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Die lokale Route darf höchstens 500 Zeichen haben.');
  const url = normalizeCardQaUrl(value);
  const parsed = new URL(url);
  if (parsed.search || parsed.hash) throw new Error('Für die Abdeckungsmatrix nur lokale Routen ohne Query oder Fragment wählen.');
  return url;
}

function route(store: StudioStore, projectId: string, routeId: string): RouteRow {
  store.project(projectId);
  const row = store.db.prepare('SELECT * FROM qa_coverage_routes WHERE id = ? AND project_id = ?').get(routeId, projectId) as RouteRow | undefined;
  if (!row) throw new Error('QA-Route gehört nicht zu diesem Projekt.');
  return row;
}

/** Only explicitly selected routes and sizes are shown; a saved report never creates a target. */
export function qaCoverageRoutes(store: StudioStore, projectId: string, now = Date.now()): QaCoverageRoute[] {
  store.project(projectId);
  const rows = store.db.prepare('SELECT * FROM qa_coverage_routes WHERE project_id = ? ORDER BY created_at, rowid LIMIT ?').all(projectId, MAX_ROUTES) as RouteRow[];
  return rows.map((row) => {
    const viewports = checkedViewports(JSON.parse(row.viewports_json));
    const cells: QaCoverageCell[] = viewports.map((viewport) => {
      const [width, height] = SIZES[viewport];
      const report = store.db.prepare(`SELECT id, card_id, status, ended_at, page_check, page_observations_json FROM card_qa_reports
        WHERE project_id = ? AND card_id = ? AND requested_url = ? AND viewport_width = ? AND viewport_height = ?
        ORDER BY ended_at DESC, rowid DESC LIMIT 1`).get(projectId, row.card_id, row.url, width, height) as ReportRow | undefined;
      const age = report ? now - Date.parse(report.ended_at) : Number.NaN;
      const state = !report ? 'missing' : !Number.isFinite(age) || age < -60_000 || age > QA_COVERAGE_MAX_AGE_MS ? 'stale' : 'current';
      return { viewport, state, report: report ? { id: report.id, cardId: report.card_id, status: report.status, endedAt: report.ended_at,
        pageCheck: report.page_check, observationCount: (JSON.parse(report.page_observations_json) as unknown[]).length } : null };
    });
    return { id: row.id, projectId: row.project_id, cardId: row.card_id, url: row.url, viewports, createdAt: row.created_at, cells };
  });
}

export function saveQaCoverageRoute(store: StudioStore, input: SaveQaCoverageRoute): QaCoverageRoute {
  const project = store.project(input.projectId);
  const card = store.card(input.cardId);
  if (card.projectId !== project.id) throw new Error('Karte gehört nicht zu diesem Projekt.');
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const url = checkedUrl(input.url);
  const viewports = checkedViewports(input.viewports);
  const existing = store.db.prepare('SELECT id FROM qa_coverage_routes WHERE project_id = ? AND card_id = ? AND url = ?')
    .get(project.id, card.id, url) as { id: string } | undefined;
  if (!existing) {
    const count = (store.db.prepare('SELECT COUNT(*) AS count FROM qa_coverage_routes WHERE project_id = ?').get(project.id) as { count: number }).count;
    if (count >= MAX_ROUTES) throw new Error('Höchstens acht lokale QA-Routen pro Projekt.');
  }
  const id = existing?.id ?? randomUUID();
  store.db.prepare(`INSERT INTO qa_coverage_routes (id, project_id, card_id, url, viewports_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, card_id, url) DO UPDATE SET viewports_json = excluded.viewports_json`)
    .run(id, project.id, card.id, url, JSON.stringify(viewports), new Date().toISOString());
  return qaCoverageRoutes(store, project.id).find((item) => item.id === id)!;
}

export function removeQaCoverageRoute(store: StudioStore, input: { projectId: string; routeId: string }): void {
  route(store, input.projectId, input.routeId);
  store.db.prepare('DELETE FROM qa_coverage_routes WHERE id = ? AND project_id = ?').run(input.routeId, input.projectId);
}

/** A cell run is explicit and reuses the existing isolated local Browser QA path. */
export async function runQaCoverageCell(store: StudioStore, input: { projectId: string; routeId: string; viewport: CardQaViewport }): Promise<CardQaReport> {
  const selected = route(store, input.projectId, input.routeId);
  if (!checkedViewports(JSON.parse(selected.viewports_json)).includes(input.viewport)) throw new Error('Prüfgröße ist für diese Route nicht ausgewählt.');
  return runCardQa(store, { cardId: selected.card_id, url: selected.url, viewport: input.viewport });
}
