import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ThemeTokenDefinition, ThemeTokenInventory } from '../shared/theme-tokens';
import type { StudioStore } from './store';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_DEFINITIONS = 300;
const MAX_MS = 3000;
const MAX_VALUE_LENGTH = 160;
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'dist-main', 'build', 'coverage', '.next', 'vendor']);
const execFileAsync = promisify(execFile);
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Preserve source offsets while hiding comments and quoted text from the declaration parser. */
function codeMask(source: string): string {
  const chars = source.split('');
  let blockComment = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < chars.length; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (blockComment) {
      chars[index] = char === '\n' ? '\n' : ' ';
      if (char === '*' && next === '/') { chars[++index] = ' '; blockComment = false; }
      continue;
    }
    if (quote) {
      chars[index] = char === '\n' ? '\n' : ' ';
      if (char === '\\' && next !== undefined) { chars[++index] = next === '\n' ? '\n' : ' '; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '*') { chars[index] = ' '; chars[++index] = ' '; blockComment = true; continue; }
    if (char === '"' || char === "'") { chars[index] = ' '; quote = char; }
  }
  return chars.join('');
}

function lineOf(lineStarts: number[], offset: number): number {
  let low = 0, high = lineStarts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

type TokenSpan = Pick<ThemeTokenDefinition, 'name' | 'value' | 'valueTruncated' | 'line'> & { valueStart: number; valueEnd: number };

/** Conservative CSS custom-property definitions inside braces; selectors and strings are not declarations. */
export function cssTokenSpans(source: string): TokenSpan[] {
  const masked = codeMask(source);
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') lineStarts.push(index + 1);
  const found: TokenSpan[] = [];
  let depth = 0;
  let declarationStart = -1;
  for (let index = 0; index < masked.length; index++) {
    const char = masked[index];
    if (char === '{') { depth++; declarationStart = index + 1; continue; }
    if (char === '}') { depth = Math.max(0, depth - 1); declarationStart = depth ? index + 1 : -1; continue; }
    if (char === ';' && depth) { declarationStart = index + 1; continue; }
    if (depth < 1 || declarationStart < 0 || index !== declarationStart) continue;
    let start = index;
    while (/\s/.test(masked[start] ?? '')) start++;
    if (!masked.startsWith('--', start)) { declarationStart = -1; continue; }
    const name = /^--[A-Za-z0-9_-]+/.exec(masked.slice(start))?.[0];
    if (!name || name.length > 100) { declarationStart = -1; continue; }
    let colon = start + name.length;
    while (/\s/.test(masked[colon] ?? '')) colon++;
    if (masked[colon] !== ':') { declarationStart = -1; continue; }
    let parens = 0;
    let end = colon + 1;
    for (; end < masked.length; end++) {
      const current = masked[end];
      if (current === '(') parens++;
      else if (current === ')') parens = Math.max(0, parens - 1);
      else if (current === '{') break;
      else if (parens === 0 && (current === ';' || current === '}')) break;
    }
    if (masked[end] === '{' || end === masked.length || parens !== 0) { declarationStart = -1; continue; }
    const raw = source.slice(colon + 1, end);
    const leading = /^\s*/.exec(raw)?.[0].length ?? 0;
    const trailing = /\s*$/.exec(raw)?.[0].length ?? 0;
    const value = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (value) found.push({ name, value: value.slice(0, MAX_VALUE_LENGTH), valueTruncated: value.length > MAX_VALUE_LENGTH, line: lineOf(lineStarts, start), valueStart: colon + 1 + leading, valueEnd: end - trailing });
    declarationStart = -1;
    index = end - 1;
  }
  return found;
}

export function cssTokenDefinitions(source: string): Array<Pick<ThemeTokenDefinition, 'name' | 'value' | 'valueTruncated' | 'line'>> {
  return cssTokenSpans(source).map(({ name, value, valueTruncated, line }) => ({ name, value, valueTruncated, line }));
}

export async function trackedCssFiles(root: string): Promise<string[]> {
  let gitRoot: string;
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096, windowsHide: true });
    gitRoot = await fs.realpath(stdout.trim());
  }
  catch { throw new Error('Token-Inventur benötigt ein lesbares Git-Repository.'); }
  const [projectStat, gitStat] = await Promise.all([fs.stat(root), fs.stat(gitRoot)]);
  if (projectStat.dev !== gitStat.dev || projectStat.ino !== gitStat.ino) throw new Error('Token-Inventur benötigt den Git-Wurzelordner als Projektpfad.');
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'ls-files', '--cached', '--full-name', '-z'], { encoding: 'utf8', timeout: 2000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return stdout
      .split('\0').filter(Boolean).filter((path) => path.toLowerCase().endsWith('.css')).sort();
  } catch { throw new Error('Versionierte CSS-Dateien konnten nicht innerhalb des Git-Limits gelesen werden.'); }
}

export async function safeTrackedFile(root: string, path: string): Promise<string | null> {
  if (isAbsolute(path) || path.includes('\\') || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..' || IGNORED.has(part.toLowerCase()))) return null;
  let cursor = root;
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) return null;
  }
  return within(root, await fs.realpath(cursor)) ? cursor : null;
}

export async function readBounded(root: string, file: string, budget: number): Promise<Buffer | null> {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.size > MAX_FILE_BYTES || before.size > budget) return null;
  const fd = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await fd.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_FILE_BYTES || opened.size > budget) return null;
    if (!within(root, await fs.realpath(file))) return null;
    const buffer = Buffer.allocUnsafe(opened.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const { bytesRead } = await fd.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    const after = await fs.lstat(file);
    return bytes === opened.size && after.isFile() && after.dev === opened.dev && after.ino === opened.ino ? buffer.subarray(0, bytes) : null;
  } finally { await fd.close(); }
}

export async function scanThemeTokens(store: StudioStore, projectId: string): Promise<ThemeTokenInventory> {
  if (typeof projectId !== 'string') throw new Error('Projekt-ID fehlt.');
  const root = await fs.realpath(store.project(projectId).path);
  const files = await trackedCssFiles(root);
  const definitions: ThemeTokenDefinition[] = [];
  const notes: string[] = [];
  let scannedFiles = 0, totalBytes = 0, partial = false;
  const started = Date.now();
  if (files.length > MAX_FILES) { partial = true; notes.push('Mehr als 500 CSS-Dateien versioniert; Liste gekürzt.'); }
  for (const [fileIndex, path] of files.slice(0, MAX_FILES).entries()) {
    if (Date.now() - started > MAX_MS || totalBytes >= MAX_TOTAL_BYTES) { partial = true; notes.push('Zeit- oder Leselimit erreicht; weitere CSS-Dateien wurden nicht untersucht.'); break; }
    try {
      const file = await safeTrackedFile(root, path);
      if (!file) { partial = true; notes.push('Mindestens eine verlinkte, ausgeschlossene oder unsichere Datei wurde ausgelassen.'); continue; }
      const buffer = await readBounded(root, file, MAX_TOTAL_BYTES - totalBytes);
      if (!buffer) { partial = true; notes.push('Mindestens eine CSS-Datei wurde wegen Größen-/Leselimit oder Quelländerung ausgelassen (maximal 128 KiB je Datei).'); continue; }
      scannedFiles++;
      totalBytes += buffer.length;
      const fingerprint = createHash('sha256').update(buffer).digest('hex');
      for (const item of cssTokenDefinitions(buffer.toString('utf8'))) {
        if (definitions.length >= MAX_DEFINITIONS) { partial = true; notes.push('Mehr als 300 Definitionen gefunden; Liste gekürzt.'); break; }
        definitions.push({ ...item, path, sourceFingerprint: fingerprint });
      }
      if (definitions.length >= MAX_DEFINITIONS) {
        if (fileIndex < files.length - 1) { partial = true; notes.push('Mehr als 300 Definitionen möglich; weitere CSS-Dateien wurden nicht untersucht.'); }
        break;
      }
    } catch { partial = true; notes.push('Mindestens eine CSS-Datei konnte nicht gelesen werden.'); }
  }
  notes.push('Nur einfache CSS-Custom-Property-Definitionen in versionierten .css-Dateien; keine Laufzeitwerte, Variablenauflösung oder Tailwind-Konfiguration.');
  return { projectId, scannedFiles, definitions, partial, notes };
}
