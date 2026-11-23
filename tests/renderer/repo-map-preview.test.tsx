import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RepoMapPreview } from '../../src/renderer/components/RepoMapPreview';
import type { RepoMapProposal } from '../../src/shared/repo-map';

const proposal: RepoMapProposal = {
  fingerprint: 'f'.repeat(64), source: 'git-index', trackedFileCount: 3, mappedFileCount: 2, truncated: true,
  warnings: ['Nur zwei Pfade ausgewertet.'],
  nodes: [
    { id: 'folder:.', kind: 'package', path: '.', title: 'Repository', x: 0, y: 0, evidence: { kind: 'package-manifest', path: 'package.json' } },
    { id: 'component:src/components/ReviewPanel.tsx', kind: 'component-candidate', path: 'src/components/ReviewPanel.tsx', title: 'ReviewPanel', x: 100, y: 0, evidence: { kind: 'component-convention', path: 'src/components/ReviewPanel.tsx' } },
  ], edges: [],
};

describe('repo map preview', () => {
  it('shows source, uncertainty, warnings and evidence before the explicit import action', () => {
    const html = renderToStaticMarkup(createElement(RepoMapPreview, { proposal, busy: false, error: '', onClose: () => undefined, onAccept: () => undefined }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Dateiinhalte wurden nicht gelesen');
    expect(html).toContain('Mögliche UI-Komponente');
    expect(html).toContain('Beleg: src/components/ReviewPanel.tsx');
    expect(html).toContain('Nur zwei Pfade ausgewertet.');
    expect(html).toContain('2 Boxen übernehmen');
    expect(html).toContain('type="checkbox"');
  });
});
