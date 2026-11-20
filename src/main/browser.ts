import { session, WebContentsView, type BrowserWindow, type Session } from 'electron';
import type { BrowserBounds, BrowserState } from '../shared/types';
import { clampBrowserBounds, isSafeBrowserUrl, normalizeBrowserAddress } from './browser-policy';

const PARTITION = 'persist:jarvis-studio-browser';

export class StudioBrowser {
  private view: WebContentsView | null = null;
  private visible = false;
  private attached = false;
  private bounds: BrowserBounds | null = null;
  private requestedUrl = '';
  private error: string | null = null;
  private readonly browserSession: Session;
  private readonly preventDownload = (event: Electron.Event): void => event.preventDefault();

  constructor(private readonly window: BrowserWindow, private readonly emit: (state: BrowserState) => void, private readonly onSearchShortcut: () => void = () => undefined) {
    this.browserSession = session.fromPartition(PARTITION);
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
    this.browserSession.on('will-download', this.preventDownload);
    this.window.on('resize', () => this.layout());
  }

  state(): BrowserState {
    const contents = this.view?.webContents;
    return {
      url: contents?.getURL() || this.requestedUrl,
      title: contents?.getTitle() || '',
      loading: contents?.isLoading() ?? false,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
      error: this.error,
    };
  }

  async navigate(address: string): Promise<BrowserState> {
    const url = normalizeBrowserAddress(address);
    this.requestedUrl = url;
    this.error = null;
    const contents = this.ensureView().webContents;
    this.publish();
    try {
      await contents.loadURL(url);
    } catch (reason) {
      this.error = reason instanceof Error ? reason.message : String(reason);
      this.publish();
    }
    return this.state();
  }

  back(): BrowserState {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
    return this.state();
  }

  forward(): BrowserState {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
    return this.state();
  }

  reload(): BrowserState {
    this.view?.webContents.reload();
    return this.state();
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

  dispose(): void {
    this.browserSession.removeListener('will-download', this.preventDownload);
    if (this.view && this.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    this.attached = false;
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
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
    const contents = view.webContents;
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.onSearchShortcut();
      }
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => {
      if (!isSafeBrowserUrl(event.url)) event.preventDefault();
    });
    contents.on('will-redirect', (event) => {
      if (!isSafeBrowserUrl(event.url)) event.preventDefault();
    });
    contents.on('did-navigate', () => { this.error = null; this.publish(); });
    contents.on('did-navigate-in-page', () => this.publish());
    contents.on('page-title-updated', () => this.publish());
    contents.on('did-start-loading', () => this.publish());
    contents.on('did-stop-loading', () => this.publish());
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        this.error = description;
        this.publish();
      }
    });
    this.view = view;
    this.layout();
    return view;
  }

  private layout(): void {
    if (!this.view || this.window.isDestroyed()) return;
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    if (this.visible && bounds) {
      this.view.setBounds(bounds);
      if (!this.attached) {
        this.window.contentView.addChildView(this.view);
        this.attached = true;
      }
    } else if (this.attached) {
      this.window.contentView.removeChildView(this.view);
      this.attached = false;
    }
  }

  private publish(): void { this.emit(this.state()); }
}
