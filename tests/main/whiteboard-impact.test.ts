import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createWhiteboardNode } from '../../src/main/whiteboard';
import { analyzeWhiteboardImpact } from '../../src/main/whiteboard-impact';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-impact-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src', 'ui'), { recursive: true });
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const file = (path: string, contents: string) => {
    const full = join(repo, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  };
  return { root, repo, store, project, file };
}

describe('whiteboard direct-import impact', () => {
  it('finds direct file and folder importers with real relative paths and no agent action', () => {
    const { store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/ui/index.ts', "export { Button } from './Button';");
    file('src/App.tsx', "import { Button } from './ui/Button';\nimport { Button as B } from './ui';");
    file('src/other.ts', "const Button = require('./ui/Button');");
    file('src/unrelated.ts', "import './not-ui';");
    const button = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const folder = createWhiteboardNode(store, { projectId: project.id, title: 'UI', x: 0, y: 0, reference: { kind: 'folder', path: 'src/ui' } });
    const fileResult = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: button.id });
    expect(fileResult).toMatchObject({ partial: false, referenceKind: 'file', importers: [
      { path: 'src/App.tsx', targetPath: 'src/ui/Button.tsx', line: 1 },
      { path: 'src/other.ts', targetPath: 'src/ui/Button.tsx', line: 1 },
      { path: 'src/ui/index.ts', targetPath: 'src/ui/Button.tsx', line: 1 },
    ] });
    const folderResult = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: folder.id });
    expect(folderResult.importers.map((item) => item.path)).toEqual(['src/App.tsx', 'src/App.tsx', 'src/other.ts']);
    expect(folderResult.importers.every((item) => item.targetPath.startsWith('src/ui/'))).toBe(true);
    expect(folderResult.notes.join(' ')).toContain('keine Aliase');
    store.close();
  });

  it('refuses foreign projects, stale paths and a forged path escape', () => {
    const { root, repo, store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const otherRoot = join(root, 'other'); mkdirSync(otherRoot);
    const other = store.createProject({ name: 'Other', path: otherRoot });
    expect(() => analyzeWhiteboardImpact(store, { projectId: other.id, nodeId: node.id })).toThrow('nicht zu diesem Projekt');
    store.db.prepare('UPDATE whiteboard_nodes SET folder_path = ? WHERE id = ?').run('..', node.id);
    expect(() => analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id })).toThrow('außerhalb');
    store.db.prepare('UPDATE whiteboard_nodes SET folder_path = ? WHERE id = ?').run('src/ui/Button.tsx', node.id);
    rmSync(join(repo, 'src', 'ui', 'Button.tsx'));
    expect(() => analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id })).toThrow();
    store.close();
  });

  it('marks oversized source files as incomplete rather than reporting a safe absence', () => {
    const { store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/large.ts', `${' '.repeat(257 * 1024)}\nimport './ui/Button';`);
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const result = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id });
    expect(result).toMatchObject({ partial: true, importers: [], scannedFiles: 0 });
    expect(result.notes.join(' ')).toContain('256 KiB');
    store.close();
  });

  it('refuses a saved reference retargeted through a symlink when supported', () => {
    const { root, repo, store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const outside = join(root, 'outside.ts'); writeFileSync(outside, 'secret');
    rmSync(join(repo, 'src', 'ui', 'Button.tsx'));
    try { symlinkSync(outside, join(repo, 'src', 'ui', 'Button.tsx'), 'file'); }
    catch { store.close(); return; }
    expect(() => analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id })).toThrow('Symlink');
    store.close();
  });
});
