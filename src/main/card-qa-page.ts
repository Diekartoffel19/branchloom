import type { CardQaPageObservation } from '../shared/types';

const MAX_IMAGES = 200;
const PAGE_CHECK_TIMEOUT_MS = 2_000;

// Return only bounded booleans and counts. Page text, selectors, attributes,
// and URLs never cross into the stored report.
export const pageObservationScript = `(() => {
  const images = document.images;
  const scannedImages = Math.min(images.length, ${MAX_IMAGES});
  let imagesWithoutAlt = 0;
  for (let index = 0; index < scannedImages; index++) {
    if (!images[index].hasAttribute('alt')) imagesWithoutAlt++;
  }
  const html = document.documentElement;
  const clientWidth = html.clientWidth;
  const scrollWidth = Math.max(html.scrollWidth, document.body?.scrollWidth || 0);
  return {
    hasTitle: Boolean(document.title.trim()),
    scannedImages,
    imagesWithoutAlt,
    imagesTruncated: images.length > ${MAX_IMAGES},
    clientWidth,
    overflowPixels: Math.max(0, scrollWidth - clientWidth),
  };
})()`;

type PageSnapshot = {
  hasTitle: boolean;
  scannedImages: number;
  imagesWithoutAlt: number;
  imagesTruncated: boolean;
  clientWidth: number;
  overflowPixels: number;
};

export function normalizePageSnapshot(value: unknown): { observations: CardQaPageObservation[]; partial: boolean } {
  if (!value || typeof value !== 'object') throw new Error('Seitenmessung lieferte kein Ergebnis.');
  const data = value as Record<string, unknown>;
  const integer = (name: keyof PageSnapshot, max: number): number => {
    const item = data[name];
    if (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > max) throw new Error('Seitenmessung lieferte ungültige Zähler.');
    return item as number;
  };
  if (typeof data.hasTitle !== 'boolean' || typeof data.imagesTruncated !== 'boolean') throw new Error('Seitenmessung lieferte ungültige Angaben.');
  const scannedImages = integer('scannedImages', MAX_IMAGES);
  const imagesWithoutAlt = integer('imagesWithoutAlt', MAX_IMAGES);
  const clientWidth = integer('clientWidth', 50_000);
  const overflowPixels = integer('overflowPixels', 100_000);
  if (imagesWithoutAlt > scannedImages || clientWidth < 1 || (data.imagesTruncated && scannedImages !== MAX_IMAGES)) throw new Error('Seitenmessung lieferte widersprüchliche Angaben.');
  const observations: CardQaPageObservation[] = [];
  if (!data.hasTitle) observations.push({ kind: 'missing-title' });
  if (imagesWithoutAlt) observations.push({ kind: 'missing-image-alt', count: imagesWithoutAlt, scanned: scannedImages });
  if (overflowPixels >= 8) observations.push({ kind: 'horizontal-overflow', pixels: overflowPixels, clientWidth });
  return { observations, partial: data.imagesTruncated };
}

export async function inspectCardQaPage(contents: Electron.WebContents): Promise<{ observations: CardQaPageObservation[]; partial: boolean }> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race([
      contents.executeJavaScript(pageObservationScript, false) as Promise<unknown>,
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Seitenmessung überschritt zwei Sekunden.')), PAGE_CHECK_TIMEOUT_MS); }),
    ]);
    return normalizePageSnapshot(result);
  } finally { if (timeout) clearTimeout(timeout); }
}
