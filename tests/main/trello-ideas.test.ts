import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { acceptTrelloIdeas, applyTrelloIdeaSource, compareTrelloIdea, previewTrelloIdeas } from '../../src/main/trello-ideas';
import { convertIdeaToCard, listIdeas, saveIdea } from '../../src/main/ideas';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const first = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const second = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const list = 'cccccccccccccccccccccccc';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-trello-ideas-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  return { store, path, project, column };
}

function board(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'Synthetic ideas', lists: [{ id: list, name: 'Maybe later' }], cards: [
    { id: first, idList: list, name: 'Navigation prüfen', desc: 'Neue Navigation testen', closed: false, labels: [{ id: 'dddddddddddddddddddddddd', name: 'UX' }] },
    { id: second, idList: list, name: 'Farben prüfen', desc: 'Kontrast messen', closed: false },
  ], ...extra });
}

describe('Trello ideas staging', () => {
  it('previews read-only, stages locally once, and creates a board card only on the separate conversion click', () => {
    const { store, path, project, column } = fixture();
    const json = board();
    const preview = previewTrelloIdeas(store, { projectId: project.id, json });
    expect(preview).toMatchObject({ total: 2, eligible: 2, duplicates: 0 });
    expect(listIdeas(store, project.id)).toEqual([]);
    expect(store.snapshot(project.id).cards).toEqual([]);
    const accepted = acceptTrelloIdeas(store, { projectId: project.id, json, fingerprint: preview.fingerprint, sourceIds: [first], category: 'backlog' });
    expect(accepted.created).toHaveLength(1);
    expect(accepted.created[0]).toMatchObject({ title: 'Navigation prüfen', category: 'backlog', cardId: null });
    expect(accepted.created[0]?.body).toContain('Trello-Liste: Maybe later');
    expect(accepted.created[0]?.body).toContain('Trello-Labels: UX');
    expect(store.snapshot(project.id).cards).toEqual([]);
    expect(store.snapshot(project.id).sessions).toEqual([]);
    store.close();

    const reopened = new StudioStore(path);
    expect(listIdeas(reopened, project.id)).toHaveLength(1);
    expect(previewTrelloIdeas(reopened, { projectId: project.id, json })).toMatchObject({ eligible: 1, duplicates: 1 });
    expect(reopened.previewTrelloImport({ projectId: project.id, json })).toMatchObject({ eligible: 1, duplicates: 1 });
    expect(acceptTrelloIdeas(reopened, { projectId: project.id, json, fingerprint: preview.fingerprint, sourceIds: [first], category: 'backlog' }).skippedDuplicateIds).toEqual([first]);
    const card = convertIdeaToCard(reopened, { projectId: project.id, ideaId: accepted.created[0]!.id, columnId: column.id });
    expect(card.title).toBe('Navigation prüfen');
    expect(convertIdeaToCard(reopened, { projectId: project.id, ideaId: accepted.created[0]!.id, columnId: column.id }).id).toBe(card.id);
    expect(reopened.acceptTrelloImport({ projectId: project.id, columnId: column.id, json, fingerprint: preview.fingerprint, sourceIds: [first] }).skippedDuplicateIds).toEqual([first]);
    expect(reopened.snapshot(project.id).cards).toHaveLength(1);
    reopened.close();
  });

  it('rejects stale data, invalid cards and foreign projects without partially staging', () => {
    const { store, project } = fixture();
    const otherRoot = mkdtempSync(join(tmpdir(), 'branchloom-trello-ideas-other-'));
    roots.push(otherRoot);
    const other = store.createProject({ name: 'Other', path: otherRoot });
    const invalid = board({ cards: [
      { id: first, idList: list, name: 'Valid', desc: '' },
      { id: second, idList: list, name: 'x'.repeat(161), desc: '' },
    ] });
    const preview = previewTrelloIdeas(store, { projectId: project.id, json: invalid });
    expect(preview.cards[1]).toMatchObject({ eligible: false });
    const input = { projectId: project.id, json: invalid, fingerprint: preview.fingerprint, sourceIds: [first], category: 'idea' as const };
    expect(() => acceptTrelloIdeas(store, { ...input, json: board() })).toThrow('geändert');
    expect(() => acceptTrelloIdeas(store, { ...input, sourceIds: [first, second] })).toThrow('nicht als Idee');
    expect(() => acceptTrelloIdeas(store, { ...input, sourceIds: [first, first] })).toThrow('einmalig');
    expect(() => acceptTrelloIdeas(store, { ...input, category: 'other' as 'idea' })).toThrow('Ideenbereich');
    expect(() => previewTrelloIdeas(store, { projectId: 'nonexistent', json: invalid })).toThrow();
    expect(listIdeas(store, project.id)).toEqual([]);
    expect(listIdeas(store, other.id)).toEqual([]);
    store.close();
  });

  it('does not duplicate an already imported board card, while project mappings stay separate', () => {
    const { store, project, column } = fixture();
    const root = mkdtempSync(join(tmpdir(), 'branchloom-trello-ideas-second-'));
    roots.push(root);
    const other = store.createProject({ name: 'Other', path: root });
    const json = board();
    const preview = store.previewTrelloImport({ projectId: project.id, json });
    store.acceptTrelloImport({ projectId: project.id, columnId: column.id, json, fingerprint: preview.fingerprint, sourceIds: [first] });
    expect(previewTrelloIdeas(store, { projectId: project.id, json })).toMatchObject({ eligible: 1, duplicates: 1 });
    expect(acceptTrelloIdeas(store, { projectId: project.id, json, fingerprint: preview.fingerprint, sourceIds: [first], category: 'idea' }).skippedDuplicateIds).toEqual([first]);
    expect(previewTrelloIdeas(store, { projectId: other.id, json })).toMatchObject({ eligible: 2, duplicates: 0 });
    expect(listIdeas(store, project.id)).toEqual([]);
    store.close();
  });

  it('shows source and local changes, copies only chosen fields, and leaves a converted board card untouched', () => {
    const { store, project, column } = fixture();
    const original = board();
    const firstPreview = previewTrelloIdeas(store, { projectId: project.id, json: original });
    const imported = acceptTrelloIdeas(store, { projectId: project.id, json: original, fingerprint: firstPreview.fingerprint, sourceIds: [first], category: 'backlog' }).created[0]!;
    const card = convertIdeaToCard(store, { projectId: project.id, ideaId: imported.id, columnId: column.id });
    saveIdea(store, { projectId: project.id, id: imported.id, title: 'Eigener Titel', body: 'Eigene Notizen', category: 'roadmap', turns: [] });
    const changed = board({ cards: [
      { id: first, idList: list, name: 'Navigation neu prüfen', desc: 'Neue Trello-Anforderung', closed: false, labels: [{ id: 'dddddddddddddddddddddddd', name: 'UX' }] },
      { id: second, idList: list, name: 'Farben prüfen', desc: 'Kontrast messen', closed: false },
    ] });
    expect(previewTrelloIdeas(store, { projectId: project.id, json: changed }).cards[0]?.sourceChange).toBe('changed');
    const comparison = compareTrelloIdea(store, { projectId: project.id, json: changed, sourceId: first });
    expect(comparison).toMatchObject({ sourceChange: 'changed', localChange: 'changed', localTitle: 'Eigener Titel', ideaCardId: card.id });
    const titleOnly = applyTrelloIdeaSource(store, { projectId: project.id, json: changed, sourceId: first,
      fingerprint: comparison.fingerprint, localSignature: comparison.localSignature, copyTitle: true, copyBody: false });
    expect(titleOnly).toMatchObject({ localTitle: 'Navigation neu prüfen', localBody: 'Eigene Notizen', sourceChange: 'changed' });
    const completed = applyTrelloIdeaSource(store, { projectId: project.id, json: changed, sourceId: first,
      fingerprint: titleOnly.fingerprint, localSignature: titleOnly.localSignature, copyTitle: false, copyBody: true });
    expect(completed).toMatchObject({ sourceChange: 'same', localChange: 'same' });
    expect(completed.localBody).toContain('Neue Trello-Anforderung');
    expect(store.card(card.id).title).toBe('Navigation prüfen');
    expect(listIdeas(store, project.id)[0]).toMatchObject({ category: 'roadmap', cardId: card.id });
    store.close();
  });

  it('rejects stale source or local revisions and treats legacy source snapshots as unknown', () => {
    const { store, project } = fixture();
    const original = board();
    const preview = previewTrelloIdeas(store, { projectId: project.id, json: original });
    const imported = acceptTrelloIdeas(store, { projectId: project.id, json: original, fingerprint: preview.fingerprint, sourceIds: [first], category: 'idea' }).created[0]!;
    const comparison = compareTrelloIdea(store, { projectId: project.id, json: original, sourceId: first });
    expect(comparison).toMatchObject({ sourceChange: 'same', localChange: 'same' });
    saveIdea(store, { projectId: project.id, id: imported.id, title: 'Lokale Bearbeitung', body: imported.body, category: 'idea', turns: [] });
    const input = { projectId: project.id, json: original, sourceId: first, fingerprint: comparison.fingerprint,
      localSignature: comparison.localSignature, copyTitle: true, copyBody: false };
    expect(() => applyTrelloIdeaSource(store, input)).toThrow('lokale Idee');
    expect(() => applyTrelloIdeaSource(store, { ...input, json: board({ name: 'Inzwischen geändert' }) })).toThrow('Trello-Board');
    expect(() => applyTrelloIdeaSource(store, { ...input, copyTitle: false })).toThrow('mindestens ein Feld');
    expect(listIdeas(store, project.id)[0]?.title).toBe('Lokale Bearbeitung');
    store.db.prepare('UPDATE trello_idea_imports SET source_title = NULL, source_body = NULL WHERE project_id = ? AND source_id = ?').run(project.id, first);
    expect(compareTrelloIdea(store, { projectId: project.id, json: original, sourceId: first })).toMatchObject({ sourceChange: 'unknown', localChange: 'unknown' });
    expect(() => compareTrelloIdea(store, { projectId: 'foreign', json: original, sourceId: first })).toThrow();
    store.close();
  });
});
