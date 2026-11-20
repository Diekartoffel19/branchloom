import type { MemoryNote } from '../shared/types';

export interface GraphNode { id: string; title: string; x: number; y: number }
export interface GraphEdge { from: string; to: string }

/** Resolve stored ids and [[title]] references without guessing missing notes. */
export function noteEdges(notes: readonly MemoryNote[]): GraphEdge[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const byTitle = new Map(notes.map((note) => [note.title.trim().toLocaleLowerCase(), note.id]));
  const edges = new Set<string>();
  for (const note of notes) {
    const targets = new Set(note.links);
    for (const match of note.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const id = byTitle.get(match[1]!.trim().toLocaleLowerCase());
      if (id) targets.add(id);
    }
    for (const target of targets) {
      if (target !== note.id && byId.has(target)) edges.add(`${note.id}\u0000${target}`);
    }
  }
  return [...edges].map((entry) => {
    const [from, to] = entry.split('\u0000');
    return { from: from!, to: to! };
  });
}

/** Stable layout gives the graph a useful shape without a heavy graph package. */
export function layoutNotes(notes: readonly MemoryNote[], width = 640, height = 400): GraphNode[] {
  const centerX = width / 2;
  const centerY = height / 2;
  if (notes.length === 1) return [{ id: notes[0]!.id, title: notes[0]!.title, x: centerX, y: centerY }];
  const radius = Math.max(72, Math.min(width, height) * 0.35);
  return notes.map((note, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(notes.length, 1)) * Math.PI * 2;
    return { id: note.id, title: note.title, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
}

export function backlinks(notes: readonly MemoryNote[], targetId: string): MemoryNote[] {
  const sourceIds = new Set(noteEdges(notes).filter((edge) => edge.to === targetId).map((edge) => edge.from));
  return notes.filter((note) => sourceIds.has(note.id));
}

export function linkedIdsForBody(body: string, notes: readonly MemoryNote[]): string[] {
  const byTitle = new Map(notes.map((note) => [note.title.trim().toLocaleLowerCase(), note.id]));
  const ids = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const id = byTitle.get(match[1]!.trim().toLocaleLowerCase());
    if (id) ids.add(id);
  }
  return [...ids];
}
