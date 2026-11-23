import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptRepoMap, previewRepoMap } from '../../src/main/repo-map-import';
import { StudioStore } from '../../src/main/store';
import { whiteboardSnapshot } from '../../src/main/whiteboard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-repo-map-import-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src', 'components'), { recursive: true });
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  writeFileSync(join(repo, 'package.json'), '{"name":"synthetic-secret-content"}');
  writeFileSync(join(repo, 'src', 'components', 'ReviewPanel.tsx'), 'export const ReviewPanel = "synthetic-secret-content";');
  writeFileSync(join(repo, '.env'), 'TOKEN=synthetic-secret-content');
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' });
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: repo });
  return { root, repo, store, project };
}

describe('reviewed repo-to-whiteboard import', () => {
  it('does not write during preview and atomically imports selected evidenced nodes with stable file links', async () => {
    const { repo, store, project } = fixture();
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    const proposal = await previewRepoMap(store, project.id);
    expect(whiteboardSnapshot(store, project.id)).toEqual({ nodes: [], edges: [] });
    expect(proposal.nodes.some((node) => node.kind === 'component-candidate')).toBe(true);
    expect(JSON.stringify(proposal)).not.toContain('synthetic-secret-content');
    const selected = proposal.nodes.map((node) => node.id);
    const result = await acceptRepoMap(store, { projectId: project.id, fingerprint: proposal.fingerprint, nodeIds: selected });
    expect(result).toMatchObject({ createdNodes: selected.length, reusedNodes: 0, createdEdges: proposal.edges.length });
    const board = whiteboardSnapshot(store, project.id);
    expect(board.nodes.find((node) => node.reference?.kind === 'file')).toMatchObject({ reference: { kind: 'file', path: join('src', 'components', 'ReviewPanel.tsx') } });
    expect(board.nodes.every((node) => !node.description.includes('synthetic-secret-content'))).toBe(true);
    expect(board.edges).toHaveLength(proposal.edges.length);
    expect(await acceptRepoMap(store, { projectId: project.id, fingerprint: proposal.fingerprint, nodeIds: selected }))
      .toMatchObject({ createdNodes: 0, reusedNodes: selected.length, createdEdges: 0, reusedEdges: proposal.edges.length });
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(status);
    store.close();
  });

  it('rejects an invalid or stale selection before touching the board', async () => {
    const { repo, store, project } = fixture();
    const proposal = await previewRepoMap(store, project.id);
    await expect(acceptRepoMap(store, { projectId: project.id, fingerprint: proposal.fingerprint, nodeIds: [] })).rejects.toThrow('mindestens');
    await expect(acceptRepoMap(store, { projectId: project.id, fingerprint: proposal.fingerprint, nodeIds: ['not-in-preview'] })).rejects.toThrow('unbekannten');
    writeFileSync(join(repo, 'src', 'components', 'Added.tsx'), 'export {}');
    execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' });
    await expect(acceptRepoMap(store, { projectId: project.id, fingerprint: proposal.fingerprint, nodeIds: [proposal.nodes[0]!.id] })).rejects.toThrow('geändert');
    expect(whiteboardSnapshot(store, project.id)).toEqual({ nodes: [], edges: [] });
    store.close();
  });

  it('rolls back all additions when the whiteboard node limit is exceeded', async () => {
    const { store, project } = fixture();
    const proposal = await previewRepoMap(store, project.id);
    const stamp = new Date().toISOString();
    const insert = store.db.prepare('INSERT INTO whiteboard_nodes (id, project_id, title, description, x, y, reference_kind, card_id, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)');
    store.db.transaction(() => { for (let i = 0; i < 499; i += 1) insert.run(`existing-${i}`, project.id, `Existing ${i}`, '', i, 0, stamp, stamp); })();
    await expect(acceptRepoMap(store, { projectId: project.id, fingerprint: proposal.fingerprint, nodeIds: proposal.nodes.map((node) => node.id) })).rejects.toThrow('Maximal 500');
    expect(whiteboardSnapshot(store, project.id).nodes).toHaveLength(499);
    store.close();
  });
});
