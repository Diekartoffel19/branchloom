import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardQaViewportMatrix, latestQaViewportSlots, qaViewportRoutes } from '../../src/renderer/components/CardQaViewportMatrix';
import type { CardQaReport } from '../../src/shared/types';

const base: CardQaReport = {
  id: 'tablet-old', cardId: 'card', projectId: 'project', requestedUrl: 'http://127.0.0.1:5173/', finalUrl: 'http://127.0.0.1:5173/',
  startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:00:01.000Z', status: 'passed', diagnostics: [], pageCheck: 'not-run', pageObservations: [], note: null,
  screenshotAvailable: true, viewportWidth: 768, viewportHeight: 1024,
};

describe('saved QA viewport matrix', () => {
  it('chooses the latest saved screenshot per measured size on the exact loaded route', () => {
    const reports = [
      base,
      { ...base, id: 'tablet-new', endedAt: '2026-01-01T10:01:01.000Z' },
      { ...base, id: 'mobile', viewportWidth: 390, viewportHeight: 844 },
      { ...base, id: 'other-route', finalUrl: 'http://127.0.0.1:5173/other', viewportWidth: 1280, viewportHeight: 800 },
      { ...base, id: 'pruned', viewportWidth: 1280, viewportHeight: 800, screenshotAvailable: false },
      { ...base, id: 'unknown-size', viewportWidth: 900, viewportHeight: 600 },
    ];
    expect(qaViewportRoutes(reports)).toEqual(['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/other']);
    expect(latestQaViewportSlots(reports, 'http://127.0.0.1:5173/').map((slot) => slot.report?.id ?? null))
      .toEqual([null, 'tablet-new', 'mobile']);
    expect(latestQaViewportSlots(reports, 'http://127.0.0.1:5173/other').map((slot) => slot.report?.id ?? null))
      .toEqual(['other-route', null, null]);
  });

  it('does not offer old unknown sizes or pruned screenshots as available', () => {
    const html = renderToStaticMarkup(createElement(CardQaViewportMatrix, { cardId: 'card', reports: [
      { ...base, viewportWidth: 0, viewportHeight: 0 },
      { ...base, id: 'pruned', screenshotAvailable: false },
    ] }));
    expect(html).toContain('noch kein Screenshot mit erfasster Desktop-, Tablet- oder Mobile-Größe');
    expect(html).not.toContain('Gespeicherte Größen ansehen');
  });

  it('offers only explicit loading and labels the saved route without claiming a live comparison', () => {
    const html = renderToStaticMarkup(createElement(CardQaViewportMatrix, { cardId: 'card', reports: [base] }));
    expect(html).toContain('Geladene Route');
    expect(html).toContain('Gespeicherte Größen ansehen');
    expect(html).toContain('verschiedenen Zeiten');
    expect(html).not.toContain('data:image/png');
    expect(html).not.toContain('Live-Vorschau');
  });
});
