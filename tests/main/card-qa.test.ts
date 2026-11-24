import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const fake = vi.hoisted(() => ({ windows: [] as Array<{ options: { show: boolean; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }; destroyed: boolean; webContents: unknown }>, mode: 'clean' as 'clean' | 'console' | 'remote' | 'load-error' | 'capture-error' | 'capture-large' | 'capture-empty' | 'slow', releases: [] as Array<() => void> }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    url = '';
    permissionRequestHandler: unknown;
    permissionCheckHandler: unknown;
    requestHandler: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | null = null;
    session = {
      setPermissionRequestHandler: (handler: unknown) => { this.permissionRequestHandler = handler; },
      setPermissionCheckHandler: (handler: unknown) => { this.permissionCheckHandler = handler; },
      on: (_event: string, _handler: unknown) => undefined,
      webRequest: { onBeforeRequest: (_filter: unknown, handler: typeof this.requestHandler) => { this.requestHandler = handler; } },
    };
    setWindowOpenHandler(_handler: unknown) { /* observed through the page not opening */ }
    getURL() { return this.url; }
    async loadURL(url: string) {
      this.url = url;
      if (fake.mode === 'slow') return new Promise<void>((resolve) => { fake.releases.push(resolve); });
      if (fake.mode === 'load-error') throw new Error(`ERR_CONNECTION_REFUSED: ${url}`);
      if (fake.mode === 'console') this.emit('console-message', { level: 'error', message: 'Synthetic TypeError', sourceId: `${new URL(url).origin}/app.js?token=private`, lineNumber: 7 });
      if (fake.mode === 'remote') this.requestHandler?.({ url: 'https://example.invalid/asset.js?token=private' }, () => undefined);
    }
    async capturePage() {
      if (fake.mode === 'capture-error') throw new Error('Synthetic capture failure');
      const bytes = fake.mode === 'capture-large' ? Buffer.alloc(1_000_001) : fake.mode === 'capture-empty' ? Buffer.alloc(0) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4bPgAAAAASUVORK5CYII=', 'base64');
      const image = { getSize: () => ({ width: 1280, height: 800 }), resize: (_size: { width: number; height: number }) => image, toPNG: () => bytes };
      return image;
    }
  }
  return { BrowserWindow: class {
    destroyed = false;
    webContents = new Contents();
    constructor(public options: { show: boolean; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }) { fake.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  } };
});

import { StudioStore } from '../../src/main/store';
import { cardQaReports, cardQaScreenshot, normalizeCardQaUrl, runCardQa } from '../../src/main/card-qa';

const roots: string[] = [];
afterEach(() => { for (const release of fake.releases.splice(0)) release(); fake.mode = 'clean'; fake.windows.length = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-qa-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic QA', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Check page' });
  return { file, store, project, card };
}

describe('explicit local card QA', () => {
  it('rejects remote, credential and non-web URLs before creating a browser or report', async () => {
    const { store, card } = fixture();
    expect(normalizeCardQaUrl('http://127.0.0.1:5173/?token=private')).toContain('127.0.0.1');
    for (const url of ['https://example.com/', 'https://localhost.evil.example/', 'file:///etc/passwd', 'http://user:pass@localhost:5173/']) {
      await expect(runCardQa(store, { cardId: card.id, url })).rejects.toThrow();
    }
    expect(fake.windows).toHaveLength(0);
    expect(cardQaReports(store, card.id)).toEqual([]);
    store.close();
  });

  it('records a sandboxed page error with sanitized source, persists it, and never starts an agent', async () => {
    const { file, store, project, card } = fixture();
    fake.mode = 'console';
    const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/page?token=private' });
    expect(report).toMatchObject({ status: 'failed', requestedUrl: 'http://127.0.0.1:5173/page', finalUrl: 'http://127.0.0.1:5173/page', screenshotAvailable: true, viewportWidth: 1280, viewportHeight: 800 });
    expect(report.diagnostics[0]).toMatchObject({ message: 'Synthetic TypeError', sourceUrl: 'http://127.0.0.1:5173/app.js', line: 7 });
    expect(fake.windows[0]).toMatchObject({ destroyed: true, options: { show: false, webPreferences: { sandbox: true, nodeIntegration: false, webSecurity: true } } });
    expect(fake.windows[0]!.options.webPreferences.partition).not.toContain('persist:');
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    expect(cardQaScreenshot(store, { cardId: card.id, reportId: report.id })).toMatch(/^data:image\/png;base64,/);
    store.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id)).toEqual([report]);
    reopened.close();
  });

  it('requires the matching card for a persisted screenshot', async () => {
    const { store, project, card } = fixture();
    const other = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Other' });
    const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/' });
    expect(() => cardQaScreenshot(store, { cardId: other.id, reportId: report.id })).toThrow('gehört nicht');
    store.close();
  });

  it('blocks requests outside the selected origin and distinguishes a clean limited pass', async () => {
    const { store, card } = fixture();
    fake.mode = 'remote';
    const blocked = await runCardQa(store, { cardId: card.id, url: 'http://localhost:5173/' });
    expect(blocked.status).toBe('failed');
    expect(blocked.diagnostics[0]?.message).toContain('blockiert');
    expect(JSON.stringify(blocked)).not.toContain('token=private');
    fake.mode = 'clean';
    const clean = await runCardQa(store, { cardId: card.id, url: 'http://localhost:5173/' });
    expect(clean.status).toBe('passed');
    expect(clean.diagnostics).toEqual([]);
    expect(cardQaReports(store, card.id).map((item) => item.id)).toEqual([clean.id, blocked.id]);
    store.close();
  });

  it('stores load failures without query values and releases the card for retry', async () => {
    const { store, card } = fixture();
    fake.mode = 'load-error';
    const failed = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/?token=private' });
    expect(failed.status).toBe('error');
    expect(failed.screenshotAvailable).toBe(false);
    expect(failed.note).toContain('ERR_CONNECTION_REFUSED');
    expect(JSON.stringify(failed)).not.toContain('token=private');
    fake.mode = 'clean';
    expect((await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/' })).status).toBe('passed');
    store.close();
  });

  it('keeps the QA result when screenshot capture fails, is empty, or exceeds the byte limit', async () => {
    const { store, card } = fixture();
    for (const mode of ['capture-error', 'capture-empty', 'capture-large'] as const) {
      fake.mode = mode;
      const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/' });
      expect(report).toMatchObject({ status: 'passed', screenshotAvailable: false, note: expect.stringContaining('Screenshot konnte nicht') });
      expect(() => cardQaScreenshot(store, { cardId: card.id, reportId: report.id })).toThrow('kein gültiger Screenshot');
    }
    store.close();
  });

  it('caps retained screenshots across cards without dropping the older QA reports', async () => {
    const { store, project, card } = fixture();
    const insert = store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, note, screenshot_png)
      VALUES (?, ?, ?, 'http://127.0.0.1/', 'http://127.0.0.1/', '2100-01-01', '2100-01-01', 'passed', '[]', NULL, ?)`);
    let oldestCardId = '';
    for (let index = 0; index < 100; index++) {
      const oldCard = store.createCard({ projectId: project.id, columnId: card.columnId, title: `Old ${index}` });
      if (index === 0) oldestCardId = oldCard.id;
      insert.run(`old-${index}`, oldCard.id, project.id, Buffer.from('synthetic'));
    }
    insert.run('future-same-card', card.id, project.id, Buffer.from('synthetic'));
    const newest = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/' });
    const retained = store.db.prepare('SELECT COUNT(*) AS count FROM card_qa_reports WHERE screenshot_png IS NOT NULL').get() as { count: number };
    expect(retained.count).toBe(100);
    expect(newest.screenshotAvailable).toBe(true);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM card_qa_reports').get()).toMatchObject({ count: 102 });
    expect(cardQaReports(store, card.id)[0]?.id).toBe(newest.id);
    expect(() => cardQaScreenshot(store, { cardId: oldestCardId, reportId: 'old-0' })).toThrow('kein gültiger Screenshot');
    store.close();
  });

  it('adds the screenshot column to an existing QA report table on upgrade', async () => {
    const { store, file, card } = fixture();
    const old = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/old' });
    store.close();
    const legacy = new Database(file);
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN screenshot_png');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN viewport_width');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN viewport_height');
    legacy.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id).find((item) => item.id === old.id)).toMatchObject({ viewportWidth: 0, viewportHeight: 0, screenshotAvailable: false });
    const report = await runCardQa(reopened, { cardId: card.id, url: 'http://127.0.0.1:5173/' });
    expect(report).toMatchObject({ screenshotAvailable: true, viewportWidth: 1280, viewportHeight: 800 });
    reopened.close();
  });

  it('limits concurrent hidden QA windows across different cards', async () => {
    const { store, project, card } = fixture();
    const second = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Second' });
    const third = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Third' });
    fake.mode = 'slow';
    const firstRun = runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/' });
    const secondRun = runCardQa(store, { cardId: second.id, url: 'http://127.0.0.1:5173/' });
    expect(fake.releases).toHaveLength(2);
    await expect(runCardQa(store, { cardId: third.id, url: 'http://127.0.0.1:5173/' })).rejects.toThrow('zwei lokale QA-Prüfungen');
    for (const release of fake.releases.splice(0)) release();
    expect((await Promise.all([firstRun, secondRun])).map((report) => report.status)).toEqual(['passed', 'passed']);
    fake.mode = 'clean';
    expect((await runCardQa(store, { cardId: third.id, url: 'http://127.0.0.1:5173/' })).status).toBe('passed');
    store.close();
  });
});
