import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('electron', () => ({ WebContentsView: class {} }));

import { StudioStore } from '../../src/main/store';
import { saveDesignSelection } from '../../src/main/design-inspection';
import { addCardContextReference, addCardContextReferenceFromDesignSelection, cardContextCandidateFromDesignSelection, cardContextReferences, previewCardContextReference } from '../../src/main/card-context';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-design-context-')); roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic Design Context', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Review button' });
  const selection = saveDesignSelection(store, project.id, 'http://127.0.0.1:5173/page?token=synthetic', {
    selector: 'button#save', tag: 'button', text: 'Save draft', styles: { color: 'rgb(20, 30, 40)' }, tokens: [{ name: '--ink', value: '#141e28' }],
  });
  return { root, repo, file, store, project, card, selection };
}

describe('saved Design Inspector evidence as card context', () => {
  it('prepares without writing, then confirms a bounded note and keeps the reference after restart', () => {
    const { file, store, card, selection } = fixture();
    const candidate = cardContextCandidateFromDesignSelection(store, { cardId: card.id, selectionId: selection.id });
    expect(candidate).toMatchObject({ selectionId: selection.id, label: 'button · button#save', sourceUrl: 'http://127.0.0.1:5173/page' });
    expect(candidate.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(cardContextReferences(store, card.id)).toEqual([]);
    const [saved] = addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: '  Make the action easier to find  ' });
    expect(saved).toMatchObject({ kind: 'design', target: selection.id, note: 'Make the action easier to find', label: candidate.label, available: true });
    expect(store.snapshot(card.projectId).sessions).toHaveLength(0);
    const preview = previewCardContextReference(store, { cardId: card.id, referenceId: saved!.id });
    expect(preview).toMatchObject({ kind: 'design', text: expect.stringContaining('Auftrag: Make the action easier to find'), note: expect.stringContaining('nicht neu geladen') });
    expect(JSON.stringify(preview)).not.toContain('token=synthetic');
    expect(() => addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: '' })).toThrow('bereits');
    store.close();
    const reopened = new StudioStore(file);
    expect(cardContextReferences(reopened, card.id)).toMatchObject([{ kind: 'design', note: 'Make the action easier to find', available: true }]);
    reopened.close();
  });

  it('rejects foreign, changed, removed and archived evidence before confirmation', () => {
    const { store, root, card, selection } = fixture();
    const candidate = cardContextCandidateFromDesignSelection(store, { cardId: card.id, selectionId: selection.id });
    const otherRepo = join(root, 'other'); mkdirSync(otherRepo);
    const other = store.createProject({ name: 'Other', path: otherRepo });
    const otherCard = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Foreign' });
    expect(() => cardContextCandidateFromDesignSelection(store, { cardId: otherCard.id, selectionId: selection.id })).toThrow('anderen Projekt');
    store.db.prepare('UPDATE design_selections SET selector = ? WHERE id = ?').run('button#changed', selection.id);
    expect(() => addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: '' })).toThrow('geändert');
    store.db.prepare('DELETE FROM design_selections WHERE id = ?').run(selection.id);
    expect(() => addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: '' })).toThrow('entfernt');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    const latest = saveDesignSelection(store, card.projectId, 'http://localhost:5173/', { selector: 'main', tag: 'main', text: '', styles: {}, tokens: [] });
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => cardContextCandidateFromDesignSelection(store, { cardId: card.id, selectionId: latest.id })).toThrow('Archivierte');
    store.close();
  });

  it('limits the note and disallows generic design IDs without source confirmation', () => {
    const { store, card, selection } = fixture();
    const candidate = cardContextCandidateFromDesignSelection(store, { cardId: card.id, selectionId: selection.id });
    expect(() => addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: 'x'.repeat(301) })).toThrow('300');
    expect(() => addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: 'line\nbreak' })).toThrow('Steuerzeichen');
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'design', target: selection.id })).toThrow('Kontexttyp');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    store.close();
  });

  it('marks pruned design evidence unavailable and migrates context tables without the note column', () => {
    const { file, store, card, selection } = fixture();
    const candidate = cardContextCandidateFromDesignSelection(store, { cardId: card.id, selectionId: selection.id });
    const [reference] = addCardContextReferenceFromDesignSelection(store, { cardId: card.id, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, note: '' });
    store.db.prepare('DELETE FROM design_selections WHERE id = ?').run(selection.id);
    expect(cardContextReferences(store, card.id)).toMatchObject([{ kind: 'design', available: false }]);
    expect(() => previewCardContextReference(store, { cardId: card.id, referenceId: reference!.id })).toThrow('entfernt');
    store.close();
    const previousSchema = new Database(file);
    previousSchema.exec('ALTER TABLE card_context_refs DROP COLUMN note');
    previousSchema.close();
    const reopened = new StudioStore(file);
    expect(cardContextReferences(reopened, card.id)).toMatchObject([{ kind: 'design', available: false }]);
    reopened.close();
  });
});
