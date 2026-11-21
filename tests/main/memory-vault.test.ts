import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryNote } from '../../src/shared/types';
import { memoryMarkdownFileName, planMemoryVaultFiles } from '../../src/shared/memory-file';
import { exportMemoryVaultToDirectory } from '../../src/main/memory-vault';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function note(id: string, title: string): MemoryNote {
  return { id, projectId: 'project', title, body: `Text für ${title} und [[andere Notiz]]`, tags: ['Beispiel'], links: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

describe('explicit Memory vault export', () => {
  it('plans distinct Windows-safe filenames, even for case collisions and reserved names', () => {
    const files = planMemoryVaultFiles([note('1', 'Idee'), note('2', 'idee'), note('3', 'CON.txt'), note('4', '../Idee')]);
    expect(files.map((file) => file.name.toLowerCase()).length).toBe(new Set(files.map((file) => file.name.toLowerCase())).size);
    expect(files.some((file) => /^idee \(2\)\.md$/i.test(file.name))).toBe(true);
    expect(memoryMarkdownFileName('CON.txt')).toBe('Notiz.md');
    expect(files.every((file) => !file.name.includes('/') && !file.name.includes('\\'))).toBe(true);
  });

  it('creates a fresh subfolder and preserves existing files on repeated exports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-memory-vault-test-'));
    roots.push(root);
    writeFileSync(join(root, 'Idee.md'), 'existing private file');
    const notes = [note('1', 'Idee'), note('2', 'Idee')];
    const first = await exportMemoryVaultToDirectory(notes, root, 'Beispielprojekt');
    const second = await exportMemoryVaultToDirectory(notes, root, 'Beispielprojekt');
    expect(first.count).toBe(2);
    expect(first.directory).not.toBe(second.directory);
    expect(readFileSync(join(root, 'Idee.md'), 'utf8')).toBe('existing private file');
    expect(readdirSync(first.directory).sort()).toEqual(['Idee (2).md', 'Idee.md']);
    expect(readFileSync(join(first.directory, 'Idee.md'), 'utf8')).toContain('[[andere Notiz]]');
    expect(readFileSync(join(first.directory, 'Idee (2).md'), 'utf8')).toContain('tags: ["Beispiel"]');
  });

  it('rejects empty notes and a destination that is not a directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-memory-vault-test-'));
    roots.push(root);
    const file = join(root, 'file.txt');
    writeFileSync(file, 'leave alone');
    await expect(exportMemoryVaultToDirectory([], root, 'Project')).rejects.toThrow('keine Memory-Notizen');
    await expect(exportMemoryVaultToDirectory([note('1', 'Safe')], file, 'Project')).rejects.toThrow('kein Ordner');
    expect(readFileSync(file, 'utf8')).toBe('leave alone');
  });
});
