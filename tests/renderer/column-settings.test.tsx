import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentPreset, Column } from '../../src/shared/types';
import { ColumnAgentSettings } from '../../src/renderer/components/BoardView';

const agents: AgentPreset[] = [
  { id: 'codex', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: 'profile-model', enabled: true },
  { id: 'gemini', name: 'Gemini', kind: 'gemini', command: 'gemini', args: [], model: null, enabled: true },
  { id: 'agy', name: 'Antigravity', kind: 'antigravity', command: 'agy', args: [], model: null, enabled: true },
];
const column: Column = { id: 'executing', projectId: 'project', name: 'Executing', position: 0, autoStart: false, agentId: 'codex', model: 'column-model', effort: 'high' };
const mutate = async <T,>(action: () => Promise<T>): Promise<T> => action();

describe('column settings UI', () => {
  it('shows an agent, model, and usable Codex effort even when auto-start is off', () => {
    const html = renderToStaticMarkup(<ColumnAgentSettings column={column} agents={agents} mutate={mutate} />);
    expect(html).toContain('Agent für Executing');
    expect(html).toContain('Modell für Executing');
    expect(html).toContain('value="column-model"');
    expect(html).toContain('Effort für Executing');
    expect(html).toContain('value="high" selected=""');
    expect(html).toContain('Agent-Einstellungen speichern');
  });

  it('disables effort for Gemini and both overrides for a manual column', () => {
    const gemini = renderToStaticMarkup(<ColumnAgentSettings column={{ ...column, agentId: 'gemini', model: 'gemini-3.8-flash', effort: null }} agents={agents} mutate={mutate} />);
    expect(gemini).toContain('Effort ist für diesen CLI-Typ nicht verfügbar.');
    expect(gemini).toMatch(/aria-label="Effort für Executing"[^>]*disabled=""/);
    const manual = renderToStaticMarkup(<ColumnAgentSettings column={{ ...column, agentId: null, model: null, effort: null }} agents={agents} mutate={mutate} />);
    expect(manual).toMatch(/aria-label="Modell für Executing"[^>]*disabled=""/);
    expect(manual).toMatch(/aria-label="Effort für Executing"[^>]*disabled=""/);
  });

  it('offers Antigravity effort through max without Codex ultra', () => {
    const html = renderToStaticMarkup(<ColumnAgentSettings column={{ ...column, agentId: 'agy', effort: 'max' }} agents={agents} mutate={mutate} />);
    expect(html).toContain('value="max" selected=""');
    expect(html).not.toContain('value="ultra"');
  });
});
