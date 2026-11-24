import { execFile } from 'node:child_process';
import { openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ComponentCandidate, ComponentCatalog } from '../shared/component-catalog';

const exec = promisify(execFile);
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 600;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATES = 200;
const MAX_MS = 3_000;
const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-main', 'build', 'coverage', 'out', 'vendor', '.next']);

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function trackedPath(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !value.startsWith('/') && !value.includes('\\')
    && !/[\x00-\x1f]/.test(value) && /\.(?:tsx|jsx)$/.test(value)
    && !/(?:^|\/)__tests__(?:\/|$)/.test(value)
    && !/\.(?:test|spec|stories)\.(?:tsx|jsx)$/.test(value)
    && value.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..' && !ignored.has(part.toLowerCase()));
}

function readBounded(root: string, path: string, budget: number): string | null {
  const candidate = resolve(root, path);
  if (!within(root, candidate)) return null;
  const before = lstatSync(candidate);
  if (!before.isFile() || before.size > MAX_FILE_BYTES || before.size > budget || !within(root, realpathSync(candidate))) return null;
  const fd = openSync(candidate, 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_FILE_BYTES || opened.size > budget) return null;
    const buffer = Buffer.allocUnsafe(opened.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (!count) break;
      bytes += count;
    }
    if (bytes !== opened.size) return null;
    return buffer.toString('utf8', 0, bytes);
  } finally { closeSync(fd); }
}

/** Conservative exported-name inventory. It never imports or executes project code. */
export async function scanProjectComponents(projectPath: string): Promise<ComponentCatalog> {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) throw new Error('Projektordner muss absolut sein.');
  let root: string;
  try { root = realpathSync(projectPath); if (!statSync(root).isDirectory()) throw new Error(); }
  catch { throw new Error('Projektordner ist nicht verfügbar.'); }
  let gitTop: string;
  try {
    const result = await exec('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024, windowsHide: true, shell: false, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    gitTop = realpathSync(result.stdout.trim());
  } catch { throw new Error('Komponenteninventur benötigt ein lokales Git-Repository.'); }
  const a = statSync(root); const b = statSync(gitTop);
  if (a.dev !== b.dev || a.ino !== b.ino) throw new Error('Komponenteninventur benötigt den Git-Wurzelordner als Projektordner.');
  let listed: string;
  try {
    listed = (await exec('git', ['-C', root, 'ls-files', '--cached', '--full-name', '-z'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: MAX_LIST_BYTES, windowsHide: true, shell: false,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })).stdout;
  } catch { throw new Error('Versionierte Projektdateien konnten nicht begrenzt gelesen werden.'); }
  const paths = listed.split('\0').filter(trackedPath).sort((x, y) => x.localeCompare(y));
  const notes: string[] = [];
  let partial = false;
  if (paths.length > MAX_FILES) { partial = true; notes.push('Mehr als 600 TSX-/JSX-Dateien; nur die ersten wurden untersucht.'); }
  const candidates: ComponentCandidate[] = [];
  let scannedFiles = 0;
  let totalBytes = 0;
  const started = Date.now();
  for (const path of paths.slice(0, MAX_FILES)) {
    if (Date.now() - started > MAX_MS || totalBytes >= MAX_TOTAL_BYTES || candidates.length >= MAX_CANDIDATES) {
      partial = true; notes.push('Zeit-, Byte- oder Kandidatenlimit erreicht.'); break;
    }
    let source: string | null = null;
    try { source = readBounded(root, path, MAX_TOTAL_BYTES - totalBytes); }
    catch { /* Missing, replaced, symlinked or unreadable files are counted below. */ }
    if (source === null) { partial = true; notes.push('Einige versionierte Dateien fehlten, waren zu groß, verknüpft oder nicht lesbar.'); continue; }
    scannedFiles += 1;
    totalBytes += Buffer.byteLength(source, 'utf8');
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const functionMatch = /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)\b/.exec(line);
      const constMatch = /^\s*export\s+const\s+([A-Z][A-Za-z0-9_]*)\b/.exec(line);
      const match = functionMatch ?? constMatch;
      if (!match) continue;
      // A JSX/React marker nearby makes this a useful candidate. It is not a parser or a proof of renderability.
      const nearby = lines.slice(index, Math.min(lines.length, index + 80)).join('\n').slice(0, 4_000);
      if (!/<[A-Za-z][A-Za-z0-9.:-]*(?:\s|>|\/)|React\.createElement\s*\(/.test(nearby)) continue;
      candidates.push({ name: match[1]!, path, line: index + 1, kind: functionMatch ? 'function' : 'const' });
      if (candidates.length >= MAX_CANDIDATES) { partial = true; notes.push('Maximal 200 Komponenten-Kandidaten werden gezeigt.'); break; }
    }
  }
  return { source: 'git-index', scannedFiles, candidates, partial, notes: [...new Set(notes)] };
}
