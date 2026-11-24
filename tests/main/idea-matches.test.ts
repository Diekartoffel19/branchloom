import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { convertIdeaToCard, listIdeas, saveIdea } from '../../src/main/ideas';
import { linkIdeaMatch, previewIdeaMatches, titleMatch, unlinkIdeaMatch } from '../../src/main/idea-matches';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch { /* already closed */ } } for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-match-test-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const otherRoot = mkdtempSync(join(tmpdir(), 'branchloom-match-other-'));
  roots.push(otherRoot);
  const other = store.createProject({ name: 'Other', path: otherRoot });
  return { file, store, project, other };
}

function idea(store: StudioStore, projectId: string, title: string, body = '') {
  return saveIdea(store, { projectId, title, body, category: 'idea', turns: [] });
}

describe('local idea duplicate suggestions', () => {
  it('uses conservative title words without model calls or fuzzy false positives', () => {
    expect(titleMatch('Visueller Diff für Reviews', 'Reviews mit visuellem Diff')).toMatchObject({ reason: '2 gemeinsame Titelbegriffe' });
    expect(titleMatch('Kalender', 'Kalender')).toMatchObject({ reason: 'Gleicher Titel' });
    expect(titleMatch('Gmail öffnen', 'Kalender öffnen')).toBeNull();
    expect(titleMatch('Licht Sensor Zuhause', 'Licht Farbe Büro')).toBeNull();
  });

  it('compares local ideas, imported Trello ideas and board cards, then links only after confirmation', () => {
    const { file, store, project, other } = fixture();
    const target = idea(store, project.id, 'Visueller Diff für Reviews', 'Screenshots nebeneinander.');
    const similar = idea(store, project.id, 'Reviews mit visuellem Diff', 'Bildvergleich bei Review.');
    store.db.prepare('INSERT INTO trello_idea_imports (project_id, source_id, idea_id, imported_at, source_title, source_body) VALUES (?, ?, ?, ?, ?, ?)')
      .run(project.id, 'synthetic-trello-id', similar.id, new Date().toISOString(), similar.title, similar.body);
    const column = store.snapshot(project.id).columns[0]!;
    const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Visueller Diff Reviews', description: 'Board-Notiz.' });
    const foreign = idea(store, other.id, 'Visueller Diff für Reviews');
    const before = previewIdeaMatches(store, { projectId: project.id, ideaId: target.id });
    expect(before.candidates.map((item) => item.id)).toContain(similar.id);
    expect(before.candidates.map((item) => item.id)).toContain(card.id);
    expect(before.candidates.map((item) => item.id)).not.toContain(foreign.id);
    expect(before.candidates.find((item) => item.id === similar.id)?.origin).toBe('Trello → Ideenraum');
    expect(before.links).toEqual([]);
    expect(listIdeas(store, project.id).find((item) => item.id === similar.id)?.mergedIntoIdeaId).toBeNull();
    const candidate = before.candidates.find((item) => item.id === similar.id)!;
    const linked = linkIdeaMatch(store, { projectId: project.id, ideaId: target.id, kind: 'idea', sourceId: similar.id, expectedSignature: candidate.signature });
    expect(linked.links).toMatchObject([{ kind: 'idea', id: similar.id, available: true }]);
    expect(linked.candidates.map((item) => item.id)).not.toContain(similar.id);
    expect(listIdeas(store, project.id).find((item) => item.id === similar.id)?.mergedIntoIdeaId).toBe(target.id);
    expect(() => convertIdeaToCard(store, { projectId: project.id, ideaId: similar.id, columnId: column.id })).toThrow('Hauptidee');
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    store.close();
    const reopened = new StudioStore(file);
    stores.push(reopened);
    expect(previewIdeaMatches(reopened, { projectId: project.id, ideaId: target.id }).links[0]?.id).toBe(similar.id);
    unlinkIdeaMatch(reopened, { projectId: project.id, ideaId: target.id, kind: 'idea', sourceId: similar.id });
    expect(listIdeas(reopened, project.id).find((item) => item.id === similar.id)?.mergedIntoIdeaId).toBeNull();
    reopened.close();
  });

  it('rejects stale previews, foreign sources and duplicate claims while leaving original data intact', () => {
    const { store, project, other } = fixture();
    const target = idea(store, project.id, 'Window Design Editor', 'First note.');
    const source = idea(store, project.id, 'Design Editor Window', 'Original note.');
    const next = idea(store, project.id, 'Window Editor Design', 'Third note.');
    const foreign = idea(store, other.id, 'Window Design Editor');
    const candidate = previewIdeaMatches(store, { projectId: project.id, ideaId: target.id }).candidates.find((item) => item.id === source.id)!;
    saveIdea(store, { projectId: project.id, id: source.id, title: source.title, body: 'Changed note.', category: source.category, turns: [] });
    expect(() => linkIdeaMatch(store, { projectId: project.id, ideaId: target.id, kind: 'idea', sourceId: source.id, expectedSignature: candidate.signature })).toThrow('geändert');
    expect(() => linkIdeaMatch(store, { projectId: project.id, ideaId: target.id, kind: 'idea', sourceId: foreign.id, expectedSignature: candidate.signature })).toThrow('geändert');
    const refreshed = previewIdeaMatches(store, { projectId: project.id, ideaId: target.id });
    linkIdeaMatch(store, { projectId: project.id, ideaId: target.id, kind: 'idea', sourceId: source.id, expectedSignature: refreshed.candidates.find((item) => item.id === source.id)!.signature });
    expect(() => linkIdeaMatch(store, { projectId: project.id, ideaId: next.id, kind: 'idea', sourceId: source.id, expectedSignature: candidate.signature })).toThrow('geändert');
    expect(() => linkIdeaMatch(store, { projectId: project.id, ideaId: source.id, kind: 'idea', sourceId: target.id, expectedSignature: candidate.signature })).toThrow('geändert');
    expect(listIdeas(store, project.id).find((item) => item.id === source.id)?.body).toBe('Changed note.');
    expect(() => unlinkIdeaMatch(store, { projectId: other.id, ideaId: foreign.id, kind: 'idea', sourceId: source.id })).toThrow('nicht gefunden');
    store.close();
  });
});
