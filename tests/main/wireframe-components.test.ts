import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { cardWireframe } from '../../src/main/card-wireframe';
import { listWireframeComponents, removeWireframeComponent, saveWireframeComponent } from '../../src/main/wireframe-components';
import type { WireframeElement } from '../../src/shared/card-wireframe';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-components-'));
  roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath);
  const dbFile = join(root, 'studio.sqlite');
  const store = new StudioStore(dbFile);
  const project = store.createProject({ name: 'Synthetic project', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Desktop app' });
  return { root, dbFile, store, project, card };
}

const title: WireframeElement = { id: 'title', kind: 'text', x: 30, y: 40, width: 180, height: 40, text: 'Projekt', tone: 'plain', groupId: 'header' };
const button: WireframeElement = { id: 'button', kind: 'button', x: 220, y: 42, width: 100, height: 36, text: 'Öffnen', tone: 'accent', groupId: 'header' };

describe('project design components', () => {
  it('persists a selected group with relative geometry, without changing the card draft', () => {
    const { dbFile, store, project, card } = fixture();
    const input = { projectId: project.id, cardId: card.id, name: '  Kopfzeile  ', sourceArtboard: 'desktop' as const, elements: [title, button] };
    const saved = saveWireframeComponent(store, input);
    expect(saved).toMatchObject({ projectId: project.id, name: 'Kopfzeile', width: 290, height: 40, sourceArtboard: 'desktop' });
    expect(saved.elements).toEqual([{ ...title, x: 0, y: 0 }, { ...button, x: 190, y: 2 }]);
    expect(cardWireframe(store, { projectId: project.id, cardId: card.id })).toBeNull();
    store.close();
    const reopened = new StudioStore(dbFile);
    expect(listWireframeComponents(reopened, project.id)).toEqual([saved]);
    reopened.close();
  });

  it('scopes list and deletion to the project and preserves other components', () => {
    const { root, store, project, card } = fixture();
    const secondPath = join(root, 'second'); mkdirSync(secondPath);
    const second = store.createProject({ name: 'Another', path: secondPath });
    const saved = saveWireframeComponent(store, { projectId: project.id, cardId: card.id, name: 'Kopf', sourceArtboard: 'desktop', elements: [title] });
    expect(listWireframeComponents(store, second.id)).toEqual([]);
    expect(() => saveWireframeComponent(store, { projectId: second.id, cardId: card.id, name: 'Fremd', sourceArtboard: 'desktop', elements: [title] })).toThrow('gehört nicht');
    expect(() => removeWireframeComponent(store, { projectId: second.id, id: saved.id })).toThrow('nicht gefunden');
    expect(listWireframeComponents(store, project.id)).toHaveLength(1);
    removeWireframeComponent(store, { projectId: project.id, id: saved.id });
    expect(listWireframeComponents(store, project.id)).toEqual([]);
    store.close();
  });

  it('rejects empty, invalid or excessive library records', () => {
    const { store, project, card } = fixture();
    const input = { projectId: project.id, cardId: card.id, name: 'Kopf', sourceArtboard: 'desktop' as const, elements: [title] };
    expect(() => saveWireframeComponent(store, { ...input, elements: [] })).toThrow('mindestens');
    expect(() => saveWireframeComponent(store, { ...input, name: ' '.repeat(4) })).toThrow('Bausteinname');
    expect(() => saveWireframeComponent(store, { ...input, sourceArtboard: 'wrong' as 'desktop' })).toThrow('Unbekannte');
    expect(() => saveWireframeComponent(store, { ...input, elements: [{ ...title, x: -1 }] })).toThrow();
    expect(() => saveWireframeComponent(store, { ...input, elements: [title, title] })).toThrow();
    expect(listWireframeComponents(store, project.id)).toEqual([]);
    for (let index = 0; index < 50; index++) saveWireframeComponent(store, { ...input, name: `Kopf ${index}` });
    expect(() => saveWireframeComponent(store, input)).toThrow('50');
    store.close();
  });
});
