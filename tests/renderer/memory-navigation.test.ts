import { describe, expect, it } from 'vitest';
import type { MemoryNote } from '../../src/shared/types';
import { emptyNoteNavigation, filterMemoryNotes, nextMemoryNote, openMemoryNote, previousMemoryNote } from '../../src/renderer/memory-navigation';

const note = (id: string, title: string, tags: string[], body = ''): MemoryNote => ({
  id, projectId: 'project', title, tags, body, links: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

describe('Memory navigation', () => {
  it('moves backward and forward through selected wiki links without duplicating the current note', () => {
    const first = openMemoryNote(emptyNoteNavigation(), 'a');
    const second = openMemoryNote(first, 'b');
    expect(openMemoryNote(second, 'b')).toBe(second);
    expect(previousMemoryNote(second)).toEqual({ currentId: 'a', back: [], forward: ['b'] });
    expect(nextMemoryNote(previousMemoryNote(second))).toEqual(second);
    expect(openMemoryNote(previousMemoryNote(second), 'c')).toEqual({ currentId: 'c', back: ['a'], forward: [] });
  });

  it('filters notes by exact tag and text without changing the source list', () => {
    const notes = [note('a', 'Plan', ['Projekt'], 'Deadline'), note('b', 'Brief', ['Idee'], 'Entwurf'), note('c', 'Review', ['Projekt'], 'Fertig')];
    expect(filterMemoryNotes(notes, '', 'projekt').map((item) => item.id)).toEqual(['a', 'c']);
    expect(filterMemoryNotes(notes, 'deadLINE', 'PROJEKT').map((item) => item.id)).toEqual(['a']);
    expect(filterMemoryNotes(notes, 'Entwurf', 'Projekt')).toEqual([]);
    expect(notes).toHaveLength(3);
  });
});
