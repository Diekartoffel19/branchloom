import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createDiagnosticCard } from '../../src/main/error-catcher';
import type { BrowserDiagnostic } from '../../src/shared/types';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-error-catcher-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Preview', path: root });
  const columns = store.snapshot(project.id).columns;
  const diagnostic: BrowserDiagnostic = { id: 'synthetic', kind: 'console', message: 'TypeError: cannot read width', pageUrl: 'http://localhost:5173/page', sourceUrl: 'http://localhost:5173/src/app.ts', line: 28, capturedAt: '2026-11-23T12:00:00.000Z' };
  return { store, project, columns, diagnostic };
}

describe('explicit diagnostic card', () => {
  it('persists observed source and reproduction but starts no session', () => {
    const { store, project, columns, diagnostic } = fixture();
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    const card = createDiagnosticCard(store, { projectId: project.id, columnId: columns[0]!.id, reproduction: 'Open the page and resize.' }, diagnostic);
    expect(card.title).toContain('TypeError');
    expect(card.description).toContain('http://localhost:5173/src/app.ts:28');
    expect(card.description).toContain('Open the page and resize.');
    store.close();
    const reopened = new StudioStore(join(roots.at(-1)!, 'studio.sqlite'));
    expect(reopened.card(card.id).description).toBe(card.description);
    expect(reopened.snapshot(project.id).sessions).toHaveLength(0);
    reopened.close();
  });

  it('rejects foreign columns, a live To-do queue and excessive reproduction', () => {
    const { store, project, columns, diagnostic } = fixture();
    const otherRoot = mkdtempSync(join(tmpdir(), 'branchloom-other-preview-'));
    roots.push(otherRoot);
    const other = store.createProject({ name: 'Other', path: otherRoot });
    expect(() => createDiagnosticCard(store, { projectId: project.id, columnId: store.snapshot(other.id).columns[0]!.id, reproduction: '' }, diagnostic)).toThrow('anderen Projekt');
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => createDiagnosticCard(store, { projectId: project.id, columnId: columns[0]!.id, reproduction: '' }, diagnostic)).toThrow('Warteschlange');
    expect(() => createDiagnosticCard(store, { projectId: project.id, columnId: columns[1]!.id, reproduction: 'x'.repeat(2_001) }, diagnostic)).toThrow('zu lang');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    const card = createDiagnosticCard(store, { projectId: project.id, columnId: columns[1]!.id, reproduction: '' }, diagnostic);
    expect(card.columnId).toBe(columns[1]!.id);
    store.close();
  });
});
