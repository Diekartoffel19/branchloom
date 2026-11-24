import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { addCardContextReference, cardContextCandidateFromAttachment, cardContextReferences, checkedDocumentationUrl, previewCardContextReference, removeCardContextReference } from '../../src/main/card-context';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-context-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'guide.md'), '# Synthetic guide\nOnly local fixture content.');
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic context', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Context card' });
  const other = store.createCard({ projectId: project.id, columnId, title: 'Other card' });
  return { root, repo, file, store, project, card, other };
}

describe('explicit card context references', () => {
  it('prepares a card-owned project attachment without persisting until confirmation', () => {
    const { store, repo, root, card, other } = fixture();
    const inside = store.addCardAttachments(card.id, [join(repo, 'docs', 'guide.md')])[0]!;
    expect(cardContextCandidateFromAttachment(store, { cardId: card.id, attachmentId: inside.id })).toBe('docs/guide.md');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    expect(() => cardContextCandidateFromAttachment(store, { cardId: other.id, attachmentId: inside.id })).toThrow('gehört nicht');
    const outside = join(root, 'outside.md');
    writeFileSync(outside, 'outside');
    const outsideAttachment = store.addCardAttachments(card.id, [outside]).find((item) => item.name === 'outside.md')!;
    expect(() => cardContextCandidateFromAttachment(store, { cardId: card.id, attachmentId: outsideAttachment.id })).toThrow('außerhalb');
    const saved = addCardContextReference(store, { cardId: card.id, kind: 'file', target: 'docs/guide.md' });
    expect(saved[0]?.target).toBe('docs/guide.md');
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => cardContextCandidateFromAttachment(store, { cardId: card.id, attachmentId: inside.id })).toThrow('Archivierte');
    store.close();
  });

  it('rejects a stale attachment before converting it into a context draft', () => {
    const { store, repo, card } = fixture();
    const attachment = store.addCardAttachments(card.id, [join(repo, 'docs', 'guide.md')])[0]!;
    rmSync(join(repo, 'docs', 'guide.md'));
    expect(() => cardContextCandidateFromAttachment(store, { cardId: card.id, attachmentId: attachment.id })).toThrow('fehlt');
    expect(cardContextReferences(store, card.id)).toEqual([]);
    store.close();
  });

  it('saves a project file and public docs URL with scoped preview after restart', () => {
    const { store, file, card, other } = fixture();
    const refs = addCardContextReference(store, { cardId: card.id, kind: 'file', target: 'docs/guide.md' });
    expect(refs).toMatchObject([{ kind: 'file', target: 'docs/guide.md', available: true }]);
    const url = addCardContextReference(store, { cardId: card.id, kind: 'url', target: 'https://docs.example.org/guide#section' })[1]!;
    expect(url).toMatchObject({ kind: 'url', target: 'https://docs.example.org/guide#section' });
    expect(previewCardContextReference(store, { cardId: card.id, referenceId: refs[0]!.id }).text).toContain('Only local fixture content');
    expect(previewCardContextReference(store, { cardId: card.id, referenceId: url.id })).toMatchObject({ text: null, note: expect.stringContaining('nicht abgerufen') });
    expect(() => previewCardContextReference(store, { cardId: other.id, referenceId: refs[0]!.id })).toThrow('gehört nicht');
    store.close();
    const reopened = new StudioStore(file);
    expect(cardContextReferences(reopened, card.id)).toHaveLength(2);
    expect(cardContextReferences(reopened, other.id)).toEqual([]);
    reopened.close();
  });

  it('saves a project folder without reading files and rejects moved or linked folders', () => {
    const { store, repo, root, card } = fixture();
    const [folder] = addCardContextReference(store, { cardId: card.id, kind: 'folder', target: 'docs' });
    expect(folder).toMatchObject({ kind: 'folder', target: 'docs', available: true });
    expect(previewCardContextReference(store, { cardId: card.id, referenceId: folder!.id })).toMatchObject({ text: null, note: expect.stringContaining('nicht gelesen') });
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'folder', target: 'docs/guide.md' })).toThrow('echter Ordner');
    const outside = join(root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, join(repo, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'folder', target: 'escape' })).toThrow('Pfadverknüpfung');
    symlinkSync(join(repo, 'docs'), join(repo, 'docs-link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'folder', target: 'docs-link' })).toThrow('Pfadverknüpfung');
    mkdirSync(join(repo, 'docs', 'nested'));
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'folder', target: 'docs-link/nested' })).toThrow('Pfadverknüpfung');
    rmSync(join(repo, 'docs'), { recursive: true });
    expect(cardContextReferences(store, card.id)[0]?.available).toBe(false);
    expect(() => previewCardContextReference(store, { cardId: card.id, referenceId: folder!.id })).toThrow('nicht gefunden');
    store.close();
  });

  it('rejects path escape, absolute path, missing files and invalid URLs without saving', () => {
    const { store, root, card } = fixture();
    writeFileSync(join(root, 'outside.md'), 'private outside');
    for (const target of ['../outside.md', join(root, 'outside.md'), 'docs/missing.md', 'docs/guide.md\n']) {
      expect(() => addCardContextReference(store, { cardId: card.id, kind: 'file', target })).toThrow();
    }
    for (const target of ['http://docs.example.org/guide', 'https://user:pass@docs.example.org/', 'https://127.0.0.1/x', 'https://localhost/x', 'https://intranet.local/x', 'https://intranet.local./x', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(() => checkedDocumentationUrl(target)).toThrow();
    }
    expect(cardContextReferences(store, card.id)).toEqual([]);
    store.close();
  });

  it('bounds text preview and detects changed or missing project files', () => {
    const { store, repo, card } = fixture();
    writeFileSync(join(repo, 'docs', 'long.md'), 'A'.repeat(10_000));
    const long = addCardContextReference(store, { cardId: card.id, kind: 'file', target: 'docs/long.md' })[0]!;
    const preview = previewCardContextReference(store, { cardId: card.id, referenceId: long.id });
    expect(preview.text).toHaveLength(4_096);
    expect(preview.truncated).toBe(true);
    writeFileSync(join(repo, 'docs', 'long.md'), 'B'.repeat(128_001));
    expect(() => previewCardContextReference(store, { cardId: card.id, referenceId: long.id })).toThrow('größer');
    rmSync(join(repo, 'docs', 'long.md'));
    expect(cardContextReferences(store, card.id)[0]?.available).toBe(false);
    expect(() => previewCardContextReference(store, { cardId: card.id, referenceId: long.id })).toThrow('nicht gefunden');
    store.close();
  });

  it('prevents duplicates and cross-card deletion, and keeps archived cards read-only', () => {
    const { store, card, other } = fixture();
    const ref = addCardContextReference(store, { cardId: card.id, kind: 'file', target: 'docs/guide.md' })[0]!;
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'file', target: 'docs/guide.md' })).toThrow('bereits');
    expect(() => removeCardContextReference(store, { cardId: other.id, referenceId: ref.id })).toThrow('gehört nicht');
    store.setCardArchived({ id: card.id, archived: true });
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'url', target: 'https://docs.example.org/' })).toThrow('Archivierte');
    expect(() => removeCardContextReference(store, { cardId: card.id, referenceId: ref.id })).toThrow('Archivierte');
    store.setCardArchived({ id: card.id, archived: false });
    expect(removeCardContextReference(store, { cardId: card.id, referenceId: ref.id })).toEqual([]);
    store.close();
  });

  it('limits each card to twenty references', () => {
    const { store, card } = fixture();
    for (let index = 0; index < 20; index++) addCardContextReference(store, { cardId: card.id, kind: 'url', target: `https://docs.example.org/page/${index}` });
    expect(cardContextReferences(store, card.id)).toHaveLength(20);
    expect(() => addCardContextReference(store, { cardId: card.id, kind: 'url', target: 'https://docs.example.org/page/20' })).toThrow('Maximal 20');
    store.close();
  });
});
