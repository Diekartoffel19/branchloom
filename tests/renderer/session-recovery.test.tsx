import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionRecoveryState } from '../../src/shared/session-recovery';
import { SessionRecoveryDetails } from '../../src/renderer/components/SessionRecoveryPanel';

const base: SessionRecoveryState = { sessionId: 'synthetic', signal: 'online', checkedAt: '2026-11-24T12:00:00.000Z', sessionState: 'running', process: 'attached', events: [] };

describe('session recovery wording', () => {
  it('distinguishes an attached local PTY from an online provider claim', () => {
    const html = renderToStaticMarkup(createElement(SessionRecoveryDetails, { state: base }));
    expect(html).toContain('Gerät meldet online');
    expect(html).toContain('keine Verbindung zum Modellanbieter');
    expect(html).toContain('lokale PTY');
    expect(html).not.toContain('erfolgreich fortgesetzt');
  });

  it('shows offline pause and a lost app binding without promising a replay', () => {
    const html = renderToStaticMarkup(createElement(SessionRecoveryDetails, { state: {
      ...base, signal: 'offline', process: 'interrupted', events: [{ signal: 'offline', observedAt: '2026-11-24T12:00:00.000Z' }],
    } }));
    expect(html).toContain('Gerät meldet offline');
    expect(html).toContain('nicht mehr an Branchloom gebunden');
    expect(html).toContain('Warteschlange werden pausiert');
    expect(html).toContain('Netzbeobachtungen (1)');
  });

  it('leaves the cause of a failed CLI run to its actual terminal output', () => {
    const html = renderToStaticMarkup(createElement(SessionRecoveryDetails, { state: { ...base, sessionState: 'failed', process: 'ended' } }));
    expect(html).toContain('mit Fehler beendet');
    expect(html).toContain('gespeicherte Terminalverlauf');
    expect(html).not.toContain('WLAN verursachte');
  });

  it('describes stop as a request until process exit has its own proof', () => {
    const html = renderToStaticMarkup(createElement(SessionRecoveryDetails, { state: { ...base, sessionState: 'stopped', process: 'ended' } }));
    expect(html).toContain('Stoppen angefordert');
    expect(html).toContain('Terminalbeleg');
  });
});
