import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryVaultImportDialog } from '../../src/renderer/components/MemoryVaultImportDialog';
import type { MemoryVaultImportPreview } from '../../src/shared/types';

const preview: MemoryVaultImportPreview = {
  token: 'synthetic', directoryName: 'vault', eligible: 1,
  files: [
    { key: 'a.md', title: 'A', tags: [], eligible: true, reason: null },
    { key: 'nested/b.md', title: 'B', tags: [], eligible: false, reason: 'Titel bereits vorhanden' },
  ],
};

describe('vault import preview', () => {
  it('shows selected files and disables duplicate entries', () => {
    const html = renderToStaticMarkup(<MemoryVaultImportDialog preview={preview} selected={new Set(['a.md'])} busy={false} onToggle={() => undefined} onAll={() => undefined} onClose={() => undefined} onImport={() => undefined} />);
    expect(html).toContain('1 neue Notizen');
    expect(html).toContain('nested/b.md');
    expect(html).toMatch(/disabled=""[^>]*type="checkbox"|type="checkbox"[^>]*disabled=""/);
    expect(html).toContain('1 Notizen importieren');
    expect(html).toContain('Vorhandene Titel werden nicht überschrieben');
  });
});
