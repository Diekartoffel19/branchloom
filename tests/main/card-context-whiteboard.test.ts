import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { addCardContextReferenceFromWhiteboardNode, cardContextCandidateFromWhiteboardNode, cardContextReferences } from '../../src/main/card-context';
import { createWhiteboardNode, deleteWhiteboardNode, updateWhiteboardNode } from '../../src/main/whiteboard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-wb-context-')); roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'guide.md'), '# Synthetic guide');
  writeFileSync(join(repo, 'docs', 'other.md'), '# Other synthetic file');
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic Whiteboard context', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Context card' });
  const node = createWhiteboardNode(store, { projectId: project.id, title: 'Guide box', x: 0, y: 0, reference: { kind: 'file', path: 'docs/guide.md' } });
  return { root, repo, file, store, project, card, node };
}

describe('Whiteboard file to card context', () => {
  it('prepares only a draft, then explicitly stores a project file across restart', () => {
    const { store, file, card, node } = fixture();
    const target = cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id });
    expect(target).toBe('docs/guide.md');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    expect(addCardContextReferenceFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id, expectedTarget: target }))
      .toMatchObject([{ kind: 'file', target: 'docs/guide.md', available: true }]);
    expect(() => addCardContextReferenceFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id, expectedTarget: target })).toThrow('bereits');
    store.close();
    const reopened = new StudioStore(file);
    expect(cardContextReferences(reopened, card.id)).toMatchObject([{ target: 'docs/guide.md', available: true }]);
    reopened.close();
  });

  it('rejects foreign, unlinked, folder and archived sources', () => {
    const { store, root, project, card, node } = fixture();
    const otherRepo = join(root, 'other-repo'); mkdirSync(otherRepo);
    writeFileSync(join(otherRepo, 'foreign.md'), 'Synthetic foreign file');
    const otherProject = store.createProject({ name: 'Other project', path: otherRepo });
    const foreignNode = createWhiteboardNode(store, { projectId: otherProject.id, title: 'Foreign', x: 0, y: 0, reference: { kind: 'file', path: 'foreign.md' } });
    const folder = createWhiteboardNode(store, { projectId: project.id, title: 'Folder', x: 0, y: 0, reference: { kind: 'folder', path: 'docs' } });
    const empty = createWhiteboardNode(store, { projectId: project.id, title: 'Empty', x: 0, y: 0 });
    expect(() => cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: foreignNode.id })).toThrow('anderen Projekt');
    expect(() => cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: folder.id })).toThrow('keine gespeicherte Dateiverknüpfung');
    expect(() => cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: empty.id })).toThrow('keine gespeicherte Dateiverknüpfung');
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id })).toThrow('Archivierte');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    store.close();
  });

  it('rejects changed or deleted boxes and missing or escaping paths at confirmation', () => {
    const { store, repo, root, project, card, node } = fixture();
    const target = cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id });
    updateWhiteboardNode(store, { projectId: project.id, id: node.id, reference: { kind: 'file', path: 'docs/other.md' } });
    expect(() => addCardContextReferenceFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id, expectedTarget: target })).toThrow('geändert');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    rmSync(join(repo, 'docs', 'other.md'));
    expect(() => cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id })).toThrow('nicht gefunden');
    writeFileSync(join(root, 'outside.md'), 'Outside synthetic file');
    store.db.prepare('UPDATE whiteboard_nodes SET folder_path = ? WHERE id = ?').run('../outside.md', node.id);
    expect(() => cardContextCandidateFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id })).toThrow('außerhalb');
    deleteWhiteboardNode(store, { projectId: project.id, id: node.id });
    expect(() => addCardContextReferenceFromWhiteboardNode(store, { cardId: card.id, nodeId: node.id, expectedTarget: target })).toThrow('entfernt');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    store.close();
  });
});
