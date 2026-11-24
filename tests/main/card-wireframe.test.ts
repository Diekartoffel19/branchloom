import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { approveCardWireframe, approvedCardWireframeContext, cardWireframe, checkedWireframeElements, saveCardWireframe } from '../../src/main/card-wireframe';
import type { WireframeElement } from '../../src/shared/card-wireframe';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-wireframe-'));
  roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath);
  const dbFile = join(root, 'studio.sqlite');
  const store = new StudioStore(dbFile);
  const project = store.createProject({ name: 'Synthetic wireframe', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Desktop app' });
  const key = { projectId: project.id, cardId: card.id };
  return { root, dbFile, store, project, card, key };
}

const element: WireframeElement = { id: 'title', kind: 'text', x: 28, y: 36, width: 400, height: 42, text: 'Projektübersicht', tone: 'plain' };

describe('task-linked wireframes', () => {
  it('persists an editable document and explicit approval across restart, then revokes approval on save', () => {
    const { dbFile, store, key } = fixture();
    expect(cardWireframe(store, key)).toBeNull();
    const saved = saveCardWireframe(store, { ...key, title: 'Fensterentwurf', elements: [element], expectedRevision: 0 });
    expect(saved).toMatchObject({ revision: 1, approvedRevision: null, title: 'Fensterentwurf' });
    expect(approvedCardWireframeContext(store, key)).toBe('');
    expect(approveCardWireframe(store, { ...key, expectedRevision: 1 }).approvedRevision).toBe(1);
    expect(approvedCardWireframeContext(store, key)).toContain('Projektübersicht');
    store.close();
    const reopened = new StudioStore(dbFile);
    expect(cardWireframe(reopened, key)).toMatchObject({ revision: 1, approvedRevision: 1, elements: [element] });
    const changed = saveCardWireframe(reopened, { ...key, title: 'Geändert', elements: [{ ...element, x: 80 }], expectedRevision: 1 });
    expect(changed).toMatchObject({ revision: 2, approvedRevision: null });
    expect(approvedCardWireframeContext(reopened, key)).toBe('');
    reopened.close();
  });

  it('rejects stale writes, empty approval and cross-project access without changing the saved document', () => {
    const { root, store, key } = fixture();
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    const blank = saveCardWireframe(store, { ...key, expectedRevision: 0, title: 'Leer', elements: [] });
    expect(() => approveCardWireframe(store, { ...key, expectedRevision: blank.revision })).toThrow('leerer Entwurf');
    expect(() => saveCardWireframe(store, { ...key, expectedRevision: 0, title: 'Alt', elements: [element] })).toThrow('zwischenzeitlich');
    expect(() => saveCardWireframe(store, { projectId: other.id, cardId: key.cardId, expectedRevision: 0, title: 'Fremd', elements: [element] })).toThrow('gehört nicht');
    expect(() => cardWireframe(store, { projectId: other.id, cardId: key.cardId })).toThrow('gehört nicht');
    expect(cardWireframe(store, key)).toMatchObject({ revision: 1, elements: [] });
    store.close();
  });

  it('validates geometry, bounded content and element identity before storage', () => {
    const { store, key } = fixture();
    for (const elements of [
      [{ ...element, x: 900 }], [{ ...element, width: 0 }], [{ ...element, x: -1 }],
      [{ ...element, id: '../bad' }], [{ ...element, kind: 'script' }],
      [element, element], [{ ...element, text: 'x'.repeat(121) }],
    ]) expect(() => saveCardWireframe(store, { ...key, expectedRevision: 0, title: 'Ungültig', elements: elements as WireframeElement[] })).toThrow();
    expect(() => checkedWireframeElements(Array.from({ length: 41 }, (_, index) => ({ ...element, id: `item-${index}` })))).toThrow('40');
    expect(cardWireframe(store, key)).toBeNull();
    store.close();
  });

  it('removes the document with its card and does not create an agent session', () => {
    const { store, key } = fixture();
    saveCardWireframe(store, { ...key, expectedRevision: 0, title: 'Entwurf', elements: [element] });
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    expect(store.snapshot(key.projectId).sessions).toHaveLength(0);
    store.db.prepare('DELETE FROM cards WHERE id = ?').run(key.cardId);
    expect((store.db.prepare('SELECT COUNT(*) AS count FROM card_wireframes WHERE card_id = ?').get(key.cardId) as { count: number }).count).toBe(0);
    store.close();
  });
});
