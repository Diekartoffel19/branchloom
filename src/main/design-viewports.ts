import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { DesignViewportCapture, DesignViewportResult, DesignViewportSize } from '../shared/design-viewports';
import { diagnosticSource, isLocalDevUrl } from './browser-policy';

const VIEWPORTS: ReadonlyArray<{ size: DesignViewportSize; width: number; height: number }> = [
  { size: 'desktop', width: 1280, height: 800 },
  { size: 'tablet', width: 768, height: 1024 },
  { size: 'mobile', width: 390, height: 844 },
];
const LOAD_TIMEOUT_MS = 15_000;
const CAPTURE_TIMEOUT_MS = 3_000;
const SETTLE_MS = 400;
const MAX_IMAGE_BYTES = 1_000_000;
const IMAGE_WIDTH = 960;
const IMAGE_HEIGHT = 600;

function safeError(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason)).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Größenaufnahme abgebrochen.');
}

async function withDeadline<T>(operation: Promise<T>, ms: number, message: string, signal: AbortSignal): Promise<T> {
  aborted(signal);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
      new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error('Größenaufnahme abgebrochen.')); signal.addEventListener('abort', onAbort, { once: true }); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function captureOne(url: string, viewport: (typeof VIEWPORTS)[number], signal: AbortSignal): Promise<DesignViewportCapture> {
  aborted(signal);
  const sourceUrl = diagnosticSource(url)!;
  const base: DesignViewportCapture = { size: viewport.size, width: viewport.width, height: viewport.height, sourceUrl, capturedAt: null, image: null, error: null };
  const origin = new URL(url).origin;
  let preview: BrowserWindow | null = null;
  let onAbort: (() => void) | null = null;
  try {
    preview = new BrowserWindow({ show: false, width: viewport.width, height: viewport.height, useContentSize: true, webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      backgroundThrottling: false, partition: `branchloom-design-canvas-${randomUUID()}`,
    } });
    const active = preview;
    onAbort = () => { if (!active.isDestroyed()) active.destroy(); };
    signal.addEventListener('abort', onAbort, { once: true });
    preview.setContentSize(viewport.width, viewport.height);
    const contents = preview.webContents;
    const session = contents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', (event) => event.preventDefault());
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allowed = false;
      try { allowed = new URL(details.url).origin === origin; } catch { /* block */ }
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event: Electron.Event & { url: string }): void => {
      let allowed = false;
      try { allowed = new URL(event.url).origin === origin; } catch { /* block */ }
      if (!allowed) event.preventDefault();
    };
    contents.on('will-navigate', restrictNavigation);
    contents.on('will-redirect', restrictNavigation);
    await withDeadline(contents.loadURL(url), LOAD_TIMEOUT_MS, 'Lokale Vorschau antwortete nicht innerhalb von 15 Sekunden.', signal);
    aborted(signal);
    await withDeadline(new Promise((resolve) => setTimeout(resolve, SETTLE_MS)), SETTLE_MS + 1_000, 'Lokale Vorschau wurde nicht fertig.', signal);
    const loaded = contents.getURL();
    if (!loaded || new URL(loaded).origin !== origin) throw new Error('Die Vorschau verließ die gewählte lokale Origin.');
    const loadedSource = diagnosticSource(loaded)!;
    const [width, height] = preview.getContentSize();
    if (width !== viewport.width || height !== viewport.height) throw new Error(`Inhaltsgröße ${width} × ${height} statt ${viewport.width} × ${viewport.height} px.`);
    const captured = await withDeadline(contents.capturePage(), CAPTURE_TIMEOUT_MS, 'Screenshot antwortete nicht innerhalb von 3 Sekunden.', signal);
    aborted(signal);
    const measured = captured.getSize();
    if (measured.width < 1 || measured.height < 1) throw new Error('Leerer Screenshot.');
    const scale = Math.min(1, IMAGE_WIDTH / measured.width, IMAGE_HEIGHT / measured.height);
    const image = scale < 1 ? captured.resize({ width: Math.max(1, Math.floor(measured.width * scale)), height: Math.max(1, Math.floor(measured.height * scale)) }) : captured;
    const png = image.toPNG();
    if (!png.length || png.length > MAX_IMAGE_BYTES) throw new Error('Screenshot überschreitet das 1-MB-Limit.');
    return { ...base, sourceUrl: loadedSource, capturedAt: new Date().toISOString(), image: `data:image/png;base64,${png.toString('base64')}` };
  } catch (reason) {
    aborted(signal);
    return { ...base, error: safeError(reason).replaceAll(url, sourceUrl) };
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (preview && !preview.isDestroyed()) preview.destroy();
  }
}

/** Three exact-size, memory-only snapshots from one validated loopback route. */
export async function captureDesignViewports(projectId: string, url: string, signal: AbortSignal): Promise<DesignViewportResult> {
  const sourceUrl = diagnosticSource(url);
  if (!sourceUrl || !isLocalDevUrl(url)) throw new Error('Nur lokale Dev-Server-Seiten können aufgenommen werden.');
  const captures: DesignViewportCapture[] = [];
  for (const viewport of VIEWPORTS) {
    aborted(signal);
    captures.push(await captureOne(url, viewport, signal));
  }
  return { projectId, sourceUrl, captures };
}
