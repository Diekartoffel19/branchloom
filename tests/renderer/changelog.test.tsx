import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { ChangelogView, changelogMarkdown } from '../../src/renderer/components/ChangelogView';
import type { ProjectChangelog } from '../../src/shared/changelog';

const result: ProjectChangelog = {
  projectId: 'synthetic', period: 'day', since: '2026-01-02T12:00:00.000Z', until: '2026-01-03T12:00:00.000Z',
  checkedAt: '2026-01-03T12:00:00.000Z', state: 'ready', head: 'a'.repeat(40), moreAvailable: false,
  commits: [{ hash: 'a'.repeat(40), committedAt: '2026-01-03T10:00:00Z', subject: 'Fix <script>unsafe</script>' }],
};

describe('changelog presentation', () => {
  it('renders a labelled period control and refresh without fabricated commit data during loading', () => {
    const html = renderToStaticMarkup(createElement(ChangelogView, { projectId: 'synthetic' }));
    expect(html).toContain('Git-Historie wird gelesen');
    expect(html).toContain('Letzte 24 Stunden');
    expect(html).toContain('Markdown kopieren');
    expect(html).not.toContain('Fix &lt;script&gt;');
    expect(renderToStaticMarkup(createElement(App))).toContain('Changelog');
  });

  it('copies a deterministic Markdown report with full Git hashes and an explicit evidence limit', () => {
    const markdown = changelogMarkdown(result);
    expect(markdown).toContain('Fix &lt;script&gt;unsafe&lt;/script&gt;');
    expect(markdown).toContain(`(${result.head}, 2026-01-03T10:00:00Z)`);
    expect(markdown).toContain('Tests und Reviews sind hier noch nicht einem Commit zugeordnet.');
    expect(changelogMarkdown({ ...result, commits: [], state: 'no-repository' })).toContain('kein Git-Repository');
  });
});
