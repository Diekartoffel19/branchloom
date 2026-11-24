import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhiteboardImpactResult } from '../../src/renderer/components/WhiteboardImpactResult';
import type { WhiteboardImpact } from '../../src/shared/whiteboard-impact';

describe('whiteboard impact result', () => {
  it('shows evidence, bounded scope and uncertainty without a misleading safety claim', () => {
    const impact: WhiteboardImpact = { nodeId: 'node', referencePath: 'src/ui', referenceKind: 'folder', scannedFiles: 2, partial: true,
      importers: [{ path: 'src/App.tsx', line: 4, targetPath: 'src/ui/Button.tsx', specifier: './ui/Button', sourceFingerprint: 'a'.repeat(64) }], transitiveImporters: [],
      notes: ['Dateien über 256 KiB wurden ausgelassen.', 'Keine indirekten Abhängigkeiten geprüft.'] };
    const html = renderToStaticMarkup(createElement(WhiteboardImpactResult, { impact }));
    expect(html).toContain('Unvollständige Prüfung');
    expect(html).toContain('src/App.tsx:4');
    expect(html).toContain('Bezug: Ordner');
    expect(html).toContain('src/ui');
    expect(html).toContain('src/ui/Button.tsx');
    expect(html).toContain('Keine indirekten Abhängigkeiten geprüft.');
    expect(html).not.toContain('sicher');
  });

  it('offers a keyboard-accessible draft action for an evidenced import site', () => {
    const impact: WhiteboardImpact = { nodeId: 'node', referencePath: 'src/ui', referenceKind: 'folder', scannedFiles: 2, partial: false,
      importers: [{ path: 'src/App.tsx', line: 4, targetPath: 'src/ui/Button.tsx', specifier: './ui/Button', sourceFingerprint: 'a'.repeat(64) }], transitiveImporters: [], notes: [] };
    const html = renderToStaticMarkup(createElement(WhiteboardImpactResult, { impact, onDraft: () => undefined }));
    expect(html).toContain('Kartenentwurf aus Import src/App.tsx Zeile 4');
    expect(html).toContain('type="button"');
    expect(html).toContain('Bezug: Ordner');
  });

  it('shows each indirect edge with line evidence without offering a direct-site card action', () => {
    const edge = (path: string, line: number, targetPath: string) => ({ path, line, targetPath, specifier: './next', sourceFingerprint: 'a'.repeat(64) });
    const impact: WhiteboardImpact = { nodeId: 'node', referencePath: 'src/ui/Button.tsx', referenceKind: 'file', scannedFiles: 3, partial: true,
      importers: [edge('src/ui/index.ts', 2, 'src/ui/Button.tsx')],
      transitiveImporters: [{ path: 'src/App.tsx', depth: 2, chain: [edge('src/App.tsx', 4, 'src/ui/index.ts'), edge('src/ui/index.ts', 2, 'src/ui/Button.tsx')] }],
      notes: ['Weitere Importpfade jenseits von 3 Schritten vorhanden; hier nicht aufgelöst.'] };
    const html = renderToStaticMarkup(createElement(WhiteboardImpactResult, { impact, onDraft: () => undefined }));
    expect(html).toContain('src/App.tsx:4');
    expect(html).toContain('src/ui/index.ts:2');
    expect(html).toContain('src/ui/Button.tsx');
    expect(html).toContain('2 Schritte');
    expect(html).toContain('Unvollständige Prüfung');
    expect(html).not.toContain('Kartenentwurf aus Import src/App.tsx');
  });
});
