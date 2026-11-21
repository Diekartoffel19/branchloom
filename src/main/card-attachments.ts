import { basename, extname, isAbsolute } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

export const MAX_CARD_ATTACHMENTS = 20;

// Opening an attachment uses the OS default program. Keep executable and
// script formats out of this path, even when a file was added deliberately.
const OPENABLE = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp']);

export function canOpenAttachment(name: string): boolean {
  return OPENABLE.has(extname(name).toLowerCase());
}

export function checkedAttachmentPath(input: string): { path: string; name: string; size: number } {
  if (typeof input !== 'string' || input.length > 4096 || !isAbsolute(input)) throw new Error('Anhang braucht einen absoluten Dateipfad.');
  const path = realpathSync(input);
  const info = statSync(path);
  if (!info.isFile()) throw new Error('Anhang muss eine normale Datei sein.');
  const name = basename(path);
  if (!name || name.length > 255 || /[\x00-\x1f]/.test(name)) throw new Error('Dateiname des Anhangs ist ungültig.');
  if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error('Dateigröße des Anhangs ist ungültig.');
  return { path, name, size: info.size };
}

export function attachmentAvailable(path: string): boolean {
  try {
    const checked = checkedAttachmentPath(path);
    return process.platform === 'win32' ? checked.path.toLowerCase() === path.toLowerCase() : checked.path === path;
  } catch { return false; }
}
