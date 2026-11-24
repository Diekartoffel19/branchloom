import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ windows: [] as Array<{ options: { width: number; height: number; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }; destroyed: boolean; webContents: unknown; width: number; height: number }>, failTablet: false, pauseDesktop: false, redirectMobile: false }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { BrowserWindow: class {
    destroyed = false;
    width: number;
    height: number;
    webContents: EventEmitter & Record<string, unknown>;
    constructor(public options: { width: number; height: number; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }) {
      this.width = options.width; this.height = options.height;
      const session = Object.assign(new EventEmitter(), {
        permissionRequest: null as unknown,
        permissionCheck: null as unknown,
        request: null as unknown,
        setPermissionRequestHandler(handler: unknown) { this.permissionRequest = handler; },
        setPermissionCheckHandler(handler: unknown) { this.permissionCheck = handler; },
        webRequest: { onBeforeRequest: (_filter: unknown, handler: unknown) => { session.request = handler; } },
      });
      this.webContents = Object.assign(new EventEmitter(), {
        url: '', session,
        setWindowOpenHandler: (_handler: unknown) => undefined,
        async loadURL(url: string) {
          if (fake.failTablet && options.width === 768) throw new Error('synthetic tablet failure');
          this.url = fake.redirectMobile && options.width === 390 ? new URL('/mobile', url).href : url;
        },
        getURL() { return this.url; },
        async capturePage() {
          if (fake.pauseDesktop && options.width === 1280) await new Promise(() => undefined);
          const buffer = Buffer.from(`PNG:${options.width}x${options.height}`);
          return { getSize: () => ({ width: options.width, height: options.height }), resize: () => ({ toPNG: () => buffer }), toPNG: () => buffer };
        },
      });
      fake.windows.push(this);
    }
    setContentSize(width: number, height: number) { this.width = width; this.height = height; }
    getContentSize() { return [this.width, this.height]; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  } };
});

import { captureDesignViewports } from '../../src/main/design-viewports';

describe('design viewport snapshots', () => {
  it('rejects remote destinations before creating a browser', async () => {
    fake.windows.length = 0;
    await expect(captureDesignViewports('project', 'https://example.com/', new AbortController().signal)).rejects.toThrow('lokale');
    expect(fake.windows).toHaveLength(0);
  });

  it('uses exact sizes, fresh sandboxed partitions, blocks other origins, and closes every browser', async () => {
    fake.windows.length = 0; fake.failTablet = false;
    const result = await captureDesignViewports('project', 'http://127.0.0.1:5173/page?secret=local#top', new AbortController().signal);
    expect(result.sourceUrl).toBe('http://127.0.0.1:5173/page');
    expect(result.captures.map((item) => [item.size, item.width, item.height, Boolean(item.image), item.error])).toEqual([
      ['desktop', 1280, 800, true, null], ['tablet', 768, 1024, true, null], ['mobile', 390, 844, true, null],
    ]);
    expect(result.captures.every((item) => item.capturedAt && item.image?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(fake.windows).toHaveLength(3);
    expect(fake.windows.map((item) => [item.width, item.height])).toEqual([[1280, 800], [768, 1024], [390, 844]]);
    expect(new Set(fake.windows.map((item) => item.options.webPreferences.partition)).size).toBe(3);
    for (const preview of fake.windows) {
      expect(preview.destroyed).toBe(true);
      expect(preview.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, webSecurity: true });
      expect(preview.options.webPreferences.partition).not.toContain('persist:');
      const contents = preview.webContents as EventEmitter & { session: { request: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void; permissionRequest: unknown; permissionCheck: unknown } };
      let decision: { cancel: boolean } | null = null;
      contents.session.request({ url: 'https://example.com/pixel' }, (value) => { decision = value; });
      expect(decision).toEqual({ cancel: true });
      contents.session.request({ url: 'http://127.0.0.1:5173/theme.css' }, (value) => { decision = value; });
      expect(decision).toEqual({ cancel: false });
      const navigation = { url: 'https://example.com/', preventDefault: vi.fn() };
      contents.emit('will-navigate', navigation);
      expect(navigation.preventDefault).toHaveBeenCalled();
    }
  });

  it('keeps other sizes when one load fails and stops before opening on cancellation', async () => {
    fake.windows.length = 0; fake.failTablet = true; fake.redirectMobile = true;
    const result = await captureDesignViewports('project', 'http://localhost:5173/', new AbortController().signal);
    expect(result.captures.map((item) => Boolean(item.image))).toEqual([true, false, true]);
    expect(result.captures[1]?.error).toContain('synthetic tablet failure');
    expect(result.captures[2]?.sourceUrl).toBe('http://localhost:5173/mobile');
    const controller = new AbortController();
    controller.abort();
    await expect(captureDesignViewports('project', 'http://localhost:5173/', controller.signal)).rejects.toThrow('abgebrochen');
    expect(fake.windows).toHaveLength(3);
    fake.failTablet = false; fake.redirectMobile = false;
  });

  it('destroys the active browser and skips later sizes after cancellation', async () => {
    fake.windows.length = 0; fake.pauseDesktop = true;
    const controller = new AbortController();
    const pending = captureDesignViewports('project', 'http://localhost:5173/', controller.signal);
    for (let attempt = 0; attempt < 20 && fake.windows.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.windows).toHaveLength(1);
    controller.abort();
    await expect(pending).rejects.toThrow('abgebrochen');
    expect(fake.windows[0]?.destroyed).toBe(true);
    expect(fake.windows).toHaveLength(1);
    fake.pauseDesktop = false;
  });
});
