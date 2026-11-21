import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { canOpenAttachment, checkedAttachmentPath } from '../../src/main/card-attachments';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-attachments-'));
  roots.push(root);
  const database = join(root, 'studio.sqlite');
  const store = new StudioStore(database);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const todo = store.snapshot(project.id).columns[0]!;
  const card = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Card A' });
  const other = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Card B' });
  return { root, database, store, card, other };
}

describe('card file references', () => {
  it('persists metadata without copying content and removes only the reference', () => {
    const { root, database, store, card } = fixture();
    const file = join(root, 'notes.pdf');
    writeFileSync(file, 'synthetic pdf');
    const added = store.addCardAttachments(card.id, [file, file]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ cardId: card.id, name: 'notes.pdf', size: 13, available: true, canOpen: true });
    expect(added[0]).not.toHaveProperty('path');
    store.close();
    const reopened = new StudioStore(database);
    expect(reopened.cardAttachments(card.id)).toMatchObject([{ id: added[0]!.id, available: true }]);
    reopened.removeCardAttachment({ cardId: card.id, attachmentId: added[0]!.id });
    expect(reopened.cardAttachments(card.id)).toEqual([]);
    expect(existsSync(file)).toBe(true);
    reopened.close();
  });

  it('rejects cross-card access and stale files', () => {
    const { root, store, card, other } = fixture();
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'synthetic');
    const added = store.addCardAttachments(card.id, [file])[0]!;
    expect(() => store.attachmentPathForCard({ cardId: other.id, attachmentId: added.id })).toThrow('gehört nicht');
    expect(() => store.removeCardAttachment({ cardId: other.id, attachmentId: added.id })).toThrow('gehört nicht');
    rmSync(file);
    expect(store.cardAttachments(card.id)[0]?.available).toBe(false);
    expect(() => store.attachmentPathForCard({ cardId: card.id, attachmentId: added.id })).toThrow('fehlt');
    store.close();
  });

  it('limits count, validates paths, and never opens executable formats', () => {
    const { root, store, card } = fixture();
    const files = Array.from({ length: 21 }, (_, index) => join(root, `file-${index}.txt`));
    for (const file of files) writeFileSync(file, 'x');
    expect(() => store.addCardAttachments(card.id, files)).toThrow('höchstens 20');
    expect(store.cardAttachments(card.id)).toEqual([]);
    expect(() => checkedAttachmentPath('relative.txt')).toThrow('absoluten');
    expect(() => checkedAttachmentPath(root)).toThrow('normale Datei');
    const script = join(root, 'run.cmd');
    writeFileSync(script, 'echo synthetic');
    const added = store.addCardAttachments(card.id, [script])[0]!;
    expect(added.canOpen).toBe(false);
    expect(canOpenAttachment('run.EXE')).toBe(false);
    expect(() => store.attachmentPathForCard({ cardId: card.id, attachmentId: added.id })).toThrow('Dateityp');
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => store.removeCardAttachment({ cardId: card.id, attachmentId: added.id })).toThrow('Archivierte');
    expect(() => store.addCardAttachments(card.id, [files[0]!])).toThrow('Archivierte');
    store.close();
  });
});
