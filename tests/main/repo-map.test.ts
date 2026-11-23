import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeRepoMap } from '../../src/main/repo-map';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-repo-map-'));
  roots.push(root);
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  mkdirSync(join(root, 'packages', 'api', 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'unrelated'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"private-secret-marker"}');
  writeFileSync(join(root, 'src', 'components', 'ReviewPanel.tsx'), 'export function ReviewPanel() { return "private-secret-marker"; }');
  writeFileSync(join(root, 'src', 'components', 'helper.ts'), 'export const helper = 1;');
  writeFileSync(join(root, 'packages', 'api', 'pyproject.toml'), 'private-secret-marker');
  writeFileSync(join(root, 'packages', 'api', 'src', 'server.py'), 'print("private-secret-marker")');
  writeFileSync(join(root, 'node_modules', 'unrelated', 'index.js'), 'private-secret-marker');
  writeFileSync(join(root, 'dist', 'bundle.js'), 'private-secret-marker');
  writeFileSync(join(root, '.env'), 'TOKEN=private-secret-marker');
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
  return root;
}

describe('read-only repo map proposal', () => {
  it('maps tracked folders, package manifests and convention-based UI candidates with explicit evidence', async () => {
    const root = fixture();
    const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
    const result = await proposeRepoMap(root);
    expect(result.source).toBe('git-index');
    expect(result.nodes.find((node) => node.id === 'folder:.')).toMatchObject({ kind: 'package', evidence: { kind: 'package-manifest', path: 'package.json' } });
    expect(result.nodes.find((node) => node.id === 'folder:packages/api')).toMatchObject({ kind: 'package', evidence: { kind: 'package-manifest', path: 'packages/api/pyproject.toml' } });
    expect(result.nodes.find((node) => node.id === 'component:src/components/ReviewPanel.tsx')).toMatchObject({ kind: 'component-candidate', evidence: { kind: 'component-convention', path: 'src/components/ReviewPanel.tsx' } });
    expect(result.edges).toContainEqual({ sourceId: 'folder:src/components', targetId: 'component:src/components/ReviewPanel.tsx', kind: 'contains', evidence: { kind: 'component-convention', path: 'src/components/ReviewPanel.tsx' } });
    expect(result.nodes.some((node) => /node_modules|dist|\.env/.test(node.path))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-secret-marker');
    expect(await proposeRepoMap(root)).toEqual(result);
    expect(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(before);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('TOKEN=private-secret-marker');
  });

  it('rejects non-repositories and nested project folders without scanning outside the project', async () => {
    const root = fixture();
    await expect(proposeRepoMap(join(root, 'src'))).rejects.toThrow('Git-Wurzelordner');
    const plain = mkdtempSync(join(tmpdir(), 'branchloom-repo-map-plain-'));
    roots.push(plain);
    await expect(proposeRepoMap(plain)).rejects.toThrow('Git-Projektstruktur');
    await expect(proposeRepoMap('relative/path')).rejects.toThrow('absolut');
  });

  it('does not invent nodes from an empty Git index', async () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-repo-map-empty-'));
    roots.push(root);
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    const result = await proposeRepoMap(root);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.warnings).toContain('Keine versionierten Dateien gefunden.');
  });

  it('caps a large tracked directory tree and never emits dangling links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-repo-map-limit-'));
    roots.push(root);
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    for (let index = 0; index < 170; index += 1) {
      const folder = join(root, 'modules', `part${String(index).padStart(3, '0')}`);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'index.ts'), 'export {}');
    }
    execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
    const result = await proposeRepoMap(root);
    expect(result.truncated).toBe(true);
    expect(result.nodes.length).toBeLessThanOrEqual(160);
    const ids = new Set(result.nodes.map((node) => node.id));
    expect(result.edges.every((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId))).toBe(true);
  });
});
