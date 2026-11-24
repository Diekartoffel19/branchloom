import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const fake = vi.hoisted(() => ({ views: [] as Array<{ webContents: unknown; options: { webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } } }>, nullSelection: false }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    url = '';
    destroyed = false;
    request: ((details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void) | null = null;
    download: ((event: { preventDefault(): void }) => void) | null = null;
    removedDownload: unknown = null;
    permissions: unknown = null;
    checks: unknown = null;
    session = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: (handler: unknown) => { this.permissions = handler; },
      setPermissionCheckHandler: (handler: unknown) => { this.checks = handler; },
      webRequest: { onBeforeRequest: (_filter: unknown, handler?: typeof this.request) => { this.request = handler ?? null; } },
    });
    constructor() { super(); this.session.on('will-download', (handler) => { this.download = handler; }); }
    getURL() { return this.url; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    setWindowOpenHandler(_handler: unknown) { /* one-page preview */ }
    async loadURL(url: string) { this.url = url; }
    async executeJavaScript(script: string) {
      if (script.includes('root.style.setProperty')) return { original: '', priority: '', applied: '#aabbcc' };
      if (script.includes('root.style.removeProperty')) return true;
      return fake.nullSelection ? null : { selector: 'button#save', tag: 'button', text: 'Save', styles: { color: 'rgb(1, 2, 3)' }, tokens: [{ name: '--ink', value: '#010203' }] };
    }
  }
  return { WebContentsView: class {
    webContents = new Contents();
    constructor(public options: { webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }) { fake.views.push(this); }
    setBounds(_bounds: unknown) { /* no rendering in unit test */ }
  } };
});

import { StudioStore } from '../../src/main/store';
import { DesignInspector, designSelections } from '../../src/main/design-inspection';
import { scanThemeTokens } from '../../src/main/theme-tokens';

const roots: string[] = [];
afterEach(() => { fake.views.length = 0; fake.nullSelection = false; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('isolated design browser', () => {
  it('revalidates a scanned token, isolates projects, and forgets a preview when closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-theme-browser-')); roots.push(root);
    const repo = join(root, 'repo'); mkdirSync(repo);
    writeFileSync(join(repo, 'theme.css'), ':root { --ink: #010203; }\n');
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'add', '--', 'theme.css']);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'One', path: repo });
    const otherRepo = join(root, 'other'); mkdirSync(otherRepo);
    const other = store.createProject({ name: 'Two', path: otherRepo });
    const win = Object.assign(new EventEmitter(), { contentView: { addChildView: () => undefined, removeChildView: () => undefined }, getContentSize: () => [1000, 700], isDestroyed: () => false }) as unknown as BrowserWindow;
    const inspector = new DesignInspector(win, store, () => undefined);
    inspector.setBounds({ x: 0, y: 0, width: 400, height: 300 });
    inspector.setVisible(true);
    await inspector.start({ projectId: project.id, url: 'http://127.0.0.1:5173/' });
    const token = (await scanThemeTokens(store, project.id)).definitions[0]!;
    const input = { projectId: project.id, token, value: '#aabbcc' };
    await expect(inspector.applyThemePreview({ ...input, projectId: other.id })).rejects.toThrow();
    await expect(inspector.applyThemePreview({ ...input, value: 'url(https://example.com/a)' })).rejects.toThrow();
    await expect(inspector.applyThemePreview({ ...input, token: { ...token, sourceFingerprint: 'stale' } })).rejects.toThrow();
    writeFileSync(join(repo, 'theme.css'), ':root { --ink: #445566; }\n');
    await expect(inspector.applyThemePreview(input)).rejects.toThrow('veraltet');
    writeFileSync(join(repo, 'theme.css'), ':root { --ink: #010203; }\n');
    expect((await inspector.applyThemePreview(input)).themePreview).toMatchObject({ name: '--ink', value: '#aabbcc' });
    expect(readFileSync(join(repo, 'theme.css'), 'utf8')).toBe(':root { --ink: #010203; }\n');
    expect(designSelections(store, project.id)).toEqual([]);
    await expect(inspector.applyThemePreview(input)).rejects.toThrow('Setze zuerst');
    expect((await inspector.resetThemePreview(project.id)).themePreview).toBeNull();
    await inspector.applyThemePreview(input);
    (fake.views[0]!.webContents as EventEmitter).emit('did-start-navigation');
    expect(inspector.state().themePreview).toBeNull();
    await inspector.applyThemePreview(input);
    inspector.close();
    expect(inspector.state().themePreview).toBeNull();
    await expect(inspector.resetThemePreview(project.id)).rejects.toThrow();
    inspector.dispose(); store.close();
  });
  it('blocks foreign requests/navigation, denies privileges, records only explicit selection, and closes its view', async () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-design-browser-')); roots.push(root);
    const repo = join(root, 'repo'); mkdirSync(repo);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'Synthetic', path: repo });
    const attached: unknown[] = [];
    const win = Object.assign(new EventEmitter(), { contentView: { addChildView: (view: unknown) => attached.push(view), removeChildView: (view: unknown) => { const i = attached.indexOf(view); if (i >= 0) attached.splice(i, 1); } }, getContentSize: () => [1000, 700], isDestroyed: () => false }) as unknown as BrowserWindow;
    const emitted: string[] = [];
    const inspector = new DesignInspector(win, store, (selection) => emitted.push(selection.selector));
    await expect(inspector.start({ projectId: project.id, url: 'https://example.com/' })).rejects.toThrow();
    expect(fake.views).toHaveLength(0);
    inspector.setBounds({ x: 10, y: 20, width: 400, height: 300 });
    inspector.setVisible(true);
    expect((await inspector.start({ projectId: project.id, url: 'http://127.0.0.1:5173/page?token=secret' })).ready).toBe(true);
    expect(attached).toHaveLength(1);
    const view = fake.views[0]!;
    expect(view.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, webSecurity: true });
    expect(view.options.webPreferences.partition).not.toContain('persist:');
    const contents = view.webContents as { request: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void; permissions: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void; checks: () => boolean; emit: (event: string, ...args: unknown[]) => void; destroyed: boolean };
    let decision: { cancel: boolean } | null = null;
    contents.request({ url: 'https://example.com/asset.js' }, (value) => { decision = value; });
    expect(decision).toEqual({ cancel: true });
    contents.request({ url: 'http://127.0.0.1:5173/app.js' }, (value) => { decision = value; });
    expect(decision).toEqual({ cancel: false });
    let permission = true;
    contents.permissions(null, 'camera', (allowed) => { permission = allowed; });
    expect(permission).toBe(false);
    expect(contents.checks()).toBe(false);
    const navigate = { preventDefault: vi.fn(), url: 'https://example.com/' };
    contents.emit('will-navigate', navigate);
    expect(navigate.preventDefault).toHaveBeenCalledOnce();
    expect(designSelections(store, project.id)).toEqual([]);
    const blockedClick = { preventDefault: vi.fn() };
    contents.emit('before-mouse-event', blockedClick, { type: 'mouseUp', button: 'left', x: 50, y: 40 });
    expect(blockedClick.preventDefault).toHaveBeenCalledOnce();
    expect(designSelections(store, project.id)).toEqual([]);
    inspector.arm(project.id);
    fake.nullSelection = true;
    contents.emit('before-mouse-event', { preventDefault: vi.fn() }, { type: 'mouseUp', button: 'left', x: 50, y: 40 });
    for (let attempt = 0; attempt < 10 && !inspector.state().armed; attempt++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inspector.state().armed).toBe(true);
    expect(designSelections(store, project.id)).toEqual([]);
    fake.nullSelection = false;
    contents.emit('before-mouse-event', { preventDefault: vi.fn() }, { type: 'mouseUp', button: 'left', x: 50, y: 40 });
    for (let attempt = 0; attempt < 10 && designSelections(store, project.id).length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(designSelections(store, project.id)).toHaveLength(1);
    expect(inspector.state().armed).toBe(false);
    expect((await inspector.selectSelector(project.id, '#save')).selector).toBe('button#save');
    expect(emitted).toEqual(['button#save', 'button#save']);
    expect(designSelections(store, project.id)[0]?.sourceUrl).toBe('http://127.0.0.1:5173/page');
    await expect(inspector.start({ projectId: project.id, url: 'https://example.com/' })).rejects.toThrow();
    expect(inspector.state().ready).toBe(false);
    inspector.setVisible(false);
    expect(attached).toHaveLength(0);
    expect(contents.destroyed).toBe(true);
    expect(inspector.state().ready).toBe(false);
    inspector.dispose();
    store.close();
  });
});
