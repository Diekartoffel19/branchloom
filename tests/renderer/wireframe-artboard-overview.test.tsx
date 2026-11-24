import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WireframeElement } from '../../src/shared/card-wireframe';
import { WireframeArtboardOverview } from '../../src/renderer/components/WireframeArtboardOverview';

const desktop: WireframeElement = { id: 'a', kind: 'text', tone: 'plain', text: 'Titel', x: 20, y: 20, width: 200, height: 32 };
const mobile: WireframeElement = { id: 'b', kind: 'button', tone: 'accent', text: 'Weiter', x: 24, y: 120, width: 160, height: 44 };

describe('wireframe artboard overview', () => {
  it('shows all dimensions, current selection and missing variants without changing the document', () => {
    const artboards = { mobile: [mobile] };
    const html = renderToStaticMarkup(<WireframeArtboardOverview elements={[desktop]} artboards={artboards} active="desktop" disabled={false} onSelect={() => undefined} />);
    expect(html).toContain('aria-label="Zeichenflächen im Überblick"');
    expect(html).toContain('Desktop, 960 × 600, 1 Element, öffnen');
    expect(html).toContain('Tablet, 768 × 1024, fehlt, öffnen');
    expect(html).toContain('Mobile, 390 × 844, 1 Element, öffnen');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Noch kein Entwurf');
    expect(html).toContain('Titel');
    expect(html).toContain('Weiter');
    expect(artboards.mobile).toEqual([mobile]);
  });

  it('disables every artboard while a card write is in flight', () => {
    const html = renderToStaticMarkup(<WireframeArtboardOverview elements={[]} artboards={{}} active="tablet" disabled onSelect={() => undefined} />);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('aria-pressed="true"');
  });
});
