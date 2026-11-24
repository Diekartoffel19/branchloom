import { randomUUID } from 'node:crypto';
import { WebContentsView, type BrowserWindow, type Session } from 'electron';
import type Database from 'better-sqlite3';
import type { BrowserBounds } from '../shared/types';
import type { DesignInspectionState, DesignSelection, ThemePreviewInput } from '../shared/design-inspection';
import { normalizeThemeTokenValue } from '../shared/theme-token-value';
import type { DesignViewportResult } from '../shared/design-viewports';
import { clampBrowserBounds, diagnosticSource, isLocalDevUrl, normalizeBrowserAddress } from './browser-policy';
import type { StudioStore } from './store';
import { scanThemeTokens } from './theme-tokens';

const MAX_SELECTIONS = 20;
const STYLE_KEYS = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'borderRadius', 'padding', 'display'] as const;
type SelectionDraft = Pick<DesignSelection, 'selector' | 'tag' | 'text' | 'styles' | 'tokens'>;
type SelectionRow = { id: string; project_id: string; source_url: string; selector: string; tag: string; text_snippet: string; styles_json: string; tokens_json: string; captured_at: string };
const fromRow = (row: SelectionRow): DesignSelection => ({ id: row.id, projectId: row.project_id, sourceUrl: row.source_url, selector: row.selector, tag: row.tag, text: row.text_snippet, styles: JSON.parse(row.styles_json) as Record<string, string>, tokens: JSON.parse(row.tokens_json) as DesignSelection['tokens'], capturedAt: row.captured_at });

export function installDesignInspection(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS design_selections (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL, selector TEXT NOT NULL, tag TEXT NOT NULL,
    text_snippet TEXT NOT NULL, styles_json TEXT NOT NULL, tokens_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS design_selections_project ON design_selections(project_id, captured_at DESC);`);
}

export function designSelections(store: StudioStore, projectId: string): DesignSelection[] {
  store.project(projectId);
  return (store.db.prepare(`SELECT * FROM design_selections WHERE project_id = ? ORDER BY rowid DESC LIMIT ${MAX_SELECTIONS}`).all(projectId) as SelectionRow[]).map(fromRow);
}

function shortText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function normalizeDesignSelection(value: unknown): SelectionDraft {
  if (!value || typeof value !== 'object') throw new Error('Elementdaten fehlen.');
  const item = value as Record<string, unknown>;
  const selector = shortText(item.selector, 320);
  const tag = shortText(item.tag, 32).toLowerCase();
  if (!selector || !/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error('Das Element lieferte keinen gültigen Selektor.');
  const rawStyles = item.styles && typeof item.styles === 'object' ? item.styles as Record<string, unknown> : {};
  const styles: Record<string, string> = {};
  for (const key of STYLE_KEYS) {
    const value = shortText(rawStyles[key], 160);
    if (value) styles[key] = value;
  }
  const tokens = Array.isArray(item.tokens) ? item.tokens.slice(0, 8).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const token = raw as Record<string, unknown>;
    const name = shortText(token.name, 80);
    const value = shortText(token.value, 160);
    return /^--[a-zA-Z0-9_-]+$/.test(name) && value ? [{ name, value }] : [];
  }) : [];
  return { selector, tag, text: shortText(item.text, 180), styles, tokens };
}

export function saveDesignSelection(store: StudioStore, projectId: string, sourceUrl: string, raw: unknown): DesignSelection {
  store.project(projectId);
  if (!isLocalDevUrl(sourceUrl)) throw new Error('Nur lokale Dev-Server-Seiten können als Designquelle gespeichert werden.');
  const item = normalizeDesignSelection(raw);
  const selection: DesignSelection = { id: randomUUID(), projectId, sourceUrl: diagnosticSource(sourceUrl)!, ...item, capturedAt: new Date().toISOString() };
  store.db.transaction(() => {
    store.db.prepare('INSERT INTO design_selections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(selection.id, projectId, selection.sourceUrl, selection.selector, selection.tag, selection.text, JSON.stringify(selection.styles), JSON.stringify(selection.tokens), selection.capturedAt);
    store.db.prepare(`DELETE FROM design_selections WHERE project_id = ? AND id NOT IN (SELECT id FROM design_selections WHERE project_id = ? ORDER BY rowid DESC LIMIT ${MAX_SELECTIONS})`).run(projectId, projectId);
  })();
  return selection;
}

export function normalizeDesignUrl(value: string): string {
  if (typeof value !== 'string') throw new Error('Gib eine lokale Vorschau-Adresse ein.');
  const url = normalizeBrowserAddress(value);
  if (!isLocalDevUrl(url)) throw new Error('Design-Inspektion erlaubt nur localhost, 127.0.0.1 oder [::1].');
  return url;
}

/** Only literal, request-free values may cross into a preview page as CSS. */
export function normalizeThemePreviewValue(value: unknown): string {
  return normalizeThemeTokenValue(value);
}

const inspectScript = (targetExpression: string): string => `(() => {
  const node = ${targetExpression};
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  const path = [];
  let current = node;
  for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
    const name = current.tagName.toLowerCase();
    let part = name;
    if (current.id) { part += '#' + CSS.escape(current.id.slice(0, 80)); path.unshift(part); break; }
    const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
    if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
    path.unshift(part);
  }
  const computed = getComputedStyle(node);
  const styles = {};
  for (const key of ${JSON.stringify(STYLE_KEYS)}) styles[key] = computed[key] || '';
  const tokens = [];
  for (let index = 0; index < Math.min(computed.length, 2048) && tokens.length < 8; index++) {
    const name = computed.item(index);
    if (name.startsWith('--')) { const value = computed.getPropertyValue(name).trim(); if (value) tokens.push({ name, value }); }
  }
  return { selector: path.join(' > '), tag, text: (node.textContent || '').slice(0, 240), styles, tokens };
})()`;

export class DesignInspector {
  private view: WebContentsView | null = null;
  private partitionSession: Session | null = null;
  private projectId: string | null = null;
  private sourceUrl: string | null = null;
  private visible = false;
  private bounds: BrowserBounds | null = null;
  private armed = false;
  private busy = false;
  private ready = false;
  private attached = false;
  private pageGeneration = 0;
  private themeBusy = false;
  private themePreview: { name: string; value: string; path: string; line: number; original: string; priority: string } | null = null;
  private readonly preventDownload = (event: Electron.Event): void => event.preventDefault();
  private readonly resize = (): void => this.layout();

  constructor(private readonly window: BrowserWindow, private readonly store: StudioStore, private readonly emit: (selection: DesignSelection) => void) {
    window.on('resize', this.resize);
  }

  state(): DesignInspectionState { return { projectId: this.projectId, sourceUrl: this.sourceUrl ? diagnosticSource(this.sourceUrl) : null, ready: this.ready, armed: this.armed, themePreview: this.themePreview ? { name: this.themePreview.name, value: this.themePreview.value, path: this.themePreview.path, line: this.themePreview.line } : null }; }

  async start(input: { projectId: string; url: string }): Promise<DesignInspectionState> {
    this.close();
    this.store.project(input.projectId);
    const url = normalizeDesignUrl(input.url);
    const view = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, partition: `branchloom-design-${randomUUID()}` } });
    this.view = view;
    this.projectId = input.projectId;
    this.sourceUrl = url;
    const origin = new URL(url).origin;
    const contents = view.webContents;
    contents.on('did-start-navigation', () => { this.pageGeneration++; this.themePreview = null; });
    const previewSession = contents.session;
    this.partitionSession = previewSession;
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    previewSession.setPermissionCheckHandler(() => false);
    previewSession.on('will-download', this.preventDownload);
    previewSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allowed = false;
      try { allowed = new URL(details.url).origin === origin; } catch { /* blocked */ }
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('before-input-event', (event) => event.preventDefault());
    contents.on('before-mouse-event', (event, mouse) => {
      if (mouse.type !== 'mouseDown' && mouse.type !== 'mouseUp' && mouse.type !== 'contextMenu') return;
      event.preventDefault();
      if (mouse.type !== 'mouseUp' || mouse.button !== 'left' || !this.armed || this.busy) return;
      this.armed = false;
      this.busy = true;
      void this.capture(contents, `document.elementFromPoint(${Math.floor(mouse.x)}, ${Math.floor(mouse.y)})`).then((selection) => {
        if (!selection && this.view?.webContents === contents && this.ready) this.armed = true;
      }).finally(() => { this.busy = false; });
    });
    this.layout();
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([contents.loadURL(url), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Die Vorschau antwortete nicht innerhalb von 15 Sekunden.')), 15_000); })]);
      if (this.view !== view) throw new Error('Die Vorschau wurde zwischenzeitlich geschlossen.');
      if (!contents.getURL() || new URL(contents.getURL()).origin !== origin) throw new Error('Die Vorschau verließ die gewählte lokale Origin.');
      this.ready = true;
      return this.state();
    } catch (reason) {
      if (this.view === view) this.close();
      throw reason;
    } finally { if (timeout) clearTimeout(timeout); }
  }

  arm(projectId: string): DesignInspectionState {
    if (!this.ready || !this.visible || !this.attached || this.projectId !== projectId) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    this.armed = true;
    return this.state();
  }

  async selectSelector(projectId: string, selector: string): Promise<DesignSelection> {
    if (!this.ready || !this.visible || !this.view || this.projectId !== projectId) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    if (typeof selector !== 'string' || !selector.trim() || selector.length > 320 || /[\u0000-\u001f\u007f]/.test(selector)) throw new Error('Gib einen CSS-Selektor mit höchstens 320 Zeichen ein.');
    if (this.busy) throw new Error('Eine Elementauswahl läuft bereits.');
    this.armed = false;
    this.busy = true;
    try {
      const selection = await this.capture(this.view.webContents, `document.querySelector(${JSON.stringify(selector.trim())})`);
      if (!selection) throw new Error('Der Selektor fand kein Element oder die Vorschau änderte sich.');
      return selection;
    } finally { this.busy = false; }
  }

  async applyThemePreview(input: ThemePreviewInput): Promise<DesignInspectionState> {
    const { projectId, token } = input ?? ({} as ThemePreviewInput);
    const value = normalizeThemePreviewValue(input?.value);
    if (!token || typeof token.name !== 'string' || !/^--[A-Za-z0-9_-]{1,98}$/.test(token.name) ||
      typeof token.path !== 'string' || typeof token.line !== 'number' || typeof token.sourceFingerprint !== 'string') throw new Error('Wähle eine gefundene CSS-Variable.');
    const view = this.requireThemePreview(projectId);
    if (this.themeBusy) throw new Error('Eine Theme-Vorschau läuft bereits.');
    if (this.themePreview) throw new Error('Setze zuerst die aktive Vorschau zurück.');
    this.themeBusy = true;
    try {
      const generation = this.pageGeneration;
      const pageUrl = view.webContents.getURL();
      const inventory = await scanThemeTokens(this.store, projectId);
      if (this.view !== view || this.pageGeneration !== generation || this.projectId !== projectId || view.webContents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während der Prüfung geändert.');
      if (!inventory.definitions.some((item) => item.name === token.name && item.path === token.path && item.line === token.line && item.sourceFingerprint === token.sourceFingerprint && item.value === token.value && item.valueTruncated === token.valueTruncated)) throw new Error('Die CSS-Fundstelle ist veraltet. Suche die Tokens erneut.');
      const script = `(() => { const root = document.documentElement; const name = ${JSON.stringify(token.name)}; const original = root.style.getPropertyValue(name); const priority = root.style.getPropertyPriority(name); root.style.setProperty(name, ${JSON.stringify(value)}); return { original, priority, applied: root.style.getPropertyValue(name) }; })()`;
      const result = await view.webContents.executeJavaScript(script, false) as { original: string; priority: string; applied: string };
      if (this.view !== view || this.pageGeneration !== generation || this.projectId !== projectId || view.webContents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während der Änderung geändert.');
      if (result.applied !== value) throw new Error('Die CSS-Variable konnte nicht angewendet werden.');
      this.themePreview = { name: token.name, value, path: token.path, line: token.line, original: result.original, priority: result.priority };
      return this.state();
    } finally { this.themeBusy = false; }
  }

  async resetThemePreview(projectId: string): Promise<DesignInspectionState> {
    const view = this.requireThemePreview(projectId);
    if (this.themeBusy) throw new Error('Eine Theme-Vorschau läuft bereits.');
    const active = this.themePreview;
    if (!active) return this.state();
    this.themeBusy = true;
    try {
      const generation = this.pageGeneration;
      const pageUrl = view.webContents.getURL();
      const script = `(() => { const root = document.documentElement; const name = ${JSON.stringify(active.name)}; if (root.style.getPropertyValue(name) !== ${JSON.stringify(active.value)}) return false; const original = ${JSON.stringify(active.original)}; if (original) root.style.setProperty(name, original, ${JSON.stringify(active.priority)}); else root.style.removeProperty(name); return true; })()`;
      const restored = await view.webContents.executeJavaScript(script, false) as boolean;
      if (this.view !== view || this.pageGeneration !== generation || this.projectId !== projectId || view.webContents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während des Zurücksetzens geändert.');
      this.themePreview = null;
      if (!restored) throw new Error('Die Seite hat den Wert selbst geändert. Der ursprüngliche Wert wurde nicht überschrieben.');
      return this.state();
    } finally { this.themeBusy = false; }
  }

  private requireThemePreview(projectId: string): WebContentsView {
    // The live view is detached while its viewport is scrolled off screen.
    // Theme controls sit below it and must still work on the open page.
    if (!this.ready || !this.visible || !this.view || this.view.webContents.isDestroyed() || this.projectId !== projectId) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    return this.view;
  }

  setBounds(bounds: BrowserBounds | null): DesignInspectionState {
    this.bounds = clampBrowserBounds(bounds, this.window.getContentSize());
    this.layout();
    return this.state();
  }

  setVisible(visible: boolean): DesignInspectionState {
    this.visible = visible;
    if (!visible) this.close();
    else this.layout();
    return this.state();
  }

  close(): DesignInspectionState {
    this.pageGeneration++;
    this.themePreview = null;
    this.armed = false;
    this.ready = false;
    this.busy = false;
    if (this.view) {
      if (this.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    }
    if (this.partitionSession) {
      this.partitionSession.webRequest.onBeforeRequest(null);
      this.partitionSession.removeListener('will-download', this.preventDownload);
    }
    this.view = null;
    this.attached = false;
    this.partitionSession = null;
    this.projectId = null;
    this.sourceUrl = null;
    return this.state();
  }

  dispose(): void { this.close(); this.window.removeListener('resize', this.resize); }

  /** Used only by the isolated source smoke to exercise Electron's real mouse path. */
  async smokeClick(selector: string): Promise<void> {
    if (!process.argv.includes('--studio-smoke') || !this.view || !this.ready || !this.armed) throw new Error('Design-Smoke-Klick ist nicht bereit.');
    const bounds = await this.view.webContents.executeJavaScript(`(() => { const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; })()`) as { x: number; y: number } | null;
    if (!bounds) throw new Error('Design-Smoke-Element fehlt.');
    const x = Math.floor(bounds.x), y = Math.floor(bounds.y);
    this.view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 });
    this.view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (await this.view.webContents.executeJavaScript('window.__designSmokeClicks') !== 0) throw new Error('Der Design-Auswahlklick wurde an die Vorschau-Seite weitergegeben.');
  }

  /** Real-Electron smoke observation; never available outside --studio-smoke. */
  async smokeThemeValue(selector: string, name: string): Promise<{ inline: string; computed: string }> {
    if (!process.argv.includes('--studio-smoke') || !this.view || !this.ready) throw new Error('Design-Smoke-Vorschau ist nicht bereit.');
    return this.view.webContents.executeJavaScript(`(() => { const root = document.documentElement; const element = document.querySelector(${JSON.stringify(selector)}); return { inline: root.style.getPropertyValue(${JSON.stringify(name)}), computed: element ? getComputedStyle(element).color : '' }; })()`) as Promise<{ inline: string; computed: string }>;
  }

  private async capture(contents: Electron.WebContents, targetExpression: string): Promise<DesignSelection | null> {
    const projectId = this.projectId;
    const sourceUrl = this.sourceUrl;
    if (!projectId || !sourceUrl || contents.isDestroyed()) return null;
    try {
      const raw = await contents.executeJavaScript(inspectScript(targetExpression), false);
      if (!raw || this.projectId !== projectId || this.view?.webContents !== contents || new URL(contents.getURL()).origin !== new URL(sourceUrl).origin) return null;
      const selection = saveDesignSelection(this.store, projectId, contents.getURL(), raw);
      this.emit(selection);
      return selection;
    } catch { return null; /* Page may navigate or close during selection; no record is invented. */ }
  }

  private layout(): void {
    if (!this.view || this.window.isDestroyed()) return;
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    if (!this.visible || !bounds) {
      if (this.attached) this.window.contentView.removeChildView(this.view);
      this.attached = false;
      return;
    }
    this.view.setBounds(bounds);
    if (!this.attached) { this.window.contentView.addChildView(this.view); this.attached = true; }
  }
}
