import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowEvidenceRows, WorkflowRunEvidencePanel } from '../../src/renderer/components/WorkflowRunEvidencePanel';
import type { Workflow } from '../../src/shared/types';
import type { WorkflowRunEvidence } from '../../src/shared/workflow-evidence';

const at = '2026-11-24T04:00:00.000Z';
const workflow: Workflow = {
  id: 'flow', projectId: 'project', name: 'Synthetic route', cardIds: ['card'],
  steps: [{ id: 'step', columnId: 'execute', agentId: 'agent', requireApproval: false }],
  state: 'paused', currentStep: 0, createdAt: at, updatedAt: at,
};
const columns = [{ id: 'execute', projectId: 'project', name: 'Executing', position: 0, autoStart: false, agentId: 'agent', model: null, effort: null }];
const evidence: WorkflowRunEvidence = {
  projectId: 'project', workflowId: 'flow', moreAvailable: false, rows: [
    { stepIndex: 0, cardId: 'card', cardTitle: '<script>synthetic</script>', state: 'needs_review', missingSession: false,
      session: { id: 'session', agentName: 'Local agent', state: 'exited', startedAt: at, endedAt: at, exitCode: 0 } },
  ],
};

describe('workflow evidence presentation', () => {
  it('keeps progress and process result separate with keyboard buttons for both sources', () => {
    const html = renderToStaticMarkup(createElement(WorkflowEvidenceRows, { evidence, workflow, columns, onOpenCard: () => undefined, onOpenSession: () => undefined }));
    expect(html).toContain('Schritt 1 · Executing');
    expect(html).toContain('Prüfung nötig');
    expect(html).toContain('Sitzung beendet · Exit-Code: 0');
    expect(html).toContain('Karte öffnen');
    expect(html).toContain('Verlauf öffnen');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;synthetic&lt;/script&gt;');
  });

  it('shows missing source states and the row cap without false navigation', () => {
    const missing: WorkflowRunEvidence = { ...evidence, moreAvailable: true, rows: [
      { stepIndex: 0, cardId: 'removed', cardTitle: null, state: 'manual_wait', session: null, missingSession: true },
    ] };
    const html = renderToStaticMarkup(createElement(WorkflowEvidenceRows, { evidence: missing, workflow, columns, onOpenCard: () => undefined, onOpenSession: () => undefined }));
    expect(html).toContain('Entfernte Karte');
    expect(html).toContain('Verknüpfte Sitzung nicht verfügbar');
    expect(html).toContain('höchstens 200');
    expect(html).not.toContain('Karte öffnen');
    expect(html).not.toContain('Verlauf öffnen');
    const closed = renderToStaticMarkup(createElement(WorkflowRunEvidencePanel, { projectId: 'project', workflow, columns }));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('Schrittverlauf ansehen');
  });
});
