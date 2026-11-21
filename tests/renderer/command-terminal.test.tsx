import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandTerminalView } from '../../src/renderer/components/CommandTerminalView';

describe('command terminal UI', () => {
  it('shows explicit shell choice and start action', () => {
    const html = renderToStaticMarkup(<CommandTerminalView projectId="project" />);
    expect(html).toContain('Shell auswählen');
    expect(html).toContain('Windows PowerShell');
    expect(html).toContain('Eingabeaufforderung (cmd)');
    expect(html).toContain('Terminal starten');
    expect(html).toContain('nicht von selbst erneut');
  });
});
