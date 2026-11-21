import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserView } from '../../src/renderer/components/BrowserView';

describe('browser controls', () => {
  it('renders a real address form and clear navigation actions', () => {
    const html = renderToStaticMarkup(createElement(BrowserView, { active: true }));
    expect(html).toContain('aria-label="Browser"');
    expect(html).toContain('id="browser-url"');
    expect(html).toContain('aria-label="Zurück"');
    expect(html).toContain('aria-label="Vorwärts"');
    expect(html).toContain('aria-label="Neu laden"');
    expect(html).toContain('aria-label="Screenshot in Zwischenablage kopieren"');
    expect(html).toContain('aria-label="Im Standardbrowser öffnen"');
    expect(html).toContain('Öffnen');
    expect(html).toContain('aria-label="Browser-Tabs"');
    expect(html).toContain('aria-label="Neuer Tab"');
    expect(html).toContain('Webseiten laufen getrennt');
  });
});
