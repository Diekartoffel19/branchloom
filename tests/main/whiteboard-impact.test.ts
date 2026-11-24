import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { StudioStore } from '../../src/main/store';
import { createWhiteboardNode, deleteWhiteboardNode } from '../../src/main/whiteboard';
import { analyzeWhiteboardImpact, createCardFromWhiteboardImpact } from '../../src/main/whiteboard-impact';

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
  it('traces bounded shortest import chains in a synthetic Git project with exact edge lines', () => {
    const { repo, store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/ui/index.ts', "// barrel\nexport { Button } from './Button';");
    file('src/App.tsx', "// app\nimport { Button } from './ui';\nimport './page';");
    file('src/page.tsx', "// page\nimport './App';");
    file('src/root.tsx', "import './page';");
    file('src/alias.tsx', "import '@/ui/Button';");
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic fixture']);
    const button = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const fileImpact = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: button.id });
    expect(fileImpact.importers).toMatchObject([{ path: 'src/ui/index.ts', line: 2, targetPath: 'src/ui/Button.tsx' }]);
    expect(fileImpact.transitiveImporters).toMatchObject([
      { path: 'src/App.tsx', depth: 2, chain: [{ path: 'src/App.tsx', line: 2, targetPath: 'src/ui/index.ts' }, { path: 'src/ui/index.ts', line: 2, targetPath: 'src/ui/Button.tsx' }] },
      { path: 'src/page.tsx', depth: 3, chain: [{ path: 'src/page.tsx', line: 2, targetPath: 'src/App.tsx' }, { path: 'src/App.tsx', line: 2, targetPath: 'src/ui/index.ts' }, { path: 'src/ui/index.ts', line: 2, targetPath: 'src/ui/Button.tsx' }] },
    ]);
    expect(fileImpact.transitiveImporters.some((item) => item.path === 'src/root.tsx' || item.path === 'src/alias.tsx')).toBe(false);
    expect(fileImpact.partial).toBe(true);
    expect(fileImpact.notes.join(' ')).toContain('jenseits von 3 Schritten');
    const folder = createWhiteboardNode(store, { projectId: project.id, title: 'UI', x: 0, y: 0, reference: { kind: 'folder', path: 'src/ui' } });
    const folderImpact = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: folder.id });
    expect(folderImpact.importers).toMatchObject([{ path: 'src/App.tsx', line: 2, targetPath: 'src/ui/index.ts' }]);
    expect(folderImpact.transitiveImporters.map((item) => item.path)).toEqual(['src/page.tsx', 'src/root.tsx']);
    expect(folderImpact.transitiveImporters[0]).toMatchObject({ path: 'src/page.tsx', depth: 2, chain: [{ path: 'src/page.tsx', line: 2 }, { path: 'src/App.tsx', line: 2 }] });
    store.close();
  });
  it('creates an explicit editable card with durable source provenance and no agent session', () => {
    const { root, store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/App.tsx', "import './ui/Button';");
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'UI', x: 0, y: 0, reference: { kind: 'folder', path: 'src/ui' } });
    const impact = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id });
    const columnId = store.snapshot(project.id).columns.find((column) => column.name === 'To Do')!.id;
    const card = createCardFromWhiteboardImpact(store, { projectId: project.id, nodeId: node.id, referencePath: impact.referencePath,
      site: impact.importers[0]!, columnId, title: 'Eigener Titel', description: 'Eigener Auftrag' });
    expect(card).toMatchObject({ projectId: project.id, columnId, title: 'Eigener Titel' });
    expect(card.description).toContain('Eigener Auftrag\n\nWhiteboard-Importbezug:');
    expect(card.description).toContain('src/App.tsx:1 importiert src/ui/Button.tsx');
    expect(store.snapshot(project.id).sessions).toEqual([]);
    const relation = store.db.prepare('SELECT * FROM whiteboard_import_cards WHERE card_id = ?').get(card.id) as { node_id: string | null; source_path: string; target_path: string };
    expect(relation).toMatchObject({ node_id: node.id, source_path: 'src/App.tsx', target_path: 'src/ui/Button.tsx' });
    deleteWhiteboardNode(store, { projectId: project.id, id: node.id });
    expect((store.db.prepare('SELECT node_id FROM whiteboard_import_cards WHERE card_id = ?').get(card.id) as { node_id: string | null }).node_id).toBeNull();
    store.close();
    const reopened = new StudioStore(join(root, 'studio.sqlite'));
    expect(reopened.card(card.id).description).toContain('Whiteboard-Importbezug:');
    reopened.close();
  });

  it('rejects changed imports, forged sites and foreign project or column IDs', () => {
    const { root, store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/App.tsx', "import './ui/Button';");
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const impact = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id });
    const columnId = store.snapshot(project.id).columns[0]!.id;
    const input = { projectId: project.id, nodeId: node.id, referencePath: impact.referencePath, site: impact.importers[0]!, columnId, title: 'Check', description: '' };
    expect(() => createCardFromWhiteboardImpact(store, { ...input, site: { ...input.site, path: '../foreign.ts' } })).toThrow('veraltet');
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(() => createCardFromWhiteboardImpact(store, { ...input, projectId: other.id })).toThrow('nicht zu diesem Projekt');
    expect(() => createCardFromWhiteboardImpact(store, { ...input, columnId: store.snapshot(other.id).columns[0]!.id })).toThrow('Zielspalte');
    file('src/App.tsx', "// changed\nimport './ui/Button';");
    expect(() => createCardFromWhiteboardImpact(store, input)).toThrow('veraltet');
    expect(store.snapshot(project.id).cards).toEqual([]);
    store.close();
  });

  it('blocks a running queue and an auto-start column before creating a card', () => {
    const { store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/App.tsx', "import './ui/Button';");
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const impact = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id });
    const columnId = store.snapshot(project.id).columns[0]!.id;
    const input = { projectId: project.id, nodeId: node.id, referencePath: impact.referencePath, site: impact.importers[0]!, columnId, title: 'Check', description: '' };
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => createCardFromWhiteboardImpact(store, input)).toThrow('Warteschlange');
    store.saveProjectQueue({ projectId: project.id, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    const agent = store.snapshot(project.id).agents[0]!;
    store.updateColumn({ id: columnId, agentId: agent.id, autoStart: true });
    expect(() => createCardFromWhiteboardImpact(store, input)).toThrow('automatischen Agentenstart');
    expect(store.snapshot(project.id).cards).toEqual([]);
    store.close();
  });
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

  it('does not count imports written only in comments, strings or template bodies', () => {
    const { store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/App.tsx', [
      "// import './ui/Button';",
      `const copy = "import './ui/Button'; require('./ui/Button')";`,
      "/* import './ui/Button';",
      "require('./ui/Button'); */",
      "const template = `import './ui/Button'`;",
      "import './ui/Button';",
    ].join('\n'));
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    expect(analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id }).importers).toMatchObject([{ path: 'src/App.tsx', line: 6 }]);
    store.close();
  });

  it('marks an exact file-limit boundary incomplete if folders remain unvisited', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-impact-limit-'));
    roots.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'a'), { recursive: true });
    mkdirSync(join(repo, 'z'));
    for (let index = 0; index < 1000; index++) writeFileSync(join(repo, 'a', `file-${String(index).padStart(4, '0')}.ts`), 'export {};');
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'Limit', path: repo });
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'A', x: 0, y: 0, reference: { kind: 'folder', path: 'a' } });
    const result = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id });
    expect(result.partial).toBe(true);
    expect(result.notes.join(' ')).toContain('weitere Ordner');
    store.close();
  });

  it('caps import evidence while marking the list incomplete', () => {
    const { store, project, file } = fixture();
    file('src/ui/Button.tsx', 'export const Button = 1;');
    file('src/App.tsx', Array.from({ length: 80 }, () => "import './ui/Button';").join('\n'));
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Button', x: 0, y: 0, reference: { kind: 'file', path: 'src/ui/Button.tsx' } });
    const result = analyzeWhiteboardImpact(store, { projectId: project.id, nodeId: node.id });
    expect(result.importers).toHaveLength(50);
    expect(result.partial).toBe(true);
    expect(result.notes.filter((note) => note.includes('Mehr als 50'))).toHaveLength(1);
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
