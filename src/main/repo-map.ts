import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { RepoMapEdge, RepoMapEvidence, RepoMapNode, RepoMapProposal } from '../shared/repo-map';

const exec = promisify(execFile);
const MAX_GIT_OUTPUT = 2 * 1024 * 1024;
const MAX_TRACKED_FILES = 1_500;
const MAX_NODES = 160;
const MAX_COMPONENTS = 40;
const MAX_DEPTH = 4;
const ignoredDirectories = new Set(['.git', 'node_modules', '.next', '.nuxt', '.venv', '.cache', '.turbo', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', '__pycache__']);
const packageManifests = new Set(['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml']);

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function safeTrackedPath(value: string): string | null {
  if (!value || value.length > 300 || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f]/.test(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || ignoredDirectories.has(part.toLowerCase()))) return null;
  if (parts.some((part) => /^\.env(?:\.|$)/i.test(part) || /\.(?:pem|p12|pfx|key)$/i.test(part))) return null;
  return value;
}

function isRealDirectoryInside(root: string, folder: string): boolean {
  try {
    const path = resolve(root, folder);
    return within(root, path) && statSync(path).isDirectory() && within(root, realpathSync(path));
  } catch { return false; }
}

function isRealRegularFileInside(root: string, file: string): boolean {
  try {
    const path = resolve(root, file);
    return within(root, path) && lstatSync(path).isFile() && within(root, realpathSync(path));
  } catch { return false; }
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: MAX_GIT_OUTPUT,
      windowsHide: true, shell: false,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  } catch { throw new Error('Git-Projektstruktur konnte nicht sicher gelesen werden. Ist der Projektordner ein lokales Git-Repository?'); }
}

/**
 * Suggests a bounded architecture map from tracked paths only. It reads no
 * source or manifest contents, writes no files and never mutates the board.
 */
export async function proposeRepoMap(projectPath: string): Promise<RepoMapProposal> {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) throw new Error('Projektordner muss absolut sein.');
  let root: string;
  try {
    root = realpathSync(projectPath);
    if (!statSync(root).isDirectory()) throw new Error();
  } catch { throw new Error('Projektordner ist nicht verfügbar.'); }
  const gitTop = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  let top: string;
  try { top = realpathSync(gitTop); } catch { throw new Error('Git-Repository ist nicht verfügbar.'); }
  if (top !== root) throw new Error('Repo-Analyse benötigt den Git-Wurzelordner als Projektordner.');

  const listed = (await git(root, ['ls-files', '--cached', '--full-name', '-z'])).split('\0').filter(Boolean);
  const trackedFileCount = listed.length;
  const files = [...new Set(listed.map(safeTrackedPath).filter((path): path is string => path !== null))]
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0).slice(0, MAX_TRACKED_FILES);
  const warnings: string[] = [];
  let truncated = trackedFileCount > MAX_TRACKED_FILES;
  if (truncated) warnings.push('Nur die ersten 1.500 versionierten Pfade wurden ausgewertet.');
  if (files.length === 0) {
    const empty = { source: 'git-index' as const, trackedFileCount, mappedFileCount: 0, truncated, warnings: [...warnings, 'Keine versionierten Dateien gefunden.'], nodes: [], edges: [] };
    return { ...empty, fingerprint: createHash('sha256').update(JSON.stringify(empty)).digest('hex') };
  }
  const manifestByFolder = new Map<string, string>();
  const representative = new Map<string, string>();
  const folderCandidates = new Set<string>(['.']);
  const directoryCheck = new Map<string, boolean>();

  for (const file of files) {
    const parts = file.split('/');
    const folder = parts.slice(0, -1).join('/') || '.';
    if (packageManifests.has(parts.at(-1)!) && isRealRegularFileInside(root, file)) manifestByFolder.set(folder, file);
    for (let depth = 1; depth <= Math.min(parts.length - 1, MAX_DEPTH); depth += 1) {
      const path = parts.slice(0, depth).join('/');
      if (!directoryCheck.has(path)) directoryCheck.set(path, isRealDirectoryInside(root, path));
      if (directoryCheck.get(path)) {
        folderCandidates.add(path);
        if (!representative.has(path)) representative.set(path, file);
      }
    }
  }

  const nodes: RepoMapNode[] = [];
  const edges: RepoMapEdge[] = [];
  const nodeIds = new Set<string>();
  const orderAtDepth = new Map<number, number>();
  const addNode = (id: string, kind: RepoMapNode['kind'], path: string, title: string, evidence: RepoMapEvidence, depth: number): boolean => {
    if (nodes.length >= MAX_NODES) { truncated = true; return false; }
    const position = orderAtDepth.get(depth) ?? 0;
    orderAtDepth.set(depth, position + 1);
    nodes.push({ id, kind, path, title, x: depth * 280, y: position * 120, evidence });
    nodeIds.add(id);
    return true;
  };

  const orderedFolders = [...folderCandidates].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0)));
  for (const folder of orderedFolders) {
    const depth = folder === '.' ? 0 : folder.split('/').length;
    const manifest = manifestByFolder.get(folder);
    const evidence: RepoMapEvidence = manifest ? { kind: 'package-manifest', path: manifest }
      : { kind: 'tracked-path', path: representative.get(folder) ?? files[0] ?? '.' };
    const title = folder === '.' ? 'Repository' : basename(folder);
    const id = `folder:${folder}`;
    if (!addNode(id, manifest ? 'package' : 'folder', folder, title, evidence, depth)) break;
    if (folder !== '.') {
      const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '.';
      const parentId = `folder:${parent}`;
      if (nodeIds.has(parentId)) edges.push({ sourceId: parentId, targetId: id, kind: 'contains', evidence });
    }
  }

  let componentCount = 0;
  for (const file of files) {
    if (nodes.length >= MAX_NODES || componentCount >= MAX_COMPONENTS) { truncated = true; break; }
    const parts = file.split('/');
    const name = parts.at(-1)!;
    const folder = parts.slice(0, -1).join('/') || '.';
    if (!parts.some((part) => part.toLowerCase() === 'components') || !/^[A-Z][A-Za-z0-9]*\.(?:tsx|jsx)$/.test(name)
      || !nodeIds.has(`folder:${folder}`) || !isRealRegularFileInside(root, file)) continue;
    const evidence: RepoMapEvidence = { kind: 'component-convention', path: file };
    const id = `component:${file}`;
    if (!addNode(id, 'component-candidate', file, name.replace(/\.(?:tsx|jsx)$/, ''), evidence, folder === '.' ? 1 : folder.split('/').length + 1)) break;
    edges.push({ sourceId: `folder:${folder}`, targetId: id, kind: 'contains', evidence });
    componentCount += 1;
  }
  if (truncated && !warnings.some((warning) => warning.includes('160'))) warnings.push('Die Karte ist begrenzt auf 160 Knoten und 40 mögliche UI-Komponenten.');
  const proposal = { source: 'git-index' as const, trackedFileCount, mappedFileCount: files.length, truncated, warnings, nodes, edges };
  return { ...proposal, fingerprint: createHash('sha256').update(JSON.stringify(proposal)).digest('hex') };
}
