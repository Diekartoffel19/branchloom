import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isSafeBrowserUrl } from './browser-policy';

export const MAX_BROWSER_TABS = 24;
const MAX_FILE_BYTES = 64 * 1024;
const FILE_NAME = 'browser-session.json';

export interface SavedBrowserSession { urls: Array<string | null>; activeIndex: number }
const EMPTY: SavedBrowserSession = { urls: [], activeIndex: -1 };

export class BrowserSessionPersistence {
  private readonly file: string;

  constructor(private readonly userDataDirectory: string) {
    this.file = join(userDataDirectory, FILE_NAME);
  }

  load(): SavedBrowserSession {
    try {
      const stat = lstatSync(this.file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { ...EMPTY };
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
      const value = parsed as Record<string, unknown>;
      if (value.version !== 1 || !Array.isArray(value.urls) || value.urls.length > MAX_BROWSER_TABS || !Number.isInteger(value.activeIndex)) return { ...EMPTY };
      const entries = value.urls.map((url, index) => ({ url: url as unknown, index })).filter(({ url }) => url === null || (typeof url === 'string' && url.length <= 2048 && isSafeBrowserUrl(url)));
      const urls = entries.map(({ url }) => url as string | null);
      const activeIndex = urls.length === 0 ? -1 : Math.max(0, entries.findIndex(({ index }) => index === value.activeIndex));
      return { urls, activeIndex };
    } catch {
      return { ...EMPTY };
    }
  }

  save(snapshot: SavedBrowserSession): void {
    if (snapshot.urls.length > MAX_BROWSER_TABS || snapshot.urls.some((url) => url !== null && (url.length > 2048 || !isSafeBrowserUrl(url)))) throw new Error('Ungültiger Browser-Snapshot.');
    if (!Number.isInteger(snapshot.activeIndex) || snapshot.activeIndex < -1 || snapshot.activeIndex >= snapshot.urls.length || (snapshot.urls.length > 0 && snapshot.activeIndex < 0)) throw new Error('Ungültiger aktiver Browser-Tab.');
    mkdirSync(this.userDataDirectory, { recursive: true });
    const temporary = join(this.userDataDirectory, `.${FILE_NAME}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, urls: snapshot.urls, activeIndex: snapshot.activeIndex }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.file);
    } finally {
      try { unlinkSync(temporary); } catch { /* The rename consumed the temporary file. */ }
    }
  }
}
