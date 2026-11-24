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

  it('keeps the approved revision when an identical draft is saved again', () => {
    const { store, key } = fixture();
    const saved = saveCardWireframe(store, { ...key, title: 'Fensterentwurf', elements: [element], expectedRevision: 0 });
    const approved = approveCardWireframe(store, { ...key, expectedRevision: saved.revision });
    const unchanged = saveCardWireframe(store, { ...key, title: ' Fensterentwurf ', elements: [element], expectedRevision: approved.revision });
    expect(unchanged).toEqual(approved);
    expect(cardWireframe(store, key)).toEqual(approved);
    expect(approvedCardWireframeContext(store, key)).toContain('Projektübersicht');
    store.close();
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

  it('stores separately editable tablet and mobile artboards without changing desktop or approval boundaries', () => {
    const { dbFile, store, key } = fixture();
    const tablet = { ...element, x: 700, y: 900, width: 60, height: 42, text: 'Tablet' };
    const mobile = { ...element, x: 300, y: 790, width: 80, height: 42, text: 'Mobile' };
    const saved = saveCardWireframe(store, { ...key, title: 'Drei Flächen', expectedRevision: 0, elements: [element], artboards: { tablet: [tablet], mobile: [mobile] } });
    expect(saved.artboards).toEqual({ tablet: [tablet], mobile: [mobile] });
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    const unchanged = saveCardWireframe(store, { ...key, title: 'Drei Flächen', expectedRevision: 1, elements: [element], artboards: { mobile: [mobile], tablet: [tablet] } });
    expect(unchanged).toMatchObject({ revision: 1, approvedRevision: 1 });
    const context = approvedCardWireframeContext(store, key);
    expect(context).toContain('"tablet":{"canvas"');
    expect(context).toContain('"mobile":{"canvas"');
    expect(context).toContain('"width":768');
    expect(context).toContain('"width":390');
    store.close();
    const reopened = new StudioStore(dbFile);
    expect(cardWireframe(reopened, key)?.artboards).toEqual({ tablet: [tablet], mobile: [mobile] });
    const changed = saveCardWireframe(reopened, { ...key, title: 'Mobile neu', expectedRevision: 1, elements: [element], artboards: { tablet: [tablet], mobile: [{ ...mobile, x: 240 }] } });
    expect(changed).toMatchObject({ revision: 2, approvedRevision: null });
    expect(changed.elements).toEqual([element]);
    expect(approvedCardWireframeContext(reopened, key)).toBe('');
    const legacyCaller = saveCardWireframe(reopened, { ...key, title: 'Desktop neu', expectedRevision: 2, elements: [{ ...element, x: 30 }] });
    expect(legacyCaller.artboards.mobile?.[0]?.x).toBe(240);
    const removed = saveCardWireframe(reopened, { ...key, title: 'Nur Desktop', expectedRevision: 3, elements: [element], artboards: {} });
    expect(removed.artboards).toEqual({});
    reopened.close();
  });

  it('rejects overflow or unknown artboards before mutating a document', () => {
    const { store, key } = fixture();
    for (const artboards of [
      { mobile: [{ ...element, x: 350, width: 100 }] },
      { tablet: [{ ...element, y: 1000, height: 100 }] },
      { tv: [element] },
    ]) expect(() => saveCardWireframe(store, { ...key, title: 'Ungültig', expectedRevision: 0, elements: [element], artboards: artboards as never })).toThrow();
    expect(cardWireframe(store, key)).toBeNull();
    store.close();
  });

  it('allows approval of a mobile-only design but not a completely empty document', () => {
    const { store, key } = fixture();
    const mobile = { ...element, x: 0, y: 36, width: 300, height: 42 };
    const saved = saveCardWireframe(store, { ...key, title: 'Mobile zuerst', expectedRevision: 0, elements: [], artboards: { mobile: [mobile] } });
    expect(approveCardWireframe(store, { ...key, expectedRevision: saved.revision }).approvedRevision).toBe(1);
    const empty = saveCardWireframe(store, { ...key, title: 'Leer', expectedRevision: 1, elements: [], artboards: {} });
    expect(() => approveCardWireframe(store, { ...key, expectedRevision: empty.revision })).toThrow('leerer Entwurf');
    store.close();
  });

  it('migrates a saved desktop-only wireframe without losing approval', () => {
    const { dbFile, store, key } = fixture();
    store.db.exec(`DROP TABLE card_wireframes;
      CREATE TABLE card_wireframes (
        card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, elements_json TEXT NOT NULL,
        revision INTEGER NOT NULL, approved_revision INTEGER, updated_at TEXT NOT NULL
      );`);
    store.db.prepare('INSERT INTO card_wireframes VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(key.cardId, key.projectId, 'Alter Entwurf', JSON.stringify([element]), 3, 3, new Date().toISOString());
    store.close();
    const reopened = new StudioStore(dbFile);
    expect(cardWireframe(reopened, key)).toMatchObject({ title: 'Alter Entwurf', elements: [element], artboards: {}, revision: 3, approvedRevision: 3 });
    expect(approvedCardWireframeContext(reopened, key)).toContain('Projektübersicht');
    reopened.close();
  });

  it('persists optional style overrides across artboards and includes only approved values in agent context', () => {
    const { dbFile, store, key } = fixture();
    const styled = { ...element, style: { fontSize: 22, fontWeight: 700, textColor: '#26312B', fill: '#F8F8F5', stroke: '#AABBAA', radius: 8 } } as WireframeElement;
    const saved = saveCardWireframe(store, { ...key, title: 'Gestaltung', expectedRevision: 0, elements: [styled], artboards: { mobile: [{ ...styled, x: 10, width: 300 }] } });
    expect(saved.elements[0]?.style).toEqual({ fill: '#f8f8f5', stroke: '#aabbaa', textColor: '#26312b', radius: 8, fontSize: 22, fontWeight: 700 });
    expect(approvedCardWireframeContext(store, key)).toBe('');
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    expect(approvedCardWireframeContext(store, key)).toContain('"fontSize":22');
    expect(approvedCardWireframeContext(store, key)).toContain('"textColor":"#26312b"');
    store.close();
    const reopened = new StudioStore(dbFile);
    const current = cardWireframe(reopened, key)!;
    expect(current.artboards.mobile?.[0]?.style).toEqual(current.elements[0]?.style);
    expect(saveCardWireframe(reopened, { ...key, title: current.title, expectedRevision: current.revision, elements: current.elements, artboards: current.artboards })).toMatchObject({ revision: 1, approvedRevision: 1 });
    expect(saveCardWireframe(reopened, { ...key, title: current.title, expectedRevision: 1, elements: [{ ...current.elements[0]!, style: { ...current.elements[0]!.style, fontSize: 24 } }], artboards: current.artboards })).toMatchObject({ revision: 2, approvedRevision: null });
    expect(approvedCardWireframeContext(reopened, key)).toBe('');
    reopened.close();
  });

  it('rejects malformed styles without mutating saved content and keeps a legacy approval unchanged', () => {
    const { store, key } = fixture();
    for (const style of [null, [], { fill: 'red' }, { fill: '#12345' }, { stroke: '#123456;url(foo)' }, { radius: -1 }, { radius: 65 }, { fontSize: 7 }, { fontWeight: 900 }, { opacity: 1 }]) {
      expect(() => saveCardWireframe(store, { ...key, title: 'Ungültig', expectedRevision: 0, elements: [{ ...element, style } as WireframeElement] })).toThrow();
    }
    expect(cardWireframe(store, key)).toBeNull();
    saveCardWireframe(store, { ...key, title: 'Alt', expectedRevision: 0, elements: [element] });
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    expect(saveCardWireframe(store, { ...key, title: 'Alt', expectedRevision: 1, elements: [{ ...element, style: {} }] })).toMatchObject({ revision: 1, approvedRevision: 1 });
    store.close();
  });

  it('round-trips only whitelisted semantic theme colors without changing an existing hex style', () => {
    const { dbFile, store, key } = fixture();
    const saved = saveCardWireframe(store, { ...key, title: 'Theme', expectedRevision: 0, elements: [
      { ...element, style: { fill: '@fill', stroke: '@stroke', textColor: '@foreground' } },
    ], artboards: { mobile: [{ ...element, x: 10, width: 300, style: { textColor: '#334455' } }] } });
    expect(saved.elements[0]?.style).toEqual({ fill: '@fill', stroke: '@stroke', textColor: '@foreground' });
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    expect(approvedCardWireframeContext(store, key)).toContain('"textColor":"@foreground"');
    store.close();
    const reopened = new StudioStore(dbFile);
    expect(cardWireframe(reopened, key)?.artboards.mobile?.[0]?.style?.textColor).toBe('#334455');
    expect(saveCardWireframe(reopened, { ...key, title: 'Theme', expectedRevision: 1, elements: saved.elements, artboards: saved.artboards })).toMatchObject({ revision: 1, approvedRevision: 1 });
    for (const style of [{ fill: '@foreground' }, { textColor: '@fill' }, { stroke: '@unknown' }, { fill: 'var(--surface-2)' }]) {
      expect(() => saveCardWireframe(reopened, { ...key, title: 'Theme', expectedRevision: 1, elements: [{ ...element, style }] as WireframeElement[] })).toThrow('Farben');
    }
    reopened.close();
  });
});
