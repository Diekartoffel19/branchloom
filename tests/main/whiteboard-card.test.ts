import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createCardFromWhiteboardEdge, createWhiteboardEdge, createWhiteboardNode, deleteWhiteboardEdge, whiteboardSnapshot } from '../../src/main/whiteboard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-card-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src', 'renderer'), { recursive: true });
  const project = store.createProject({ name: 'Synthetic project', path: repo });
  const column = store.snapshot(project.id).columns.find((item) => item.name === 'To Do')!;
  const source = createWhiteboardNode(store, { projectId: project.id, title: 'Renderer', x: 0, y: 0, reference: { kind: 'folder', path: 'src/renderer' } });
  const existing = store.createCard({ projectId: project.id, columnId: column.id, title: 'Existing card' });
  const target = createWhiteboardNode(store, { projectId: project.id, title: 'Task', x: 200, y: 0, reference: { kind: 'card', cardId: existing.id } });
  const edge = createWhiteboardEdge(store, { projectId: project.id, sourceId: source.id, targetId: target.id, label: 'requires' });
  return { file, store, project, column, source, target, edge, existing };
}

describe('deliberate board card from whiteboard connection', () => {
  it('persists the edge/card relation and readable source references across restart; repeated creation is idempotent', () => {
    const { file, store, project, column, edge, existing } = fixture();
    const input = { projectId: project.id, edgeId: edge.id, columnId: column.id, title: 'Build renderer', description: 'Implement a testable change.' };
    const created = createCardFromWhiteboardEdge(store, input);
    expect(created).toMatchObject({ projectId: project.id, columnId: column.id, title: input.title });
    expect(created.description).toContain('Implement a testable change.');
    expect(created.description).toContain(`Whiteboard-Bezug: Renderer (Ordner ${join('src', 'renderer')}) → Task (Karte ${existing.id}) · requires`);
    expect(whiteboardSnapshot(store, project.id).edges[0]?.cardId).toBe(created.id);
    store.close();

    const reopened = new StudioStore(file);
    expect(whiteboardSnapshot(reopened, project.id).edges[0]?.cardId).toBe(created.id);
    expect(createCardFromWhiteboardEdge(reopened, { ...input, title: 'Accidental duplicate' }).id).toBe(created.id);
    expect(reopened.snapshot(project.id).cards.filter((card) => card.id === created.id)).toHaveLength(1);
    deleteWhiteboardEdge(reopened, { projectId: project.id, id: edge.id });
    expect(reopened.card(created.id).description).toContain('Whiteboard-Bezug:');
    expect(whiteboardSnapshot(reopened, project.id).edges).toEqual([]);
    reopened.close();
  });

  it('rejects wrong project, destination and running queue without creating a card', () => {
    const { store, project, column, edge } = fixture();
    const secondRoot = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-card-other-'));
    roots.push(secondRoot);
    const other = store.createProject({ name: 'Other', path: secondRoot });
    const otherColumn = store.snapshot(other.id).columns[0]!;
    const input = { projectId: project.id, edgeId: edge.id, columnId: column.id, title: 'New card', description: '' };
    const initial = store.snapshot(project.id).cards.length;
    expect(() => createCardFromWhiteboardEdge(store, { ...input, projectId: other.id })).toThrow('nicht gefunden');
    expect(() => createCardFromWhiteboardEdge(store, { ...input, columnId: otherColumn.id })).toThrow('Zielspalte');
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => createCardFromWhiteboardEdge(store, input)).toThrow('Warteschlange');
    expect(store.snapshot(project.id).cards).toHaveLength(initial);
    expect(whiteboardSnapshot(store, project.id).edges[0]?.cardId).toBeNull();
    store.close();
  });

  it('rolls back invalid drafts and allows a later valid confirmation', () => {
    const { store, project, column, edge } = fixture();
    const input = { projectId: project.id, edgeId: edge.id, columnId: column.id, title: 'Valid', description: 'A result' };
    const initial = store.snapshot(project.id).cards.length;
    expect(() => createCardFromWhiteboardEdge(store, { ...input, title: ' ' })).toThrow();
    expect(() => createCardFromWhiteboardEdge(store, { ...input, description: null as unknown as string })).toThrow('Auftrag');
    expect(() => createCardFromWhiteboardEdge(store, { ...input, description: 'x'.repeat(30_000) })).toThrow();
    expect(store.snapshot(project.id).cards).toHaveLength(initial);
    expect(whiteboardSnapshot(store, project.id).edges[0]?.cardId).toBeNull();
    expect(createCardFromWhiteboardEdge(store, input).title).toBe('Valid');
    store.close();
  });

  it('clears the relation if the generated card is deleted', () => {
    const { store, project, column, edge } = fixture();
    const input = { projectId: project.id, edgeId: edge.id, columnId: column.id, title: 'First', description: '' };
    const created = createCardFromWhiteboardEdge(store, input);
    store.db.prepare('DELETE FROM cards WHERE id = ?').run(created.id);
    expect(whiteboardSnapshot(store, project.id).edges[0]?.cardId).toBeNull();
    const replacement = createCardFromWhiteboardEdge(store, { ...input, title: 'Replacement' });
    expect(replacement.id).not.toBe(created.id);
    expect(whiteboardSnapshot(store, project.id).edges[0]?.cardId).toBe(replacement.id);
    store.close();
  });
});
