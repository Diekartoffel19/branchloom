import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { parseTrelloBoard } from '../../src/main/trello-import';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const ids = {
  board: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  list: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  first: 'cccccccccccccccccccccccc',
  second: 'dddddddddddddddddddddddd',
  archived: 'eeeeeeeeeeeeeeeeeeeeeeee',
};

function board(extra = {}) {
  return JSON.stringify({
    id: ids.board,
    name: 'Synthetic board',
    lists: [{ id: ids.list, name: 'Backlog' }],
    cards: [
      { id: ids.first, idList: ids.list, name: 'First task', desc: 'Implement one step', closed: false },
      { id: ids.second, idList: ids.list, name: 'Second task', desc: 'Verify the result', closed: false },
      { id: ids.archived, idList: ids.list, name: 'Old task', desc: '', closed: true },
    ],
    actions: [{ data: { text: 'Private comment must not be imported' } }],
    ...extra,
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-trello-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  return { store, path, project, column };
}

describe('local Trello board import', () => {
  it('previews without writing, then imports selected cards once even across restart and changed export order', () => {
    const { store, path, project, column } = fixture();
    const json = board();
    const preview = store.previewTrelloImport({ projectId: project.id, json });
    expect(preview).toMatchObject({ boardName: 'Synthetic board', total: 3, eligible: 3, duplicates: 0 });
    expect(preview.cards[0]).toMatchObject({ listName: 'Backlog', archived: false, importedCardId: null });
    expect(preview.cards[2]?.archived).toBe(true);
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    const accepted = store.acceptTrelloImport({ projectId: project.id, columnId: column.id, json, fingerprint: preview.fingerprint, sourceIds: [ids.first, ids.second] });
    expect(accepted.created.map((item) => item.title)).toEqual(['First task', 'Second task']);
    expect(accepted.skippedDuplicateIds).toEqual([]);
    expect(store.snapshot(project.id).cards[0]?.description).toBe('Implement one step');
    expect(JSON.stringify(store.snapshot(project.id))).not.toContain('Private comment');
    store.close();

    const reopened = new StudioStore(path);
    const reordered = [...(JSON.parse(json) as { cards: Array<{ id: string; desc: string }> }).cards].reverse();
    reordered.find((item) => item.id === ids.first)!.desc = 'Edited in Trello later';
    const reexport = JSON.stringify({ ...JSON.parse(json), cards: reordered, actions: [] });
    const nextPreview = reopened.previewTrelloImport({ projectId: project.id, json: reexport });
    expect(nextPreview).toMatchObject({ total: 3, eligible: 1, duplicates: 2 });
    const repeated = reopened.acceptTrelloImport({ projectId: project.id, columnId: column.id, json: reexport, fingerprint: nextPreview.fingerprint, sourceIds: [ids.first, ids.archived] });
    expect(repeated.skippedDuplicateIds).toEqual([ids.first]);
    expect(repeated.created.map((item) => item.title)).toEqual(['Old task']);
    expect(repeated.created[0]?.archivedAt).toBeTruthy();
    expect(reopened.snapshot(project.id).cards).toHaveLength(3);
    expect(reopened.card(accepted.created[0]!.id).description).toBe('Implement one step');
    reopened.close();
  });

  it('does not start an agent when importing into an auto-start column', () => {
    const { store, project } = fixture();
    const agent = store.agents()[0]!;
    const autoColumn = store.createColumn({ projectId: project.id, name: 'Automatic', autoStart: true, agentId: agent.id });
    const json = board();
    const preview = store.previewTrelloImport({ projectId: project.id, json });
    store.acceptTrelloImport({ projectId: project.id, columnId: autoColumn.id, json, fingerprint: preview.fingerprint, sourceIds: [ids.first] });
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    expect(store.snapshot(project.id).cards[0]?.columnId).toBe(autoColumn.id);
    store.close();
  });

  it('rejects a modified export, a foreign column and bad selections without partial cards', () => {
    const { store, project, column } = fixture();
    const otherRoot = mkdtempSync(join(tmpdir(), 'jarvis-studio-other-'));
    roots.push(otherRoot);
    const other = store.createProject({ name: 'Other', path: otherRoot });
    const foreignColumn = store.snapshot(other.id).columns[0]!;
    const json = board();
    const fingerprint = store.previewTrelloImport({ projectId: project.id, json }).fingerprint;
    const input = { projectId: project.id, columnId: column.id, json, fingerprint, sourceIds: [ids.first] };
    expect(() => store.acceptTrelloImport({ ...input, json: board({ name: 'Changed board' }) })).toThrow('geändert');
    expect(() => store.acceptTrelloImport({ ...input, columnId: foreignColumn.id })).toThrow('anderen Projekt');
    expect(() => store.acceptTrelloImport({ ...input, sourceIds: [ids.first, 'ffffffffffffffffffffffff'] })).toThrow('nicht importiert');
    expect(() => store.acceptTrelloImport({ ...input, sourceIds: [ids.first, ids.first] })).toThrow('einmalig');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();
  });

  it('rejects malformed exports and marks oversized card content ineligible', () => {
    expect(() => parseTrelloBoard('{')).toThrow('gültiges JSON');
    expect(() => parseTrelloBoard(JSON.stringify({ cards: [], lists: [] }).repeat(9 * 1024 * 1024))).toThrow('8 MiB');
    expect(() => parseTrelloBoard(JSON.stringify({ cards: [], actions: [] }))).toThrow('cards und lists');
    const duplicate = JSON.parse(board()) as { cards: Array<{ id: string }> };
    duplicate.cards[1]!.id = ids.first;
    expect(() => parseTrelloBoard(JSON.stringify(duplicate))).toThrow('mehrfach');
    const invalid = JSON.parse(board()) as { cards: Array<{ id: string; name: string; desc: string }> };
    invalid.cards[0]!.name = 'x'.repeat(201);
    invalid.cards[1]!.desc = 'x'.repeat(30001);
    const parsed = parseTrelloBoard(JSON.stringify(invalid));
    expect(parsed.cards.slice(0, 2).map((item) => item.eligible)).toEqual([false, false]);
    const { store, project, column } = fixture();
    const json = JSON.stringify(invalid);
    const fingerprint = store.previewTrelloImport({ projectId: project.id, json }).fingerprint;
    expect(() => store.acceptTrelloImport({ projectId: project.id, columnId: column.id, json, fingerprint, sourceIds: [ids.archived, ids.first] })).toThrow('nicht importiert');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();
  });
});
