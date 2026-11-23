import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConflictRadarResult } from '../../src/shared/conflict-radar';
import { ConflictRadarNotice } from '../../src/renderer/components/ConflictRadarNotice';

const base: ConflictRadarResult = { cardId: 'first', sessionId: 'session', checkedAt: '2026-11-23T20:00:00.000Z', state: 'clear', ownChangedCount: 1, peers: [], reason: null };

describe('conflict radar notice', () => {
  it('shows concrete overlapping paths and the peer card', () => {
    const result: ConflictRadarResult = { ...base, state: 'overlap', peers: [{ cardId: 'second', cardTitle: 'Zweite Karte', sessionId: 'other', state: 'overlap', changedCount: 2, commonPaths: ['src/file.ts'], commonCount: 1, reason: null }] };
    const html = renderToStaticMarkup(createElement(ConflictRadarNotice, { result }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Zweite Karte');
    expect(html).toContain('src/file.ts');
    expect(html).toContain('1 gemeinsame Datei');
  });

  it('does not present an incomplete Git check as safe', () => {
    const result: ConflictRadarResult = { ...base, state: 'unknown', reason: 'Diese Sitzung verwendet keinen isolierten Worktree.', peers: [{ cardId: 'second', cardTitle: 'Zweite Karte', sessionId: 'other', state: 'unknown', changedCount: null, commonPaths: [], commonCount: 0, reason: 'Git-Status konnte nicht gelesen werden.' }] };
    const html = renderToStaticMarkup(createElement(ConflictRadarNotice, { result }));
    expect(html).toContain('vollständige Prüfung war nicht möglich');
    expect(html).toContain('Git-Status konnte nicht gelesen werden');
    expect(html).not.toContain('keine gemeinsamen geänderten');
  });

  it('labels a clear result as a momentary observation', () => {
    const result: ConflictRadarResult = { ...base, peers: [{ cardId: 'second', cardTitle: 'Zweite Karte', sessionId: 'other', state: 'clear', changedCount: 1, commonPaths: [], commonCount: 0, reason: null }] };
    const html = renderToStaticMarkup(createElement(ConflictRadarNotice, { result }));
    expect(html).toContain('Momentaufnahme');
    expect(html).toContain('Ignorierte Dateien und spätere Änderungen werden nicht erfasst');
    expect(html).toContain('role="status"');
  });
});
