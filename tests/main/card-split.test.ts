import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { cardSplitLinks, createCardSplit, previewCardSplit } from '../../src/main/card-split';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-split-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic split', path: root });
  const column = store.snapshot(project.id).columns.find((item) => item.name === 'Planning')!;
  const parent = store.createCard({ projectId: project.id, columnId: column.id, title: 'Mobile navigation' });
  const items = [
    { title: 'Specify focus path', description: 'Tab order and Escape', dependsOnIndex: null },
    { title: 'Implement mobile menu', description: 'Use the focus path', dependsOnIndex: 0 },
  ];
  return { root, file, store, project, column, parent, items };
}

describe('card split with explicit preview', () => {
  it('previews without writes, commits relations atomically and survives restart', () => {
    const { file, store, project, column, parent, items } = fixture();
    const input = { cardId: parent.id, columnId: column.id, items };
    const before = store.snapshot(project.id).cards.length;
    const preview = previewCardSplit(store, input);
    expect(preview.items).toEqual(items);
    expect(store.snapshot(project.id).cards).toHaveLength(before);
    expect(cardSplitLinks(store, parent.id).children).toEqual([]);
    expect(() => createCardSplit(store, { ...input, token: preview.token, confirm: false })).toThrow('Bestätigung');
    expect(store.snapshot(project.id).cards).toHaveLength(before);
    const result = createCardSplit(store, { ...input, token: preview.token, confirm: true });
    expect(result.cards).toHaveLength(2);
    expect(result.links.children[1]).toMatchObject({ title: 'Implement mobile menu', dependsOnCardId: result.cards[0]!.id, dependsOnTitle: 'Specify focus path' });
    expect(cardSplitLinks(store, result.cards[1]!.id).parent).toMatchObject({ cardId: parent.id, title: parent.title });
    expect(() => previewCardSplit(store, input)).toThrow('bereits verknüpft');
    store.close();
    const reopened = new StudioStore(file);
    expect(cardSplitLinks(reopened, parent.id).children).toHaveLength(2);
    expect(reopened.snapshot(project.id).cards).toHaveLength(before + 2);
    reopened.close();
  });

  it('rejects stale parent, changed plan, foreign/automatic columns and invalid dependencies', () => {
    const { store, project, column, parent, items } = fixture();
    const input = { cardId: parent.id, columnId: column.id, items };
    const preview = previewCardSplit(store, input);
    expect(() => createCardSplit(store, { ...input, items: [{ ...items[0]!, title: 'Other' }, items[1]!], token: preview.token, confirm: true })).toThrow('seit der Vorschau');
    store.updateCard({ id: parent.id, title: 'Changed parent' });
    expect(() => createCardSplit(store, { ...input, token: preview.token, confirm: true })).toThrow('seit der Vorschau');
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    expect(() => previewCardSplit(store, { ...input, items: [{ ...items[0]!, dependsOnIndex: 1 }, items[1]!] })).toThrow('vorherigen');
    expect(() => previewCardSplit(store, { ...input, items: [items[0]!, { ...items[1]!, title: items[0]!.title.toUpperCase() }] })).toThrow('unterschiedliche');
    const otherPath = join(project.path, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other project', path: otherPath });
    expect(() => previewCardSplit(store, { ...input, columnId: store.snapshot(other.id).columns[0]!.id })).toThrow('anderen Projekt');
    const auto = store.createColumn({ projectId: project.id, name: 'Auto', autoStart: true, agentId: store.agents()[0]!.id });
    expect(() => previewCardSplit(store, { ...input, columnId: auto.id })).toThrow('automatisch');
    store.setCardArchived({ id: parent.id, archived: true });
    expect(() => previewCardSplit(store, input)).toThrow('Archivierte');
    store.close();
  });

  it('guards the To-Do queue and rolls back all cards when a relation write fails', () => {
    const { store, project, column, parent, items } = fixture();
    const todo = store.snapshot(project.id).columns.find((item) => item.name === 'To Do')!;
    store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: null, activeWorkflowId: null, pauseReason: 'Synthetic' });
    expect(() => previewCardSplit(store, { cardId: parent.id, columnId: todo.id, items })).toThrow('Warteschlange');
    store.saveProjectQueue({ projectId: project.id, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    const input = { cardId: parent.id, columnId: column.id, items };
    const preview = previewCardSplit(store, input);
    const before = store.snapshot(project.id).cards.length;
    store.db.exec(`CREATE TRIGGER fail_card_split BEFORE INSERT ON card_splits BEGIN SELECT RAISE(ABORT, 'synthetic relation failure'); END`);
    expect(() => createCardSplit(store, { ...input, token: preview.token, confirm: true })).toThrow('synthetic relation failure');
    expect(store.snapshot(project.id).cards).toHaveLength(before);
    expect(cardSplitLinks(store, parent.id).children).toEqual([]);
    store.close();
  });
});
