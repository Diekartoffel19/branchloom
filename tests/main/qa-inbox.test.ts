import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { acknowledgeQaInboxReport, reviewInboxItems } from '../../src/main/review-inbox';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* Already closed. */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-qa-inbox-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[1]!;
  const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'QA card' });
  return { root, file, store, project, column, card };
}

function insertReport(store: StudioStore, projectId: string, cardId: string, id: string, status: 'passed' | 'failed' | 'error', endedAt = '2026-01-01T10:00:00.000Z') {
  const diagnostics = status === 'failed' ? [{ id: `diag-${id}`, kind: 'console', message: `Synthetic console ${id}`, pageUrl: 'http://127.0.0.1:5173/path', sourceUrl: null, line: null, capturedAt: endedAt }] : [];
  store.db.prepare(`INSERT INTO card_qa_reports (id,card_id,project_id,requested_url,final_url,started_at,ended_at,status,diagnostics_json,note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, cardId, projectId, 'http://127.0.0.1:5173/path', null, endedAt, endedAt, status, JSON.stringify(diagnostics), status === 'error' ? 'Synthetic timeout' : null);
}

describe('failed local Browser-QA in the Decision Inbox', () => {
  it('lists only failed/error reports with route and diagnosis, bounded search, and isolated acknowledgement', () => {
    const { root, file, store, project, card } = fixture();
    insertReport(store, project.id, card.id, 'failed-report', 'failed');
    insertReport(store, project.id, card.id, 'error-report', 'error');
    insertReport(store, project.id, card.id, 'passed-report', 'passed');
    const page = reviewInboxItems(store, { projectId: project.id });
    expect(page.items).toHaveLength(2);
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'failed-report', kind: 'qa', sourceId: card.id, sourceTitle: 'QA card', createdAt: '2026-01-01T10:00:00.000Z', qaStatus: 'failed', location: expect.stringContaining('/path'), body: expect.stringContaining('Synthetic console failed-report') }),
      expect.objectContaining({ id: 'error-report', kind: 'qa', qaStatus: 'error', body: expect.stringContaining('Synthetic timeout') }),
    ]));
    expect(reviewInboxItems(store, { projectId: project.id, query: 'CONSOLE FAILED-REPORT' }).items.map((item) => item.id)).toEqual(['failed-report']);
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(reviewInboxItems(store, { projectId: other.id }).items).toEqual([]);
    expect(() => acknowledgeQaInboxReport(store, { projectId: other.id, reportId: 'failed-report' })).toThrow('aktiven Projekt');
    expect(() => acknowledgeQaInboxReport(store, { projectId: project.id, reportId: 'passed-report' })).toThrow();
    acknowledgeQaInboxReport(store, { projectId: project.id, reportId: 'failed-report' });
    acknowledgeQaInboxReport(store, { projectId: project.id, reportId: 'failed-report' });
    expect(reviewInboxItems(store, { projectId: project.id }).items.map((item) => item.id)).toEqual(['error-report']);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    expect(store.snapshot(project.id).workflows).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(file); stores.push(reopened);
    expect(reviewInboxItems(reopened, { projectId: project.id }).items.map((item) => item.id)).toEqual(['error-report']);
    expect(reopened.db.prepare('SELECT COUNT(*) AS count FROM card_qa_reports').get()).toEqual({ count: 3 });
  });

  it('hides archived cards and removes the acknowledgement with its deleted report', () => {
    const { store, project, card } = fixture();
    insertReport(store, project.id, card.id, 'removed-report', 'failed');
    acknowledgeQaInboxReport(store, { projectId: project.id, reportId: 'removed-report' });
    store.db.prepare('DELETE FROM card_qa_reports WHERE id = ?').run('removed-report');
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM qa_inbox_acknowledgements').get()).toEqual({ count: 0 });
    expect(() => acknowledgeQaInboxReport(store, { projectId: project.id, reportId: 'removed-report' })).toThrow();
    insertReport(store, project.id, card.id, 'archived-report', 'error');
    store.db.prepare('UPDATE cards SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
    expect(reviewInboxItems(store, { projectId: project.id }).items).toEqual([]);
    expect(() => acknowledgeQaInboxReport(store, { projectId: project.id, reportId: 'archived-report' })).toThrow();
  });

  it('pages more than 100 QA reports and finds an older report through server search', () => {
    const { store, project, column, card } = fixture();
    const cards = [card, ...Array.from({ length: 5 }, (_, index) => store.createCard({ projectId: project.id, columnId: column.id, title: `Extra ${index}` }))];
    for (let index = 0; index < 102; index++) insertReport(store, project.id, cards[Math.floor(index / 20)]!.id, `qa-${index}`, 'failed', new Date(2026, 0, 1, 0, index).toISOString());
    const first = reviewInboxItems(store, { projectId: project.id });
    expect(first.items).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(reviewInboxItems(store, { projectId: project.id, offset: 100 }).items).toHaveLength(2);
    expect(reviewInboxItems(store, { projectId: project.id, query: 'qa-0' }).items.map((item) => item.id)).toEqual(['qa-0']);
  });
});
