import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardQaComparison, QaComparisonView } from '../../src/renderer/components/CardQaComparison';
import type { CardQaReport } from '../../src/shared/types';

const base: CardQaReport = {
  id: 'one', cardId: 'card', projectId: 'project', requestedUrl: 'http://127.0.0.1:5173/one', finalUrl: 'http://127.0.0.1:5173/one',
  startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:00:01.000Z', status: 'failed', diagnostics: [], pageCheck: 'not-run', pageObservations: [], note: null,
  screenshotAvailable: true, viewportWidth: 1280, viewportHeight: 800, gitEvidence: null,
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
    const html = renderToStaticMarkup(createElement(QaComparisonView, { onClose: () => undefined, comparison: {
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
    expect(html).toContain('Zwei Screenshots geladen');
    expect(html).toContain('Screenshot A vergrößern');
    expect(html).toContain('Vergleich schließen');
    expect(html).toContain('Git-Stand: bei diesem älteren Bericht nicht erfasst');
    expect(html).toContain('keinem Commit nachweislich zugeordnet');
  });

  it('states matching, differing and dirty checkout evidence without attributing page bytes to Git', () => {
    const clean = { scope: 'project' as const, startHead: 'a'.repeat(40), endHead: 'a'.repeat(40), dirtyAtStart: false, dirtyAtEnd: false, state: 'clean' as const };
    const render = (right: CardQaReport) => renderToStaticMarkup(createElement(QaComparisonView, { onClose: () => undefined,
      comparison: { left: { ...base, gitEvidence: clean }, right, leftImage: 'data:image/png;base64,AA==', rightImage: 'data:image/png;base64,AQ==' } }));
    expect(render({ ...base, id: 'same', gitEvidence: clean })).toContain('denselben Git-HEAD ohne Git-sichtbare Änderungen');
    expect(render({ ...base, id: 'other', gitEvidence: { ...clean, startHead: 'b'.repeat(40), endHead: 'b'.repeat(40) } })).toContain('unterschiedliche Git-HEADs');
    expect(render({ ...base, id: 'dirty', gitEvidence: { ...clean, state: 'dirty', dirtyAtEnd: true } })).toContain('nicht committete Dateien');
    const changed = render({ ...base, id: 'changed', gitEvidence: { ...clean, state: 'changed', endHead: 'b'.repeat(40) } });
    expect(changed).toContain('während einer Prüfung');
    expect(changed).toContain(`${'a'.repeat(12)} → ${'b'.repeat(12)}`);
    expect(render({ ...base, id: 'worktree', gitEvidence: { ...clean, scope: 'card-worktree' } })).toContain('unterschiedlichen zugeordneten Checkouts');
  });
});
