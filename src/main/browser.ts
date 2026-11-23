import { randomUUID } from 'node:crypto';
import { ClipboardItem, clipboard, Menu, session, shell, WebContentsView, type BrowserWindow, type Session } from 'electron';
import type { BrowserBounds, BrowserCaptureResult, BrowserDiagnostic, BrowserState, BrowserTabState } from '../shared/types';
import { clampBrowserBounds, diagnosticSource, isLocalDevUrl, isSafeBrowserUrl, normalizeBrowserAddress } from './browser-policy';
import { BrowserSessionPersistence, MAX_BROWSER_TABS } from './browser-persistence';

const PARTITION = 'persist:jarvis-studio-browser';
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

interface Tab { id: string; view: WebContentsView; requestedUrl: string; restoredUrl: string | null; error: string | null; diagnostics: BrowserDiagnostic[] }

export class StudioBrowser {
  private readonly tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private attachedTabId: string | null = null;
  private visible = false;
  private bounds: BrowserBounds | null = null;
  private readonly browserSession: Session;
  private readonly preventDownload = (event: Electron.Event): void => event.preventDefault();
  private persistTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly window: BrowserWindow, private readonly emit: (state: BrowserState) => void, private readonly onSearchShortcut: () => void = () => undefined, private readonly persistence: BrowserSessionPersistence | null = null) {
    this.browserSession = session.fromPartition(PARTITION);
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
    this.browserSession.on('will-download', this.preventDownload);
    this.window.on('resize', () => this.layout());
    const saved = this.persistence?.load();
    if (saved) {
      for (const url of saved.urls) this.createTab(url);
      this.activeTabId = this.tabs[saved.activeIndex]?.id ?? null;
    }
  }

  state(): BrowserState {
    const tabs = this.tabs.map((tab) => this.tabState(tab));
    const active = tabs.find((tab) => tab.id === this.activeTabId);
    return {
      tabs,
      activeTabId: active?.id ?? null,
      url: active?.url ?? '',
      title: active?.title ?? '',
      loading: active?.loading ?? false,
      canGoBack: active?.canGoBack ?? false,
      canGoForward: active?.canGoForward ?? false,
      error: active?.error ?? null,
      diagnostics: this.tabs.find((tab) => tab.id === this.activeTabId)?.diagnostics.slice().reverse() ?? [],
    };
  }

  newTab(): BrowserState {
    if (this.tabs.length >= MAX_BROWSER_TABS) throw new Error(`Höchstens ${MAX_BROWSER_TABS} Browser-Tabs sind möglich.`);
    const tab = this.createTab();
    this.activeTabId = tab.id;
    this.layout();
    this.schedulePersist();
    this.publish();
    return this.state();
  }

  selectTab(id: string): BrowserState {
    if (!this.tabs.some((tab) => tab.id === id)) throw new Error('Browser-Tab nicht gefunden.');
    this.activeTabId = id;
    this.layout();
    this.schedulePersist();
    this.publish();
    return this.state();
  }

  closeTab(id: string): BrowserState {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) throw new Error('Browser-Tab nicht gefunden.');
    const tab = this.tabs[index]!;
    if (this.attachedTabId === id) this.detach(tab);
    this.tabs.splice(index, 1);
    if (this.activeTabId === id) this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null;
    this.layout();
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.schedulePersist();
    this.publish();
    return this.state();
  }

  async navigate(address: string): Promise<BrowserState> {
    const url = normalizeBrowserAddress(address);
    if (!this.activeTab() && this.tabs.length >= MAX_BROWSER_TABS) throw new Error(`Höchstens ${MAX_BROWSER_TABS} Browser-Tabs sind möglich.`);
    const tab = this.activeTab() ?? this.createTab();
    this.activeTabId = tab.id;
    tab.requestedUrl = url;
    tab.restoredUrl = null;
    tab.error = null;
    tab.diagnostics = [];
    this.layout();
    this.schedulePersist();
    this.publish();
    try {
      await tab.view.webContents.loadURL(url);
    } catch (reason) {
      tab.error = reason instanceof Error ? reason.message : String(reason);
      this.publish();
    }
    return this.state();
  }

  back(): BrowserState {
    const history = this.activeTab()?.view.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
    return this.state();
  }

  forward(): BrowserState {
    const history = this.activeTab()?.view.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
    return this.state();
  }

  reload(): BrowserState {
    const tab = this.activeTab();
    if (tab) { tab.diagnostics = []; tab.error = null; tab.view.webContents.reload(); this.publish(); }
    return this.state();
  }

  async captureActive(): Promise<BrowserCaptureResult> {
    const tab = this.activeTab();
    if (!tab || !this.visible || this.attachedTabId !== tab.id || this.window.isDestroyed() || !this.window.isVisible()) throw new Error('Nur ein sichtbarer Browser-Tab kann aufgenommen werden.');
    const url = tab.view.webContents.getURL();
    if (!isSafeBrowserUrl(url)) throw new Error('Der Browser-Tab enthält noch keine geladene Webseite.');
    const image = await tab.view.webContents.capturePage();
    if (this.disposed || !this.visible || this.attachedTabId !== tab.id || this.activeTabId !== tab.id || this.window.isDestroyed() || !this.window.isVisible() || tab.view.webContents.getURL() !== url) throw new Error('Der Browser-Tab hat sich während der Aufnahme geändert.');
    if (image.isEmpty()) throw new Error('Die Webseite lieferte kein Screenshot-Bild.');
    const size = image.getSize();
    const png = image.toPNG();
    if (png.byteLength === 0 || png.byteLength > MAX_CAPTURE_BYTES) throw new Error('Der Screenshot ist leer oder zu groß.');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    return { width: size.width, height: size.height };
  }

  async openActiveExternally(): Promise<void> {
    const tab = this.activeTab();
    if (!tab || !this.visible || this.attachedTabId !== tab.id || this.window.isDestroyed() || !this.window.isVisible()) throw new Error('Nur ein sichtbarer Browser-Tab kann extern geöffnet werden.');
    // The renderer supplies no URL. Validate the currently loaded page again
    // immediately before invoking the operating system's URL handler.
    const current = tab.view.webContents.getURL();
    if (!isSafeBrowserUrl(current)) throw new Error('Der Browser-Tab enthält noch keine gültige Webseite.');
    await shell.openExternal(normalizeBrowserAddress(current));
  }

  setVisible(visible: boolean): BrowserState {
    this.visible = visible;
    this.layout();
    return this.state();
  }

  setBounds(bounds: BrowserBounds | null): BrowserState {
    this.bounds = clampBrowserBounds(bounds, this.window.getContentSize());
    this.layout();
    return this.state();
  }

  diagnostic(id: string): BrowserDiagnostic {
    const match = this.activeTab()?.diagnostics.find((entry) => entry.id === id);
    if (!match) throw new Error('Der Browserfehler ist nicht mehr verfügbar. Seite neu laden und erneut prüfen.');
    return { ...match };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flushPersist();
    this.browserSession.removeListener('will-download', this.preventDownload);
    const attached = this.tabs.find((tab) => tab.id === this.attachedTabId);
    if (attached) this.detach(attached);
    for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.tabs.length = 0;
    this.activeTabId = null;
  }

  private activeTab(): Tab | undefined { return this.tabs.find((tab) => tab.id === this.activeTabId); }

  private tabState(tab: Tab): BrowserTabState {
    const contents = tab.view.webContents;
    const currentUrl = contents.getURL();
    return {
      id: tab.id,
      url: isSafeBrowserUrl(currentUrl) ? currentUrl : tab.requestedUrl,
      title: contents.getTitle() || '',
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      error: tab.error,
    };
  }

  private createTab(restoredUrl: string | null = null): Tab {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        partition: PARTITION,
      },
    });
    const tab: Tab = { id: randomUUID(), view, requestedUrl: restoredUrl ?? '', restoredUrl, error: null, diagnostics: [] };
    const contents = view.webContents;
    contents.on('before-input-event', (event, input) => {
      if (tab.id === this.activeTabId && input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.onSearchShortcut();
      }
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('context-menu', (_event, params) => {
      const link = params.linkURL;
      if (!this.visible || tab.id !== this.activeTabId || !isSafeBrowserUrl(link)) return;
      Menu.buildFromTemplate([{
        label: 'Link in neuem Tab öffnen',
        enabled: this.tabs.length < MAX_BROWSER_TABS,
        click: () => { void this.openLinkInNewTab(link); },
      }]).popup({ window: this.window });
    });
    contents.on('will-navigate', (event) => { if (!isSafeBrowserUrl(event.url)) event.preventDefault(); });
    contents.on('will-redirect', (event) => { if (!isSafeBrowserUrl(event.url)) event.preventDefault(); });
    contents.on('did-navigate', () => { tab.error = null; tab.diagnostics = []; this.schedulePersist(); this.publish(); });
    contents.on('did-navigate-in-page', () => { this.schedulePersist(); this.publish(); });
    contents.on('page-title-updated', () => this.publish());
    contents.on('did-start-loading', () => this.publish());
    contents.on('did-stop-loading', () => this.publish());
    contents.on('console-message', (event) => {
      if (event.level !== 'error') return;
      this.addDiagnostic(tab, 'console', event.message, event.sourceId, event.lineNumber);
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) { tab.error = description; this.addDiagnostic(tab, 'load', `${description} (${code})`, url, null, url); this.publish(); }
    });
    this.tabs.push(tab);
    return tab;
  }

  private addDiagnostic(tab: Tab, kind: BrowserDiagnostic['kind'], rawMessage: string, sourceUrl: string, line: number | null, failedUrl?: string): void {
    const pageUrl = failedUrl ?? (tab.view.webContents.getURL() || tab.requestedUrl);
    if (!isLocalDevUrl(pageUrl)) return;
    const message = rawMessage.trim().slice(0, 2_000);
    if (!message) return;
    const source = diagnosticSource(sourceUrl);
    const sourceLine = Number.isSafeInteger(line) && line !== null && line > 0 ? line : null;
    if (tab.diagnostics.some((entry) => entry.kind === kind && entry.message === message && entry.pageUrl === diagnosticSource(pageUrl) && entry.sourceUrl === source && entry.line === sourceLine)) return;
    tab.diagnostics.push({ id: randomUUID(), kind, message, pageUrl: diagnosticSource(pageUrl)!, sourceUrl: source, line: sourceLine, capturedAt: new Date().toISOString() });
    if (tab.diagnostics.length > 20) tab.diagnostics.shift();
    this.publish();
  }

  private detach(tab: Tab): void {
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (this.attachedTabId === tab.id) this.attachedTabId = null;
  }

  private async openLinkInNewTab(address: string): Promise<void> {
    // Validate again at click time; a menu can stay open while tabs or pages change.
    const url = normalizeBrowserAddress(address);
    if (this.tabs.length >= MAX_BROWSER_TABS || this.disposed) return;
    this.newTab();
    await this.navigate(url);
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
    const active = this.activeTab();
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    const attached = this.tabs.find((tab) => tab.id === this.attachedTabId);
    if (attached && (!this.visible || !bounds || attached.id !== active?.id)) this.detach(attached);
    if (this.visible && bounds && active) {
      active.view.setBounds(bounds);
      if (this.attachedTabId !== active.id) {
        this.window.contentView.addChildView(active.view);
        this.attachedTabId = active.id;
      }
      if (active.restoredUrl) {
        const url = active.restoredUrl;
        active.restoredUrl = null;
        void active.view.webContents.loadURL(url).catch((reason: unknown) => {
          active.error = reason instanceof Error ? reason.message : String(reason);
          this.publish();
        });
      }
    }
  }

  private schedulePersist(): void {
    if (!this.persistence || this.disposed) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersist(), 250);
    this.persistTimer.unref();
  }

  private flushPersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.persistence) return;
    const urls = this.tabs.map((tab) => {
      const url = this.tabState(tab).url;
      return url && isSafeBrowserUrl(url) ? url : null;
    });
    const activeIndex = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    try { this.persistence.save({ urls, activeIndex }); }
    catch { console.error('[Branchloom] Browser-Sitzung konnte nicht gespeichert werden.'); }
  }

  private publish(): void { this.emit(this.state()); }
}
