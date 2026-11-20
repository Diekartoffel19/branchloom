import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../../src/shared/types';
import { SearchPalette } from '../../src/renderer/components/SearchPalette';
import { projectSearchResults } from '../../src/renderer/project-search';
import { workflowPauseCopy } from '../../src/renderer/components/WorkflowView';

const date = '2026-01-01T00:00:00Z';
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Testprojekt', path: 'C:\\test', createdAt: date },
  columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null }],
  cards: [{ id: 'c', projectId: 'p', columnId: 'todo', title: 'E-Mails prüfen', description: `Kurzer Text ${'Fülltext '.repeat(25)} Wichtige Frist`, position: 0, createdAt: date, updatedAt: '2026-01-03T00:00:00Z' }],
  notes: [{ id: 'n', projectId: 'p', title: '<b>Entscheidung</b>', body: 'Design für die Oberfläche', tags: ['UI', 'Planung'], links: [], createdAt: date, updatedAt: '2026-01-02T00:00:00Z' }],
  workflows: [{ id: 'w', projectId: 'p', name: 'Review-Ablauf', cardIds: ['c'], steps: [{ id: 's', columnId: 'todo', agentId: null, requireApproval: true }], state: 'draft', currentStep: 0, createdAt: date, updatedAt: '2026-01-04T00:00:00Z' }],
  agents: [], sessions: [],
};

describe('project search', () => {
  it('searches current snapshot across titles, full descriptions, tags, and workflow cards', () => {
    expect(projectSearchResults(snapshot, 'emails').map((item) => item.id)).toEqual(['c', 'w']);
    expect(projectSearchResults(snapshot, 'frist').map((item) => item.id)).toEqual(['c']);
    expect(projectSearchResults(snapshot, 'planung').map((item) => item.id)).toEqual(['n']);
    expect(projectSearchResults(snapshot, 'review').map((item) => item.id)).toEqual(['w']);
    expect(projectSearchResults(snapshot, 'E-Mails').map((item) => item.id)).toEqual(['c', 'w']);
    expect(projectSearchResults(snapshot, 'unbekannt')).toEqual([]);
  });

  it('shows newest entries when query is empty and limits output', () => {
    expect(projectSearchResults(snapshot, '').map((item) => item.id)).toEqual(['w', 'c', 'n']);
    expect(projectSearchResults(snapshot, '', 2)).toHaveLength(2);
  });

  it('renders a focusable search dialog with escaped source titles', () => {
    const html = renderToStaticMarkup(createElement(SearchPalette, { snapshot, onClose: () => undefined, onNavigate: () => undefined }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('&lt;b&gt;Entscheidung&lt;/b&gt;');
    expect(html).not.toContain('<b>Entscheidung</b>');
  });
});

describe('workflow pause messages', () => {
  it('distinguishes approval, manual completion, review, and user pause', () => {
    expect(workflowPauseCopy('approval').action).toBe('Schritt freigeben');
    expect(workflowPauseCopy('manual').action).toBe('Schritt abschließen');
    expect(workflowPauseCopy('review').action).toBe('Schritt erneut starten');
    expect(workflowPauseCopy('user').action).toBe('Fortsetzen');
  });
});
