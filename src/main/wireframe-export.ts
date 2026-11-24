import { WIREFRAME_ARTBOARDS, type WireframeArtboard } from '../shared/card-wireframe';
import { writeFileSync } from 'node:fs';

export interface WireframePngInput {
  projectId: string;
  cardId: string;
  artboard: WireframeArtboard;
  dataUrl: string;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DATA_URL_LENGTH = 24 * 1024 * 1024;

export function checkedWireframePng(input: WireframePngInput): Buffer {
  const size = WIREFRAME_ARTBOARDS[input.artboard];
  if (!size) throw new Error('Unbekannte Zeichenfläche.');
  if (typeof input.dataUrl !== 'string' || input.dataUrl.length > MAX_DATA_URL_LENGTH || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)) {
    throw new Error('Ungültiges PNG-Bild.');
  }
  const image = Buffer.from(input.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (image.length < 33 || !image.subarray(0, 8).equals(PNG_SIGNATURE) || image.toString('ascii', 12, 16) !== 'IHDR' || image.readUInt32BE(16) !== size.width || image.readUInt32BE(20) !== size.height) {
    throw new Error('PNG-Bild und Zeichenflächengröße stimmen nicht überein.');
  }
  return image;
}

export function wireframeExportFilename(cardTitle: string, artboard: WireframeArtboard): string {
  const title = cardTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64) || 'Entwurf';
  return `${title}-${artboard}.png`;
}

export function writeWireframePngExclusive(file: string, image: Buffer): void {
  try { writeFileSync(file, image, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Die Datei existiert bereits. Wähle einen neuen Dateinamen.');
    throw error;
  }
}
