import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { clampBrowserBounds, isSafeBrowserUrl, normalizeBrowserAddress } from '../../src/main/browser-policy';
import { BrowserSessionPersistence } from '../../src/main/browser-persistence';

const mocked = vi.hoisted(() => ({
  views: [] as unknown[],
  permissionRequestHandler: null as null | ((_contents: unknown, permission: string, callback: (allowed: boolean) => void) => void),
  permissionCheckHandler: null as null | (() => boolean),
  downloadHandler: null as null | ((event: { preventDefault(): void }) => void),
  removedDownloadHandler: null as null | ((event: { preventDefault(): void }) => void),
  menus: [] as unknown[],
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeContents extends EventEmitter {
    url = '';
    title = '';
    destroyed = false;
    entries: string[] = [];
    index = -1;
    windowOpenHandler: unknown;
    navigationHistory = {
      canGoBack: () => this.index > 0,
      canGoForward: () => this.index < this.entries.length - 1,
      goBack: () => { if (this.index > 0) { this.url = this.entries[--this.index]!; this.emit('did-navigate'); } },
      goForward: () => { if (this.index < this.entries.length - 1) { this.url = this.entries[++this.index]!; this.emit('did-navigate'); } },
    };
    getURL() { return this.url; }
    getTitle() { return this.title; }
    isLoading() { return false; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    reload() { this.emit('did-start-loading'); this.emit('did-stop-loading'); }
    setWindowOpenHandler(handler: unknown) { this.windowOpenHandler = handler; }
    async loadURL(url: string) {
      this.emit('did-start-loading');
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push(url);
      this.index = this.entries.length - 1;
      this.url = url;
      this.title = 'Example';
      this.emit('did-navigate');
      this.emit('did-stop-loading');
    }
  }
  class FakeView {
    webContents = new FakeContents();
    bounds: unknown = null;
    constructor(public options: unknown) { mocked.views.push(this); }
    setBounds(bounds: unknown) { this.bounds = bounds; }
  }
  return {
    WebContentsView: FakeView,
    Menu: { buildFromTemplate: (template: unknown) => {
      mocked.menus.push(template);
      return { popup: vi.fn() };
    } },
    session: { fromPartition: () => ({
      setPermissionRequestHandler: (handler: typeof mocked.permissionRequestHandler) => { mocked.permissionRequestHandler = handler; },
      setPermissionCheckHandler: (handler: typeof mocked.permissionCheckHandler) => { mocked.permissionCheckHandler = handler; },
      on: (_event: string, handler: typeof mocked.downloadHandler) => { mocked.downloadHandler = handler; },
      removeListener: (_event: string, handler: typeof mocked.downloadHandler) => { mocked.removedDownloadHandler = handler; },
    }) },
  };
});

import { StudioBrowser } from '../../src/main/browser';

function fakeWindow() {
  const emitter = new EventEmitter();
  const attached: unknown[] = [];
  return Object.assign(emitter, {
    contentView: {
      addChildView(view: unknown) { attached.push(view); },
      removeChildView(view: unknown) { const index = attached.indexOf(view); if (index >= 0) attached.splice(index, 1); },
    },
    attached,
    getContentSize: () => [900, 700],
    isDestroyed: () => false,
  });
}

describe('browser URL and bounds policy', () => {
  it('accepts only web URLs without embedded credentials', () => {
    expect(normalizeBrowserAddress('example.com/path')).toBe('https://example.com/path');
    expect(normalizeBrowserAddress('http://localhost:3000')).toBe('http://localhost:3000/');
    for (const address of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,x', 'https://user:pass@example.com', 'example.com/path with space', '']) {
      expect(() => normalizeBrowserAddress(address)).toThrow();
    }
    expect(isSafeBrowserUrl('https://example.com')).toBe(true);
    expect(isSafeBrowserUrl('file:///etc/passwd')).toBe(false);
  });

  it('clamps web view bounds inside the app window', () => {
    expect(clampBrowserBounds({ x: 800, y: 600, width: 500, height: 500 }, [900, 700])).toEqual({ x: 800, y: 600, width: 100, height: 100 });
    expect(clampBrowserBounds({ x: -200, y: -20, width: 600, height: 200 }, [900, 700])).toEqual({ x: 0, y: 0, width: 400, height: 180 });
    expect(clampBrowserBounds({ x: 0, y: 0, width: 0, height: 0 }, [900, 700])).toBeNull();
    expect(() => clampBrowserBounds({ x: Number.NaN, y: 0, width: 100, height: 100 }, [900, 700])).toThrow();
  });
});

describe('isolated embedded browser', () => {
  it('navigates, attaches only while visible, denies permissions and blocks unsafe redirects', async () => {
    const window = fakeWindow();
    const events: string[] = [];
    const search = vi.fn();
    const browser = new StudioBrowser(window as unknown as BrowserWindow, (state) => events.push(state.url), search);
    browser.setBounds({ x: 100, y: 100, width: 600, height: 400 });
    browser.setVisible(true);
    expect(window.attached).toHaveLength(0);
    await browser.navigate('example.com');
    expect(browser.state().url).toBe('https://example.com/');
    expect(window.attached).toHaveLength(1);
    expect(events).toContain('https://example.com/');
    const view = mocked.views.at(-1) as { options: { webPreferences: Record<string, unknown> }; webContents: EventEmitter & { destroyed: boolean; windowOpenHandler: () => { action: string } } };
    expect(view.options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
    expect(view.windowOpenHandler).toBeUndefined();
    expect(view.webContents.windowOpenHandler().action).toBe('deny');
    let allowed: boolean | null = null;
    mocked.permissionRequestHandler?.(view.webContents, 'media', (decision) => { allowed = decision; });
    expect(allowed).toBe(false);
    expect(mocked.permissionCheckHandler?.()).toBe(false);
    const download = { preventDefault: vi.fn() };
    mocked.downloadHandler?.(download);
    expect(download.preventDefault).toHaveBeenCalledOnce();
    const unsafe = { url: 'file:///C:/secret', preventDefault: vi.fn() };
    view.webContents.emit('will-redirect', unsafe);
    expect(unsafe.preventDefault).toHaveBeenCalledOnce();
    const shortcut = { preventDefault: vi.fn() };
    view.webContents.emit('before-input-event', shortcut, { type: 'keyDown', control: true, meta: false, key: 'k' });
    expect(shortcut.preventDefault).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledOnce();
    browser.setVisible(false);
    expect(window.attached).toHaveLength(0);
    browser.dispose();
    expect(view.webContents.destroyed).toBe(true);
    expect(mocked.removedDownloadHandler).toBe(mocked.downloadHandler);
  });

  it('keeps independent history per tab and closes only the selected tab', async () => {
    const window = fakeWindow();
    const browser = new StudioBrowser(window as unknown as BrowserWindow, () => undefined);
    browser.setBounds({ x: 10, y: 10, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('first.example');
    const firstId = browser.state().activeTabId!;
    await browser.navigate('second.example');
    expect(browser.state().canGoBack).toBe(true);
    const secondId = browser.newTab().activeTabId!;
    expect(secondId).not.toBe(firstId);
    expect(browser.state().tabs).toHaveLength(2);
    await browser.navigate('third.example');
    expect(browser.state().canGoBack).toBe(false);
    expect(window.attached).toHaveLength(1);
    browser.selectTab(firstId);
    expect(browser.state().url).toBe('https://second.example/');
    expect(browser.back().url).toBe('https://first.example/');
    expect(browser.forward().url).toBe('https://second.example/');
    browser.selectTab(secondId);
    expect(browser.state().url).toBe('https://third.example/');
    expect(browser.state().canGoBack).toBe(false);
    browser.closeTab(firstId);
    expect(browser.state().tabs).toHaveLength(1);
    expect(browser.state().activeTabId).toBe(secondId);
    browser.closeTab(secondId);
    expect(browser.state().tabs).toHaveLength(0);
    expect(browser.state().activeTabId).toBeNull();
    expect(window.attached).toHaveLength(0);
    expect(() => browser.selectTab('missing')).toThrow('nicht gefunden');
    browser.dispose();
  });

  it('restores tabs and active URL after restart without loading hidden pages', async () => {
    const path = mkdtempSync(join(tmpdir(), 'studio-browser-restart-'));
    try {
      const persistence = new BrowserSessionPersistence(path);
      const first = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined, () => undefined, persistence);
      await first.navigate('https://first.test/path');
      const firstId = first.state().activeTabId!;
      first.newTab();
      first.selectTab(firstId);
      first.dispose();
      first.dispose();
      expect(persistence.load()).toEqual({ urls: ['https://first.test/path', null], activeIndex: 0 });

      const window = fakeWindow();
      const second = new StudioBrowser(window as unknown as BrowserWindow, () => undefined, () => undefined, persistence);
      expect(second.state().tabs).toHaveLength(2);
      expect(second.state().url).toBe('https://first.test/path');
      const restoredViews = mocked.views.slice(-2) as Array<{ webContents: { entries: string[] } }>;
      expect(restoredViews.every((view) => view.webContents.entries.length === 0)).toBe(true);
      second.setBounds({ x: 0, y: 0, width: 700, height: 500 });
      second.setVisible(true);
      expect(restoredViews[0]?.webContents.entries).toEqual(['https://first.test/path']);
      expect(restoredViews[1]?.webContents.entries).toEqual([]);
      second.dispose();
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('opens a safe page link only after the explicit context-menu action', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    browser.setBounds({ x: 0, y: 0, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('https://source.test/');
    const sourceId = browser.state().activeTabId;
    const view = mocked.views.at(-1) as { webContents: EventEmitter & { windowOpenHandler: () => { action: string } } };
    const menuCount = mocked.menus.length;
    view.webContents.emit('context-menu', {}, { linkURL: 'file:///C:/private.txt' });
    view.webContents.emit('context-menu', {}, { linkURL: '' });
    expect(mocked.menus).toHaveLength(menuCount);
    view.webContents.emit('context-menu', {}, { linkURL: 'https://destination.test/page' });
    expect(mocked.menus).toHaveLength(menuCount + 1);
    expect(browser.state().tabs).toHaveLength(1);
    const [item] = mocked.menus.at(-1) as Array<{ label: string; enabled: boolean; click: () => void }>;
    expect(item?.label).toBe('Link in neuem Tab öffnen');
    expect(item?.enabled).toBe(true);
    item?.click();
    await Promise.resolve();
    expect(browser.state().tabs).toHaveLength(2);
    expect(browser.state().activeTabId).not.toBe(sourceId);
    expect(browser.state().url).toBe('https://destination.test/page');
    expect(view.webContents.windowOpenHandler().action).toBe('deny');
    view.webContents.emit('context-menu', {}, { linkURL: 'https://other.test/' });
    expect(mocked.menus).toHaveLength(menuCount + 1);
    browser.dispose();
  });
});
