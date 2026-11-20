import type { MemoryNote } from '../shared/types';

export interface NoteNavigation { currentId: string | null; back: string[]; forward: string[] }
export const emptyNoteNavigation = (): NoteNavigation => ({ currentId: null, back: [], forward: [] });

export function openMemoryNote(state: NoteNavigation, id: string): NoteNavigation {
  if (state.currentId === id) return state;
  return { currentId: id, back: state.currentId ? [...state.back, state.currentId] : state.back, forward: [] };
}

export function previousMemoryNote(state: NoteNavigation): NoteNavigation {
  if (!state.back.length) return state;
  const id = state.back[state.back.length - 1]!;
  return { currentId: id, back: state.back.slice(0, -1), forward: state.currentId ? [state.currentId, ...state.forward] : state.forward };
}

export function nextMemoryNote(state: NoteNavigation): NoteNavigation {
  if (!state.forward.length) return state;
  const id = state.forward[0]!;
  return { currentId: id, back: state.currentId ? [...state.back, state.currentId] : state.back, forward: state.forward.slice(1) };
}

export function filterMemoryNotes(notes: MemoryNote[], query: string, tag: string): MemoryNote[] {
  const needle = query.trim().toLocaleLowerCase('de-DE');
  const wantedTag = tag.toLocaleLowerCase('de-DE');
  return notes.filter((note) =>
    (!wantedTag || note.tags.some((item) => item.toLocaleLowerCase('de-DE') === wantedTag))
    && (!needle || `${note.title} ${note.body} ${note.tags.join(' ')}`.toLocaleLowerCase('de-DE').includes(needle)));
}
