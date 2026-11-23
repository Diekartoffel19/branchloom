import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectConflictRadarResult } from '../../src/shared/conflict-radar';
import { ProjectConflictBanner } from '../../src/renderer/components/ProjectConflictBanner';

const base: ProjectConflictRadarResult = { projectId: 'p', checkedAt: '2026-11-23T20:00:00.000Z', state: 'idle', runningCount: 1,
  pairCount: 0, pairs: [], issues: [], reason: null };
const render = (result: ProjectConflictRadarResult) => renderToStaticMarkup(createElement(ProjectConflictBanner, {
  result, busy: false, onOpenCard: () => undefined, onRefresh: () => undefined,
}));

describe('project-wide conflict notice', () => {
  it('stays quiet when no comparison or no overlap exists', () => {
    expect(render(base)).toBe('');
    expect(render({ ...base, state: 'clear', runningCount: 2 })).toBe('');
  });

  it('names the affected cards, observed paths and incomplete checks', () => {
    const html = render({ ...base, state: 'overlap', runningCount: 3, pairCount: 1,
      pairs: [{ leftCardId: 'a', leftCardTitle: 'Erste Karte', rightCardId: 'b', rightCardTitle: 'Zweite Karte', commonPaths: ['src/shared.ts'], commonCount: 1 }],
      issues: [{ cardId: 'c', cardTitle: 'Dritte Karte', reason: 'Worktree fehlt.' }] });
    expect(html).toContain('Projektweites Konflikt-Radar');
    expect(html).toContain('1 Überschneidung');
    expect(html).toContain('Erste Karte');
    expect(html).toContain('Zweite Karte');
    expect(html).toContain('src/shared.ts');
    expect(html).toContain('Dritte Karte');
    expect(html).toContain('Unvollständig geprüft');
    expect(html).toContain('Erneut prüfen');
  });

  it('reports an IPC failure as unknown, without claiming a clear scan', () => {
    const html = render({ ...base, state: 'unknown', runningCount: null, reason: 'Git ist nicht erreichbar.' });
    expect(html).toContain('Konfliktprüfung unvollständig');
    expect(html).toContain('Anzahl laufender Sitzungen unbekannt');
    expect(html).toContain('Git ist nicht erreichbar.');
    expect(html).not.toContain('Keine Überschneidungen');
  });
});
