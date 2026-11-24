import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, dirname, extname } from 'node:path';
import type { WhiteboardImpact, WhiteboardDirectImporter } from '../shared/whiteboard-impact';
import type { WhiteboardNode } from '../shared/types';
import type { StudioStore } from './store';
import { whiteboardSnapshot } from './whiteboard';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'dist-main', 'build', 'coverage', '.next', '.venv', 'vendor']);
const MAX_DIRS = 300;
const MAX_FILES = 1000;
const MAX_ENTRIES = 10000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_IMPORTERS = 50;
const MAX_MS = 3000;
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const display = (root: string, path: string): string => relative(root, path).split(sep).join('/');

function targetOf(store: StudioStore, projectId: string, nodeId: string): { root: string; target: string; node: WhiteboardNode & { reference: { kind: 'file' | 'folder'; path: string } } } {
  const node = whiteboardSnapshot(store, projectId).nodes.find((item) => item.id === nodeId);
  if (!node || node.projectId !== projectId) throw new Error('Whiteboard-Box gehört nicht zu diesem Projekt.');
  if (node.reference?.kind !== 'file' && node.reference?.kind !== 'folder') throw new Error('Box braucht eine gespeicherte Datei- oder Ordnerverknüpfung.');
  const root = realpathSync(store.project(projectId).path);
  const candidate = resolve(root, node.reference.path);
  if (!within(root, candidate)) throw new Error('Verknüpfung liegt außerhalb des Projekts.');
  let cursor = root;
  for (const part of relative(root, candidate).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Verknüpfung führt über einen Symlink.');
  }
  const target = realpathSync(candidate);
  if (!within(root, target)) throw new Error('Verknüpfung liegt außerhalb des Projekts.');
  const stat = lstatSync(target);
  if (node.reference.kind === 'file' ? !stat.isFile() : !stat.isDirectory()) throw new Error('Verknüpfter Projektpfad hat nicht mehr den gespeicherten Typ.');
  return { root, target, node: node as WhiteboardNode & { reference: { kind: 'file' | 'folder'; path: string } } };
}

function sourceFiles(root: string): { files: string[]; notes: string[]; partial: boolean } {
  const files: string[] = [];
  const notes: string[] = [];
  const pending = [root];
  let dirs = 0;
  let partial = false;
  let skippedSymlink = false;
  let skippedIgnored = false;
  let entriesSeen = 0;
  const started = Date.now();
  while (pending.length) {
    if (++dirs > MAX_DIRS || files.length >= MAX_FILES || Date.now() - started > MAX_MS) { partial = true; notes.push('Datei-, Ordner- oder Zeitlimit erreicht; nur ein Teil des Projekts wurde untersucht.'); break; }
    const dir = pending.shift()!;
    try {
      const handle = opendirSync(dir);
      try {
        let entry;
        while ((entry = handle.readSync())) {
          if (++entriesSeen > MAX_ENTRIES || Date.now() - started > MAX_MS || files.length >= MAX_FILES) {
            partial = true; notes.push('Eintrags-, Datei- oder Zeitlimit erreicht; nur ein Teil des Projekts wurde untersucht.'); break;
          }
          const path = join(dir, entry.name);
          if (entry.isSymbolicLink()) { partial = true; skippedSymlink = true; continue; }
          if (entry.isDirectory()) { if (!IGNORED.has(entry.name)) pending.push(path); else { partial = true; skippedIgnored = true; } continue; }
          if (entry.isFile() && EXTENSIONS.includes(extname(entry.name).toLowerCase())) files.push(path);
        }
      } finally { handle.closeSync(); }
    } catch { partial = true; notes.push(`Ordner nicht lesbar: ${display(root, dir) || '.'}`); }
    if (entriesSeen > MAX_ENTRIES || files.length >= MAX_FILES || Date.now() - started > MAX_MS) {
      if (pending.length && !partial) { partial = true; notes.push('Datei- oder Zeitlimit erreicht; weitere Ordner wurden nicht untersucht.'); }
      break;
    }
  }
  if (skippedSymlink) notes.push('Symlinks wurden aus Sicherheitsgründen ausgelassen.');
  if (skippedIgnored) notes.push('Build-, Abhängigkeits- oder andere Standardordner wurden ausgelassen.');
  return { files: files.sort((a, b) => a.localeCompare(b)), notes: [...new Set(notes)], partial };
}

function readSource(root: string, file: string, budget: number): { text: string; bytes: number } | null {
  const before = lstatSync(file);
  if (!before.isFile() || before.size > MAX_FILE_BYTES || before.size > budget || !within(root, realpathSync(file))) return null;
  const fd = openSync(file, 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_FILE_BYTES || opened.size > budget) return null;
    const buffer = Buffer.allocUnsafe(Math.min(MAX_FILE_BYTES, budget) + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (!read) break;
      bytes += read;
    }
    if (bytes > MAX_FILE_BYTES || bytes > budget) return null;
    return { text: buffer.toString('utf8', 0, bytes), bytes };
  } finally { closeSync(fd); }
}

function resolveImport(importer: string, specifier: string, known: Set<string>): string | null {
  const base = resolve(dirname(importer), specifier);
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => join(base, `index${ext}`))];
  return candidates.find((path) => known.has(path)) ?? null;
}

type Token = { value: string; kind: 'word' | 'string' | 'punct'; start: number };

/** Tiny lexer for single-line static imports. Comments, ordinary strings and template bodies cannot create import keywords. */
function importsOf(source: string): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = [];
  let blockComment = false;
  let template = false;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const tokens: Token[] = [];
    for (let pos = 0; pos < line.length;) {
      const char = line[pos]!;
      const next = line[pos + 1];
      if (blockComment) { if (char === '*' && next === '/') { blockComment = false; pos += 2; } else pos++; continue; }
      if (template) { if (char === '\\') pos += 2; else if (char === '`') { template = false; pos++; } else pos++; continue; }
      if (char === '/' && next === '/') break;
      if (char === '/' && next === '*') { blockComment = true; pos += 2; continue; }
      if (char === '`') { template = true; pos++; continue; }
      if (char === '\'' || char === '"') {
        const start = pos++;
        let value = '';
        let escaped = false;
        while (pos < line.length) {
          if (line[pos] === '\\') { escaped = true; pos += 2; continue; }
          if (line[pos] === char) { pos++; break; }
          value += line[pos++]!;
        }
        if (!escaped && line[pos - 1] === char) tokens.push({ value, kind: 'string', start });
        continue;
      }
      if (/[A-Za-z_$]/.test(char)) {
        const start = pos++;
        while (pos < line.length && /[A-Za-z0-9_$]/.test(line[pos]!)) pos++;
        tokens.push({ value: line.slice(start, pos), kind: 'word', start });
        continue;
      }
      if (!/\s/.test(char)) tokens.push({ value: char, kind: 'punct', start: pos });
      pos++;
    }
    for (let item = 0; item < tokens.length; item++) {
      const token = tokens[item]!;
      if (token.kind !== 'word') continue;
      let specifier: Token | undefined;
      if (token.value === 'require' && tokens[item + 1]?.value === '(' && tokens[item + 2]?.kind === 'string') specifier = tokens[item + 2];
      if (token.value === 'import' && tokens[item + 1]?.kind === 'string') specifier = tokens[item + 1];
      if ((token.value === 'import' || token.value === 'export') && !specifier && tokens[item + 1]?.value !== '(') {
        for (let cursor = item + 1; cursor < tokens.length && tokens[cursor]!.start - token.start <= 240; cursor++) {
          if (tokens[cursor]?.value === 'from' && tokens[cursor]?.kind === 'word' && tokens[cursor + 1]?.kind === 'string') {
            specifier = tokens[cursor + 1]; break;
          }
        }
      }
      if (specifier?.value.startsWith('./') || specifier?.value.startsWith('../')) found.push({ specifier: specifier.value, line: index + 1 });
    }
  }
  return found;
}

export function analyzeWhiteboardImpact(store: StudioStore, input: { projectId: string; nodeId: string }): WhiteboardImpact {
  if (!input || typeof input.projectId !== 'string' || typeof input.nodeId !== 'string') throw new Error('Whiteboard-Analyse braucht Projekt und Box.');
  const { root, target, node } = targetOf(store, input.projectId, input.nodeId);
  const listing = sourceFiles(root);
  const known = new Set(listing.files);
  const importers: WhiteboardDirectImporter[] = [];
  const notes = [...listing.notes];
  let partial = listing.partial;
  let scannedFiles = 0;
  let totalBytes = 0;
  let importerLimitNoted = false;
  const started = Date.now();
  for (const file of listing.files) {
    if (Date.now() - started > MAX_MS || totalBytes >= MAX_TOTAL_BYTES) { partial = true; notes.push('Zeit- oder Leselimit erreicht; weitere Dateien wurden nicht untersucht.'); break; }
    if (file === target || (node.reference.kind === 'folder' && within(target, file))) continue;
    try {
      if (totalBytes + lstatSync(file).size > MAX_TOTAL_BYTES) { partial = true; notes.push('Leselimit von 8 MiB erreicht.'); break; }
      const source = readSource(root, file, MAX_TOTAL_BYTES - totalBytes);
      if (!source) { partial = true; notes.push('Dateien über 256 KiB oder geänderte/verlinkte Quellen wurden ausgelassen.'); continue; }
      if (totalBytes + source.bytes > MAX_TOTAL_BYTES) { partial = true; notes.push('Leselimit von 8 MiB erreicht.'); break; }
      totalBytes += source.bytes;
      scannedFiles++;
      for (const item of importsOf(source.text)) {
        const resolved = resolveImport(file, item.specifier, known);
        if (resolved && (resolved === target || (node.reference.kind === 'folder' && within(target, resolved)))) {
          if (importers.length < MAX_IMPORTERS) importers.push({ path: display(root, file), targetPath: display(root, resolved), specifier: item.specifier, line: item.line });
          else if (!importerLimitNoted) { partial = true; importerLimitNoted = true; notes.push('Mehr als 50 direkte Importstellen gefunden; Liste gekürzt.'); }
        }
      }
    } catch { partial = true; notes.push('Mindestens eine Datei konnte nicht gelesen werden.'); }
  }
  notes.push('Heuristik: nur einzeilige, literale relative TS/JS-Imports, Exports und require; keine Aliase, dynamischen oder indirekten Abhängigkeiten.');
  return { nodeId: node.id, referencePath: display(root, target) || '.', referenceKind: node.reference.kind, scannedFiles, importers,
    partial, notes: [...new Set(notes)] };
}
