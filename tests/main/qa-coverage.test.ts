import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { qaCoverageRoutes, removeQaCoverageRoute, runQaCoverageCell, saveQaCoverageRoute, QA_COVERAGE_MAX_AGE_MS } from '../../src/main/qa-coverage';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const url = 'http://127.0.0.1:5173/app';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-coverage-test-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'App' });
  const otherPath = join(root, 'other'); mkdirSync(otherPath);
  const other = store.createProject({ name: 'Other', path: otherPath });
  return { store, file, project, card, other };
}

function report(store: StudioStore, input: { id: string; projectId: string; cardId: string; status: string; endedAt: string; width: number; height: number; route?: string }) {
  store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, note, viewport_width, viewport_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)`).run(input.id, input.cardId, input.projectId, input.route ?? url, input.endedAt, input.endedAt, input.status, input.width, input.height);
}

describe('selected project QA coverage', () => {
  it('persists only selected targets, chooses newest exact card/route/size and shows missing, stale, failure and deletion', () => {
    const { store, file, project, card } = fixture();
    const selected = saveQaCoverageRoute(store, { projectId: project.id, cardId: card.id, url, viewports: ['tablet', 'mobile'] });
    expect(selected.cells.map((cell) => cell.state)).toEqual(['missing', 'missing']);
    const now = Date.parse('2026-11-24T14:00:00.000Z');
    const fresh = new Date(now - 1_000).toISOString();
    const old = new Date(now - QA_COVERAGE_MAX_AGE_MS - 1_000).toISOString();
    report(store, { id: 'old-tablet', projectId: project.id, cardId: card.id, status: 'passed', endedAt: old, width: 768, height: 1024 });
    report(store, { id: 'new-tablet', projectId: project.id, cardId: card.id, status: 'failed', endedAt: fresh, width: 768, height: 1024 });
    report(store, { id: 'old-mobile', projectId: project.id, cardId: card.id, status: 'error', endedAt: old, width: 390, height: 844 });
    report(store, { id: 'wrong-route', projectId: project.id, cardId: card.id, status: 'passed', endedAt: fresh, width: 390, height: 844, route: `${url}/other` });
    expect(qaCoverageRoutes(store, project.id, now)[0]?.cells).toMatchObject([
      { viewport: 'tablet', state: 'current', report: { id: 'new-tablet', status: 'failed' } },
      { viewport: 'mobile', state: 'stale', report: { id: 'old-mobile', status: 'error' } },
    ]);
    store.db.prepare("DELETE FROM card_qa_reports WHERE id IN ('new-tablet', 'old-tablet')").run();
    expect(qaCoverageRoutes(store, project.id, now)[0]?.cells[0]).toMatchObject({ state: 'missing', report: null });
    report(store, { id: 'future-tablet', projectId: project.id, cardId: card.id, status: 'passed', endedAt: new Date(now + 120_000).toISOString(), width: 768, height: 1024 });
    expect(qaCoverageRoutes(store, project.id, now)[0]?.cells[0]).toMatchObject({ state: 'stale', report: { id: 'future-tablet' } });
    store.db.prepare("DELETE FROM card_qa_reports WHERE id = 'future-tablet'").run();
    store.close();
    const reopened = new StudioStore(file);
    expect(qaCoverageRoutes(reopened, project.id, now)[0]?.cells.map((cell) => cell.state)).toEqual(['missing', 'stale']);
    reopened.close();
  });

  it('rejects non-local routes, query data, duplicates, foreign cards and excess routes', () => {
    const { store, project, card, other } = fixture();
    const input = { projectId: project.id, cardId: card.id, url, viewports: ['desktop' as const] };
    expect(() => saveQaCoverageRoute(store, { ...input, cardId: store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Foreign' }).id })).toThrow('diesem Projekt');
    expect(() => saveQaCoverageRoute(store, { ...input, url: 'https://example.invalid/app' })).toThrow('localhost');
    expect(() => saveQaCoverageRoute(store, { ...input, url: `${url}?token=synthetic` })).toThrow('ohne Query');
    expect(() => saveQaCoverageRoute(store, { ...input, viewports: ['desktop', 'desktop'] })).toThrow('unterschiedliche');
    const first = saveQaCoverageRoute(store, input);
    expect(saveQaCoverageRoute(store, { ...input, viewports: ['mobile'] }).id).toBe(first.id);
    expect(qaCoverageRoutes(store, project.id)[0]?.viewports).toEqual(['mobile']);
    for (let index = 1; index < 8; index++) saveQaCoverageRoute(store, { ...input, url: `http://127.0.0.1:5173/route-${index}` });
    expect(() => saveQaCoverageRoute(store, { ...input, url: 'http://127.0.0.1:5173/ninth' })).toThrow('Höchstens acht');
    expect(qaCoverageRoutes(store, other.id)).toEqual([]);
    expect(() => removeQaCoverageRoute(store, { projectId: other.id, routeId: first.id })).toThrow('diesem Projekt');
    store.close();
  });

  it('requires a selected viewport and active source card before any browser run', async () => {
    const { store, project, card, other } = fixture();
    const selected = saveQaCoverageRoute(store, { projectId: project.id, cardId: card.id, url, viewports: ['desktop'] });
    await expect(runQaCoverageCell(store, { projectId: other.id, routeId: selected.id, viewport: 'desktop' })).rejects.toThrow('diesem Projekt');
    await expect(runQaCoverageCell(store, { projectId: project.id, routeId: selected.id, viewport: 'mobile' })).rejects.toThrow('nicht ausgewählt');
    store.setCardArchived({ id: card.id, archived: true });
    await expect(runQaCoverageCell(store, { projectId: project.id, routeId: selected.id, viewport: 'desktop' })).rejects.toThrow('Archivierte Karte');
    removeQaCoverageRoute(store, { projectId: project.id, routeId: selected.id });
    expect(qaCoverageRoutes(store, project.id)).toEqual([]);
    store.close();
  });
});
