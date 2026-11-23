import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhiteboardImpactResult } from '../../src/renderer/components/WhiteboardImpactResult';
import type { WhiteboardImpact } from '../../src/shared/whiteboard-impact';

describe('whiteboard impact result', () => {
  it('shows evidence, bounded scope and uncertainty without a misleading safety claim', () => {
    const impact: WhiteboardImpact = { nodeId: 'node', referencePath: 'src/ui', referenceKind: 'folder', scannedFiles: 2, partial: true,
      importers: [{ path: 'src/App.tsx', line: 4, targetPath: 'src/ui/Button.tsx', specifier: './ui/Button' }],
      notes: ['Dateien über 256 KiB wurden ausgelassen.', 'Keine indirekten Abhängigkeiten geprüft.'] };
    const html = renderToStaticMarkup(createElement(WhiteboardImpactResult, { impact }));
    expect(html).toContain('Unvollständige Prüfung');
    expect(html).toContain('src/App.tsx:4');
    expect(html).toContain('src/ui/Button.tsx');
    expect(html).toContain('Keine indirekten Abhängigkeiten geprüft.');
    expect(html).not.toContain('sicher');
  });
});
