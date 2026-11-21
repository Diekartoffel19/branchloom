import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiagnosticStatus, diagnosticHint } from '../../src/renderer/components/AgentView';
import type { AgentDetection } from '../../src/shared/types';

const base: AgentDetection = { kind: 'codex', command: 'codex', available: false, version: null, status: 'missing' };

describe('agent diagnostic messages', () => {
  it('distinguishes missing CLI, timeout and verified version from login', () => {
    expect(diagnosticHint(base)).toContain('nicht gefunden');
    expect(diagnosticHint({ ...base, status: 'timeout' })).toContain('acht Sekunden');
    expect(diagnosticHint({ ...base, status: 'ready', available: true })).toContain('Anmeldung');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, status: 'timeout' }} />)).toContain('Zeitlimit');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, status: 'found', available: true }} />)).toContain('Gefunden');
  });
});
