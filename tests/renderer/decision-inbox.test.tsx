import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { DecisionInbox } from '../../src/renderer/components/DecisionInbox';
import { decisionItems } from '../../src/renderer/decision-inbox';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';

const date = '2026-01-01T10:00:00.000Z';
const approval: Workflow = {
  id: 'approval', projectId: 'project', name: 'Freigabe prüfen', cardIds: ['card'],
  steps: [{ id: 'step', columnId: 'planning', agentId: 'agent', requireApproval: true }],
  state: 'paused', pauseReason: 'approval', currentStep: 0, createdAt: date, updatedAt: date,
};
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetisches Projekt', path: 'C:\\synthetic', createdAt: date },
  columns: [{ id: 'planning', projectId: 'project', name: 'Planning', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [{ id: 'card', projectId: 'project', columnId: 'planning', title: 'Karte prüfen', description: '', priority: 'none', labels: [], position: 0, createdAt: date, updatedAt: date, archivedAt: null }],
  agents: [{ id: 'agent', name: 'Synthetischer Agent', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [], workflows: [approval], notes: [],
  queue: { projectId: 'project', state: 'paused', templateWorkflowId: approval.id, activeWorkflowId: approval.id, pauseReason: 'Workflow wartet auf Freigabe.', completedCount: 0, updatedAt: date },
};

describe('decision inbox', () => {
  it('shows only persisted paused states and excludes skipped workflows', () => {
    const items = decisionItems({
      ...snapshot,
      workflows: [
        approval,
        { ...approval, id: 'manual', name: 'Handarbeit', pauseReason: 'manual' },
        { ...approval, id: 'review', name: 'Prüfen', pauseReason: 'review' },
        { ...approval, id: 'skipped', queueSkip: { reason: 'bewusst übersprungen', at: date } },
        { ...approval, id: 'running', state: 'running' },
        { ...approval, id: 'done', state: 'done' },
        { ...approval, id: 'draft', state: 'draft' },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(['queue', 'workflow:approval', 'workflow:manual', 'workflow:review']);
    expect(items.find((item) => item.id === 'workflow:approval')).toMatchObject({ title: 'Schrittfreigabe: Freigabe prüfen', context: 'Schritt 1 von 1 · Planning · Karten: Karte prüfen' });
    expect(items.find((item) => item.id === 'workflow:review')?.reason).toContain('externe Aktionen wiederholen');
    expect(items[0]).toMatchObject({ reason: 'Workflow wartet auf Freigabe.', context: 'Aktiver Ablauf: Freigabe prüfen' });
  });

  it('has an honest empty state for an active queue and finished work', () => {
    const quiet = { ...snapshot, queue: { ...snapshot.queue, state: 'running' as const }, workflows: [{ ...approval, state: 'done' as const }] };
    expect(decisionItems(quiet)).toEqual([]);
    const html = renderToStaticMarkup(createElement(DecisionInbox, { snapshot: quiet, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined }));
    expect(html).toContain('Keine offenen Entscheidungen');
    expect(html).not.toContain('Freigabe prüfen');
  });

  it('renders real queue reasons as escaped text and offers navigation without executing actions', () => {
    const reason = '<script>unsafe</script>';
    const html = renderToStaticMarkup(createElement(DecisionInbox, { snapshot: { ...snapshot, queue: { ...snapshot.queue, pauseReason: reason } }, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined }));
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Zur Warteschlange');
    expect(html).toContain('Zum Workflow');
    expect(html).not.toContain('Schritt freigeben');
    expect(html).not.toContain('Queue fortsetzen');
  });

  it('includes the decision view in the app navigation', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('Entscheidungen');
  });
});
