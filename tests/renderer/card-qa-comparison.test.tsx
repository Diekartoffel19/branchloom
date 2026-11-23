import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardQaComparison, QaComparisonView } from '../../src/renderer/components/CardQaComparison';
import type { CardQaReport } from '../../src/shared/types';

const base: CardQaReport = {
  id: 'one', cardId: 'card', projectId: 'project', requestedUrl: 'http://127.0.0.1:5173/one', finalUrl: 'http://127.0.0.1:5173/one',
  startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:00:01.000Z', status: 'failed', diagnostics: [], note: null,
  screenshotAvailable: true, viewportWidth: 1280, viewportHeight: 800,
};

describe('local visual screenshot comparison', () => {
  it('requires two saved screenshots and two explicit selections', () => {
    const one = renderToStaticMarkup(createElement(CardQaComparison, { cardId: 'card', reports: [base] }));
    expect(one).toContain('zwei gespeicherte QA-Screenshots');
    const two = renderToStaticMarkup(createElement(CardQaComparison, { cardId: 'card', reports: [base, { ...base, id: 'two' }] }));
    expect(two).toContain('Screenshot A');
    expect(two).toContain('Screenshot B');
    expect(two).toContain('Visuell vergleichen');
    expect(two).toContain('disabled');
  });

  it('shows separate sources, times, viewport evidence and an explicit visual-only limit', () => {
    const html = renderToStaticMarkup(createElement(QaComparisonView, { comparison: {
      left: base,
      right: { ...base, id: 'two', finalUrl: 'http://127.0.0.1:5173/two', endedAt: '2026-01-01T10:01:01.000Z', viewportWidth: 0, viewportHeight: 0 },
      leftImage: 'data:image/png;base64,AA==', rightImage: 'data:image/png;base64,AQ==',
    } }));
    expect(html).toContain('Screenshot A');
    expect(html).toContain('Screenshot B');
    expect(html).toContain('/one');
    expect(html).toContain('/two');
    expect(html).toContain('1280 × 800 px');
    expect(html).toContain('nicht erfasst');
    expect(html).toContain('Routen unterscheiden sich');
    expect(html).toContain('Keine Pixelbewertung');
  });
});
