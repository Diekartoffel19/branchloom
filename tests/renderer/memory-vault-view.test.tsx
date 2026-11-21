import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemoryNote, ProjectSnapshot } from '../../src/shared/types';
import { MemoryView } from '../../src/renderer/components/MemoryView';

const note: MemoryNote = { id: 'note', projectId: 'project', title: 'Beispiel', body: 'Text', tags: [], links: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Test', path: 'C:\\synthetic', createdAt: '2026-01-01T00:00:00Z' },
  columns: [], cards: [], agents: [], sessions: [], workflows: [], notes: [note],
  queue: { projectId: 'project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

describe('Memory vault export entry point', () => {
  it('offers the explicit folder export only when the project has saved notes', () => {
    const mutate = async <T,>(action: () => Promise<T>): Promise<T> => action();
    const withNote = renderToStaticMarkup(createElement(MemoryView, { snapshot, mutate }));
    const withoutNote = renderToStaticMarkup(createElement(MemoryView, { snapshot: { ...snapshot, notes: [] }, mutate }));
    expect(withNote).toMatch(/Alle Notizen exportieren<\/button>/);
    expect(withoutNote).toMatch(/disabled=""[^>]*>.*Alle Notizen exportieren<\/button>/s);
  });
});
