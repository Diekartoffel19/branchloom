import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ windows: [] as Array<{ options: { show: boolean; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }; destroyed: boolean; webContents: unknown }>, mode: 'clean' as 'clean' | 'console' | 'remote' | 'load-error' }));
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
      if (fake.mode === 'load-error') throw new Error(`ERR_CONNECTION_REFUSED: ${url}`);
      if (fake.mode === 'console') this.emit('console-message', { level: 'error', message: 'Synthetic TypeError', sourceId: `${new URL(url).origin}/app.js?token=private`, lineNumber: 7 });
      if (fake.mode === 'remote') this.requestHandler?.({ url: 'https://example.invalid/asset.js?token=private' }, () => undefined);
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
import { cardQaReports, normalizeCardQaUrl, runCardQa } from '../../src/main/card-qa';

const roots: string[] = [];
afterEach(() => { fake.mode = 'clean'; fake.windows.length = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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
    expect(report).toMatchObject({ status: 'failed', requestedUrl: 'http://127.0.0.1:5173/page', finalUrl: 'http://127.0.0.1:5173/page' });
    expect(report.diagnostics[0]).toMatchObject({ message: 'Synthetic TypeError', sourceUrl: 'http://127.0.0.1:5173/app.js', line: 7 });
    expect(fake.windows[0]).toMatchObject({ destroyed: true, options: { show: false, webPreferences: { sandbox: true, nodeIntegration: false, webSecurity: true } } });
    expect(fake.windows[0]!.options.webPreferences.partition).not.toContain('persist:');
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id)).toEqual([report]);
    reopened.close();
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
    expect(failed.note).toContain('ERR_CONNECTION_REFUSED');
    expect(JSON.stringify(failed)).not.toContain('token=private');
    fake.mode = 'clean';
    expect((await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/' })).status).toBe('passed');
    store.close();
  });
});
