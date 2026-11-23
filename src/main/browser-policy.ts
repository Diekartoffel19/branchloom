export interface BrowserBounds { x: number; y: number; width: number; height: number }

export function isSafeBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizeBrowserAddress(address: string): string {
  const value = address.trim();
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) throw new Error('Bitte eine gültige Webadresse eingeben.');
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  if (!isSafeBrowserUrl(candidate)) throw new Error('Nur http- und https-Webadressen ohne Zugangsdaten sind erlaubt.');
  return new URL(candidate).href;
}

/** Only a loopback preview is treated as a project dev server. */
export function isLocalDevUrl(value: string): boolean {
  if (!isSafeBrowserUrl(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Keep the route needed for reproduction, but not query values or fragments. */
export function diagnosticSource(value: string): string | null {
  if (!isSafeBrowserUrl(value)) return null;
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.href;
}

export function clampBrowserBounds(input: BrowserBounds | null, size: readonly number[]): BrowserBounds | null {
  if (!input) return null;
  if (![input.x, input.y, input.width, input.height].every(Number.isFinite)) throw new Error('Ungültige Browsergröße.');
  const windowWidth = size[0] ?? Number.NaN;
  const windowHeight = size[1] ?? Number.NaN;
  if (!Number.isFinite(windowWidth) || !Number.isFinite(windowHeight)) throw new Error('Ungültige Fenstergröße.');
  const x = Math.max(0, Math.min(windowWidth, Math.floor(input.x)));
  const y = Math.max(0, Math.min(windowHeight, Math.floor(input.y)));
  const right = Math.max(0, Math.min(windowWidth, Math.ceil(input.x + input.width)));
  const bottom = Math.max(0, Math.min(windowHeight, Math.ceil(input.y + input.height)));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  return width >= 40 && height >= 40 ? { x, y, width, height } : null;
}
