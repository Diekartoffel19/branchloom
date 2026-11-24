import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, CardQaReport } from '../../src/shared/types';
import { CardQaFixCard } from '../../src/renderer/components/CardQaFixCard';

const card = { id: 'card', projectId: 'project', archivedAt: null } as Card;
const report = { id: 'report', status: 'failed' } as CardQaReport;

describe('QA fix-card entry point', () => {
  it('offers an explicit preparation action only for open failed reports', () => {
    expect(renderToStaticMarkup(createElement(CardQaFixCard, { sourceCard: card, report }))).toContain('Fixkarte vorbereiten');
    expect(renderToStaticMarkup(createElement(CardQaFixCard, { sourceCard: card, report: { ...report, status: 'passed' } }))).toBe('');
    expect(renderToStaticMarkup(createElement(CardQaFixCard, { sourceCard: { ...card, archivedAt: '2026-11-24T00:00:00.000Z' }, report }))).toContain('disabled');
  });
});
