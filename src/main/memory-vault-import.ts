import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { parseMemoryMarkdownFile } from '../shared/memory-file';
import type { MemoryVaultImportFile } from '../shared/types';

const MAX_FILES = 200;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 500_000;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export interface ScannedMemoryVault {
  root: string;
  fingerprint: string;
  files: MemoryVaultImportFile[];
  parsed: Map<string, { title: string; body: string; tags: string[] }>;
}

/** Enumerate only regular Markdown files below the selected directory. Never traverse links. */
export function scanMemoryVault(directory: string, existingTitles: readonly string[]): ScannedMemoryVault {
  const rootStat = lstatSync(directory);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Bitte einen echten Vault-Ordner auswählen, keinen Link.');
  const root = realpathSync(directory);
  const paths: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error(`Vault ist tiefer als ${MAX_DEPTH} Ordnerstufen.`);
    const directoryStat = lstatSync(current);
    const resolved = realpathSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || (resolved !== root && !resolved.startsWith(root + sep))) {
      throw new Error('Vault-Unterordner wurde während der Vorschau verändert.');
    }
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(path, depth + 1); continue; }
      if (!/\.md$/i.test(entry.name) || !entry.isFile()) continue;
      paths.push(path);
      if (paths.length > MAX_FILES) throw new Error(`Vault enthält mehr als ${MAX_FILES} Markdown-Dateien. Bitte einen kleineren Ordner wählen.`);
    }
  };
  walk(root, 0);
  const parsed = new Map<string, { title: string; body: string; tags: string[] }>();
  const files: MemoryVaultImportFile[] = [];
  const seenTitles = new Set(existingTitles.map((title) => title.trim().toLocaleLowerCase()));
  const hash = createHash('sha256');
  let bytes = 0;
  for (const path of paths) {
    const key = relative(root, path).split(sep).join('/');
    if (!key || key.startsWith('../') || key.includes('/../')) throw new Error('Vault-Datei liegt außerhalb des gewählten Ordners.');
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Vault-Datei wurde während der Vorschau verändert.');
    const real = realpathSync(path);
    if (!real.startsWith(root + sep)) throw new Error('Vault-Datei liegt außerhalb des gewählten Ordners.');
    const fileBytes = statSync(path).size;
    bytes += fileBytes;
    if (bytes > MAX_TOTAL_BYTES) throw new Error('Vault enthält mehr als 8 MiB Markdown. Bitte einen kleineren Ordner wählen.');
    if (fileBytes > MAX_FILE_BYTES) {
      hash.update(key).update('too-large');
      files.push({ key, title: basename(path, '.md'), tags: [], eligible: false, reason: 'Datei größer als 500 KB' });
      continue;
    }
    const contents = readFileSync(path);
    if (contents.byteLength > MAX_FILE_BYTES) throw new Error('Vault-Datei wurde während der Vorschau vergrößert.');
    hash.update(key).update(contents);
    try {
      const note = parseMemoryMarkdownFile(basename(path), contents.toString('utf8'));
      const titleKey = note.title.trim().toLocaleLowerCase();
      const duplicate = seenTitles.has(titleKey);
      seenTitles.add(titleKey);
      files.push({ key, title: note.title, tags: note.tags, eligible: !duplicate, reason: duplicate ? 'Titel bereits vorhanden oder im Vault doppelt' : null });
      if (!duplicate) parsed.set(key, note);
    } catch (error) {
      files.push({ key, title: basename(path, '.md'), tags: [], eligible: false, reason: error instanceof Error ? error.message : 'Datei konnte nicht gelesen werden' });
    }
  }
  return { root, fingerprint: hash.digest('hex'), files, parsed };
}
