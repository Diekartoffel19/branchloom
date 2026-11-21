import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanMemoryVault } from '../../src/main/memory-vault-import';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-vault-import-test-'));
  roots.push(root);
  const vault = join(root, 'vault');
  const projectFolder = join(root, 'project');
  mkdirSync(vault); mkdirSync(projectFolder);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: projectFolder });
  return { root, vault, store, project };
}

describe('explicit Markdown vault import', () => {
  it('previews nested files, detects duplicate titles and preserves Wiki links on transactional import', () => {
    const { vault, store, project } = fixture();
    store.saveNote({ projectId: project.id, title: 'Bestehend', body: 'leave intact', tags: [], links: [] });
    mkdirSync(join(vault, 'nested'));
    writeFileSync(join(vault, 'A.md'), '# A\n\nSiehe [[B]] und [[Bestehend]].\n');
    writeFileSync(join(vault, 'nested', 'B.md'), '---\ntags: ["wissen"]\n---\n# B\n\nAntwort.\n');
    writeFileSync(join(vault, 'Bestehend.md'), '# Bestehend\n\noverwrite attempt');
    const preview = scanMemoryVault(vault, ['Bestehend']);
    expect(preview.files).toHaveLength(3);
    expect(preview.files.find((file) => file.key === 'Bestehend.md')).toMatchObject({ eligible: false });
    expect(preview.files.find((file) => file.key === 'nested/B.md')).toMatchObject({ title: 'B', tags: ['wissen'], eligible: true });
    expect(preview.files.every((file) => !file.key.startsWith(vault))).toBe(true);
    const selected = ['A.md', 'nested/B.md'].map((key) => preview.parsed.get(key)!);
    expect(store.importMemoryVaultNotes(project.id, selected)).toBe(2);
    const notes = store.snapshot(project.id).notes;
    const a = notes.find((note) => note.title === 'A')!;
    const b = notes.find((note) => note.title === 'B')!;
    const existing = notes.find((note) => note.title === 'Bestehend')!;
    expect(a.body).toContain('[[B]]');
    expect(a.links).toEqual(expect.arrayContaining([b.id, existing.id]));
    expect(existing.body).toBe('leave intact');
    expect(() => store.importMemoryVaultNotes(project.id, [{ title: 'C', body: '', tags: [] }, { title: 'A', body: '', tags: [] }])).toThrow('bereits vorhanden');
    expect(store.snapshot(project.id).notes).toHaveLength(3);
    store.close();
  });

  it('marks oversized files ineligible and detects changed content', () => {
    const { vault, store } = fixture();
    writeFileSync(join(vault, 'ok.md'), '# Okay\n\nFirst');
    writeFileSync(join(vault, 'large.md'), 'a'.repeat(500_001));
    const first = scanMemoryVault(vault, []);
    expect(first.files.find((file) => file.key === 'large.md')).toMatchObject({ eligible: false, reason: 'Datei größer als 500 KB' });
    writeFileSync(join(vault, 'ok.md'), '# Okay\n\nSecond');
    expect(scanMemoryVault(vault, []).fingerprint).not.toBe(first.fingerprint);
    store.close();
  });

  it('limits file count and does not traverse external symlinks', () => {
    const { root, vault, store } = fixture();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.md'), '# Secret');
    try { symlinkSync(outside, join(vault, 'linked'), 'junction'); } catch { /* Symlink privilege varies on Windows. */ }
    expect(scanMemoryVault(vault, []).files).toEqual([]);
    for (let number = 0; number <= 200; number += 1) writeFileSync(join(vault, `n${number}.md`), '# Sample');
    expect(() => scanMemoryVault(vault, [])).toThrow('mehr als 200');
    store.close();
  });
});
