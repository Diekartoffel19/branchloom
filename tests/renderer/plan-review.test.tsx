import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanReviewPanel } from '../../src/renderer/components/PlanReviewPanel';
import type { ReviewedPlan } from '../../src/shared/plan-review';

const plan: ReviewedPlan = { id: 'plan', projectId: 'project', request: 'Build', state: 'open', workflowId: null,
  fingerprint: 'fingerprint', createdAt: '2026-01-01T00:00:00Z',
  proposal: { title: 'Safe', explanation: '<script>alert(1)</script>', cards: [{ title: 'Task', description: 'Test' }], columnIds: ['planning'] } };

describe('plan review surface', () => {
  it('shows numbered accessible comment targets and escapes model text', () => {
    const html = renderToStaticMarkup(createElement(PlanReviewPanel, { plan }));
    expect(html).toContain('Kommentar zu Planzeile 1');
    expect(html).toContain('Kommentar zu Planzeile 3');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Feedback kopieren');
  });

  it('disables comment targets for an older proposal', () => {
    const html = renderToStaticMarkup(createElement(PlanReviewPanel, { plan: { ...plan, state: 'superseded' } }));
    expect(html).toContain('Ein neuerer Vorschlag liegt vor.');
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-label="Kommentar zu Planzeile 1"/);
  });
});
