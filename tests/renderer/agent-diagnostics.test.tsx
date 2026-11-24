import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentCapabilityRows, DiagnosticStatus, diagnosticHint } from '../../src/renderer/components/AgentView';
import type { AgentDetection, AgentPreset } from '../../src/shared/types';

const base: AgentDetection = { kind: 'codex', command: 'codex', available: false, version: null, status: 'missing' };

describe('agent diagnostic messages', () => {
  it('distinguishes missing CLI, timeout and verified version from login', () => {
    expect(diagnosticHint(base)).toContain('nicht gefunden');
    expect(diagnosticHint({ ...base, status: 'timeout' })).toContain('8 Sekunden');
    expect(diagnosticHint({ ...base, kind: 'antigravity', status: 'timeout' })).toContain('20 Sekunden');
    expect(diagnosticHint({ ...base, status: 'ready', available: true })).toContain('Anmeldung');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, status: 'timeout' }} />)).toContain('Zeitlimit');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, status: 'found', available: true }} />)).toContain('Gefunden');
  });

  it('states what a session proved without implying model access or a restored conversation', () => {
    const agent: AgentPreset = { id: 'a', name: 'Codex fixture', kind: 'codex', command: 'codex', args: [], model: null, enabled: true };
    const html = renderToStaticMarkup(<AgentCapabilityRows agent={agent} evidence={[
      { agentId: 'a', capability: 'start', sessionId: 's1', observedAt: '2026-11-24T12:00:00.000Z' },
      { agentId: 'a', capability: 'resume', sessionId: 's2', observedAt: '2026-11-24T12:01:00.000Z' },
    ]} />);
    expect(html).toContain('Lokaler PTY-Prozess gestartet');
    expect(html).toContain('Noch keine manuelle Eingabe belegt');
    expect(html).toContain('Codex-Resume-Aufruf gestartet');
    expect(html).not.toContain('Gespräch wiederhergestellt');
    const other = renderToStaticMarkup(<AgentCapabilityRows agent={{ ...agent, kind: 'gemini' }} evidence={[]} />);
    expect(other).toContain('Für diesen Adapter derzeit nicht implementiert');
  });
});
