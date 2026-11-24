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

  it('draws ellipses and both line directions in all three mini artboards', () => {
    const ellipse: WireframeElement = { id: 'circle', kind: 'ellipse', tone: 'plain', text: '', x: 30, y: 40, width: 120, height: 120, style: { fill: '#aabbcc', stroke: '#223344' } };
    const rising: WireframeElement = { id: 'rising', kind: 'line', tone: 'accent', text: '', x: 40, y: 180, width: 180, height: 70, lineDirection: 'rising', style: { stroke: '#123456' } };
    const falling: WireframeElement = { ...rising, id: 'falling', lineDirection: undefined, style: { stroke: '@stroke' } };
    const html = renderToStaticMarkup(<WireframeArtboardOverview elements={[ellipse, rising]} artboards={{ tablet: [falling], mobile: [ellipse, rising] }} active="desktop" disabled={false} onSelect={() => undefined} />);
    expect(html.match(/kind-ellipse/g)).toHaveLength(2);
    expect(html).toContain('border-radius:50%');
    expect(html).toContain('background-color:#aabbcc');
    expect(html.match(/class="task-wireframe-overview-line"/g)).toHaveLength(3);
    expect(html.match(/y1="98" x2="98" y2="2"/g)).toHaveLength(2);
    expect(html).toContain('y1="2" x2="98" y2="98"');
    expect(html).toContain('color:#123456');
    expect(html).toContain('color:var(--accent)');
  });
});
