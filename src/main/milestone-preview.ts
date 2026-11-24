import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { diagnosticSource, isLocalDevUrl, normalizeBrowserAddress } from './browser-policy';

export interface MilestonePreviewImage { png: Buffer; source: string; capturedAt: string }

const LOAD_TIMEOUT_MS = 15_000;
const CAPTURE_TIMEOUT_MS = 3_000;
const MAX_IMAGE_BYTES = 1_000_000;

export function normalizeMilestonePreviewUrl(value: string): string {
  if (typeof value !== 'string') throw new Error('Gib eine lokale Vorschau-Adresse ein.');
  const url = normalizeBrowserAddress(value);
  if (!isLocalDevUrl(url)) throw new Error('Meilenstein-Vorschauen erlauben nur localhost, 127.0.0.1 oder [::1].');
  return url;
}

async function deadline<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try { return await Promise.race([task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Loads one explicitly selected loopback route in an isolated, nonpersistent browser. */
export async function captureLocalMilestonePreview(inputUrl: string): Promise<MilestonePreviewImage> {
  const url = normalizeMilestonePreviewUrl(inputUrl);
  const origin = new URL(url).origin;
  const preview = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
    backgroundThrottling: false, partition: `branchloom-milestone-${randomUUID()}`,
  } });
  const contents = preview.webContents;
  const session = contents.session;
  try {
    preview.setContentSize(1280, 800);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', (event) => event.preventDefault());
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allowed = false;
      try { allowed = new URL(details.url).origin === origin; } catch { /* blocked */ }
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const preventForeignNavigation = (event: Electron.Event & { url: string }): void => {
      let allowed = false;
      try { allowed = new URL(event.url).origin === origin; } catch { /* blocked */ }
      if (!allowed) event.preventDefault();
    };
    contents.on('will-navigate', preventForeignNavigation);
    contents.on('will-redirect', preventForeignNavigation);
    await deadline(contents.loadURL(url), LOAD_TIMEOUT_MS, 'Lokale Vorschau antwortete nicht innerhalb von 15 Sekunden.');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const loaded = contents.getURL();
    if (!loaded || new URL(loaded).origin !== origin) throw new Error('Die Vorschau verließ die gewählte lokale Origin.');
    const [width, height] = preview.getContentSize();
    if (width !== 1280 || height !== 800) throw new Error('Die lokale Vorschau hatte eine unerwartete Inhaltsgröße.');
    const capture = await deadline(contents.capturePage(), CAPTURE_TIMEOUT_MS, 'Screenshot antwortete nicht innerhalb von 3 Sekunden.');
    const size = capture.getSize();
    if (size.width < 1 || size.height < 1) throw new Error('Die Vorschau lieferte ein leeres Bild.');
    const scale = Math.min(1, 960 / size.width, 600 / size.height);
    const image = scale < 1 ? capture.resize({ width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)) }) : capture;
    const png = image.toPNG();
    if (!png.length || png.length > MAX_IMAGE_BYTES) throw new Error('Die Vorschau überschreitet das 1-MB-Bildlimit.');
    return { png, source: diagnosticSource(loaded)!, capturedAt: new Date().toISOString() };
  } catch (reason) {
    const detail = (reason instanceof Error ? reason.message : String(reason)).replaceAll(url, diagnosticSource(url)!).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
    throw new Error(`Meilenstein-Vorschau fehlgeschlagen: ${detail}`);
  } finally {
    if (!preview.isDestroyed()) preview.destroy();
  }
}
