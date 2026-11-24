import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { cardCriteria, createCardCriterion, deleteCardCriterion, linkCardCriterionEvidence, unlinkCardCriterionEvidence, updateCardCriterion } from '../../src/main/card-acceptance';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-criteria-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Navigation' });
  const other = store.createCard({ projectId: project.id, columnId: column.id, title: 'Other' });
  return { store, file, project, card, other };
}

function qa(store: StudioStore, projectId: string, cardId: string, id: string, status: string) {
  store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, viewport_width, viewport_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, cardId, projectId, 'http://127.0.0.1:5173/', '2026-11-24T10:00:00.000Z', '2026-11-24T10:01:00.000Z', status, '[]', 390, 844);
}

function review(store: StudioStore, cardId: string, id: string) {
  store.db.prepare(`INSERT INTO review_comments (id, card_id, fingerprint, file_path, side, line, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, cardId, 'synthetic-fingerprint', 'src/navigation.tsx', 'new', 12, 'Prüfe den mobilen Fokus.', '2026-11-24T10:02:00.000Z');
}

describe('card acceptance criteria', () => {
  it('persists criteria and distinct QA/review references, then shows a pruned report as missing', () => {
    const { store, file, project, card } = fixture();
    const created = createCardCriterion(store, { cardId: card.id, text: '  Navigation auf Mobile ist per Tastatur bedienbar.  ' });
    const id = created[0]!.id;
    expect(created[0]).toMatchObject({ text: 'Navigation auf Mobile ist per Tastatur bedienbar.', evidence: [] });
    qa(store, project.id, card.id, 'qa-one', 'failed');
    review(store, card.id, 'review-one');
    linkCardCriterionEvidence(store, { cardId: card.id, criterionId: id, kind: 'qa', sourceId: 'qa-one', note: '  Der Bericht zeigt den fehlenden Fokus.  ' });
    const linked = linkCardCriterionEvidence(store, { cardId: card.id, criterionId: id, kind: 'review', sourceId: 'review-one', note: 'Die Diff-Zeile benennt den Fokuspfad.' });
    expect(linked[0]?.evidence).toMatchObject([
      { kind: 'qa', sourceAvailable: true, sourceStatus: 'failed', note: 'Der Bericht zeigt den fehlenden Fokus.' },
      { kind: 'review', sourceAvailable: true, sourceStatus: 'review' },
    ]);
    store.close();
    const reopened = new StudioStore(file);
    expect(cardCriteria(reopened, card.id)[0]?.evidence).toHaveLength(2);
    reopened.db.prepare('DELETE FROM card_qa_reports WHERE id = ?').run('qa-one');
    expect(cardCriteria(reopened, card.id)[0]?.evidence[0]).toMatchObject({ sourceAvailable: false, sourceStatus: 'missing' });
    const evidenceId = cardCriteria(reopened, card.id)[0]!.evidence[0]!.id;
    expect(unlinkCardCriterionEvidence(reopened, { cardId: card.id, criterionId: id, evidenceId })[0]?.evidence).toHaveLength(1);
    expect(deleteCardCriterion(reopened, { cardId: card.id, criterionId: id })).toEqual([]);
    expect(reopened.db.prepare('SELECT COUNT(*) AS n FROM card_acceptance_evidence').get()).toMatchObject({ n: 0 });
    reopened.close();
  });

  it('rejects foreign card sources, duplicate links, invalid text and archived writes', () => {
    const { store, project, card, other } = fixture();
    qa(store, project.id, other.id, 'qa-other', 'passed');
    review(store, other.id, 'review-other');
    qa(store, project.id, card.id, 'qa-own', 'passed');
    const criterionId = createCardCriterion(store, { cardId: card.id, text: 'Mobile menu opens' })[0]!.id;
    const input = { cardId: card.id, criterionId, kind: 'qa' as const, sourceId: 'qa-other', note: 'Related report' };
    expect(() => linkCardCriterionEvidence(store, input)).toThrow('gehört nicht zu dieser Karte');
    expect(() => linkCardCriterionEvidence(store, { ...input, kind: 'review', sourceId: 'review-other' })).toThrow('gehört nicht zu dieser Karte');
    expect(() => linkCardCriterionEvidence(store, { ...input, sourceId: 'qa-own', note: '  ' })).toThrow('Einordnung');
    linkCardCriterionEvidence(store, { ...input, sourceId: 'qa-own' });
    expect(() => linkCardCriterionEvidence(store, { ...input, sourceId: 'qa-own' })).toThrow('bereits');
    expect(() => updateCardCriterion(store, { cardId: other.id, criterionId, text: 'Wrong' })).toThrow('nicht auf dieser Karte');
    expect(() => createCardCriterion(store, { cardId: card.id, text: ' '.repeat(5) })).toThrow('Abnahmekriterium');
    expect(() => updateCardCriterion(store, { cardId: card.id, criterionId, text: 'x'.repeat(501) })).toThrow('500');
    const revised = updateCardCriterion(store, { cardId: card.id, criterionId, text: 'Mobile menu closes with Escape' })[0];
    expect(revised?.text).toBe('Mobile menu closes with Escape');
    expect(revised?.evidence[0]).toMatchObject({ sourceAvailable: true, currentForCriterion: false });
    store.setCardArchived({ id: card.id, archived: true });
    expect(cardCriteria(store, card.id)).toHaveLength(1);
    expect(() => createCardCriterion(store, { cardId: card.id, text: 'Archived' })).toThrow('Archivierte');
    expect(() => deleteCardCriterion(store, { cardId: card.id, criterionId })).toThrow('Archivierte');
    store.close();
  });
});
