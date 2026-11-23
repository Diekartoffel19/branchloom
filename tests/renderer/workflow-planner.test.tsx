import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot, WorkflowProposal } from '../../src/shared/types';
import { ProposalPreview, WorkflowPlanner } from '../../src/renderer/components/WorkflowPlanner';

const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Test', path: 'C:\\test', createdAt: '2026-01-01T00:00:00Z' },
  columns: [
    { id: 'planning', projectId: 'p', name: 'Planning', position: 0, autoStart: false, agentId: null, model: null, effort: null },
    { id: 'testing', projectId: 'p', name: 'Testing', position: 1, autoStart: false, agentId: null, model: null, effort: null },
  ],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
};

describe('workflow planner', () => {
  it('shows the global agent and requires an actual agent before planning', () => {
    const html = renderToStaticMarkup(createElement(WorkflowPlanner, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('GLOBALER WORKFLOW-AGENT');
    expect(html).toContain('Agent auswählen');
    expect(html).toContain('Effort');
    expect(html).toContain('Projekt-README');
    expect(html).toContain('Andere Projektdateien werden nicht mitgegeben');
    expect(html).toContain('aktivierte Projektregeln aus Reviews');
    expect(html).toContain('Projektregeln aus Reviews');
    expect(html).toContain('Noch keine Review-Regel übernommen');
    expect(html).not.toContain('Jarvis plant');
    expect(html).toContain('Noch kein CLI-Agent eingerichtet');
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>.*Ablauf vorschlagen/s);
  });

  it('renders a proposed route and cards safely before acceptance', () => {
    const proposal: WorkflowProposal = {
      title: '<script>bad()</script>', explanation: 'Zuerst planen, danach testen.',
      cards: [{ title: 'Suche umsetzen', description: 'Mit <Beleg> prüfen' }],
      columnIds: ['planning', 'testing'],
    };
    const html = renderToStaticMarkup(createElement(ProposalPreview, { proposal, snapshot, onAccept: () => undefined, accepting: false }));
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Suche umsetzen');
    expect(html).toContain('Planning');
    expect(html).toContain('Testing');
    expect(html).toContain('Noch nicht übernommen');
    expect(html).toContain('Vorschlag übernehmen');
    expect(html).toContain('Er startet erst nach deinem Klick');
  });

  it('distinguishes route executors and approval from the global planner', () => {
    const configured: ProjectSnapshot = {
      ...snapshot,
      columns: snapshot.columns.map((column) => column.id === 'planning' ? { ...column, agentId: 'step-agent' } : column),
      agents: [{ id: 'step-agent', name: 'Spalten-Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
    };
    const proposal: WorkflowProposal = { title: 'Prüfung', explanation: 'Plan', cards: [{ title: 'Karte', description: '' }], columnIds: ['planning'] };
    const html = renderToStaticMarkup(createElement(ProposalPreview, { proposal, snapshot: configured, onAccept: () => undefined, accepting: false }));
    expect(html).toContain('Route und Spaltenagenten');
    expect(html).toContain('Spalten-Codex');
    expect(html).toContain('Freigabe vor Start');
  });
});
