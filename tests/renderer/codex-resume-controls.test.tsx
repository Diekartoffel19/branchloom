import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardPanel } from '../../src/renderer/components/CardPanel';
import type { ProjectSnapshot } from '../../src/shared/types';

const date = '2026-01-01T00:00:00.000Z';
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Synthetic', path: 'C:\\synthetic', createdAt: date },
  columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: 'codex', model: null, effort: null }],
  cards: [{ id: 'card', projectId: 'p', columnId: 'todo', title: 'Synthetic card', description: '', priority: 'none', labels: [], position: 0, createdAt: date, updatedAt: date, archivedAt: null }],
  agents: [{ id: 'codex', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [{ id: 'session', projectId: 'p', cardId: 'card', agentId: 'codex', state: 'failed', startedAt: date, endedAt: date, exitCode: 1, output: '', codexThreadId: null }],
  workflows: [], notes: [], queue: { projectId: 'p', state: 'paused', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: date },
};

function html(data: ProjectSnapshot): string {
  return renderToStaticMarkup(createElement(CardPanel, { card: data.cards[0]!, snapshot: data, mutate: async () => null, onClose: () => undefined, onOpenCard: () => undefined }));
}

describe('Codex resume controls', () => {
  it('offers the exact conversation and an explicit picker fallback only for a linked ID', () => {
    const linked = { ...snapshot, sessions: [{ ...snapshot.sessions[0]!, codexThreadId: '01a20afb-b90e-7e43-aabe-7d0a76dc3b63' }] };
    const rendered = html(linked);
    expect(rendered).toContain('Dieses Gespräch fortsetzen');
    expect(rendered).toContain('Anderes Gespräch auswählen');
    expect(rendered).toContain('01a20afb-b90e-7e43-aabe-7d0a76dc3b63');
    expect(rendered).toContain('Der alte Auftrag wird nicht erneut gesendet');
  });

  it('uses the picker and explains missing identity for an older session', () => {
    const rendered = html(snapshot);
    expect(rendered).toContain('keine Codex-Gesprächs-ID zuverlässig erfasst');
    expect(rendered).toContain('Codex-Gespräch auswählen');
    expect(rendered).not.toContain('Dieses Gespräch fortsetzen');
  });
});
