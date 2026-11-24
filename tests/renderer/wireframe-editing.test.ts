import { describe, expect, it } from 'vitest';
import { WIREFRAME_THEME_COLORS, wireframeColorCss, type WireframeElement } from '../../src/shared/card-wireframe';
import { moveWireframeLayer, resizeWireframeElement, sameWireframeContent, snapWireframePosition, wireframePreviewFontSize } from '../../src/renderer/components/wireframe-editing';

const element = (id: string, x = 100, y = 100, width = 200, height = 80): WireframeElement => ({ id, kind: 'panel', text: '', tone: 'plain', x, y, width, height });

describe('wireframe editor geometry and layer helpers', () => {
  it('expresses explicit font sizes in artboard-relative canvas units', () => {
    expect(wireframePreviewFontSize(undefined, 960)).toBeUndefined();
    expect(parseFloat(wireframePreviewFontSize(20, 960)!)).toBeCloseTo(20 / 960 * 100);
    expect(parseFloat(wireframePreviewFontSize(20, 390)!)).toBeCloseTo(20 / 390 * 100);
    expect(wireframePreviewFontSize(20, 960)).toMatch(/cqw$/);
  });
  it('snaps dragged positions to 8 px while keeping the whole element on each artboard', () => {
    expect(snapWireframePosition(67, 100, 960)).toBe(64);
    expect(snapWireframePosition(69, 100, 960)).toBe(72);
    expect(snapWireframePosition(-20, 100, 960)).toBe(0);
    expect(snapWireframePosition(500, 80, 390)).toBe(310);
    expect(snapWireframePosition(760, 80, 768)).toBe(688);
  });
  it('resizes from the bottom right and keeps the element inside the fixed canvas', () => {
    const item = element('a', 900, 550, 40, 40);
    expect(resizeWireframeElement(item, 100, 100)).toMatchObject({ x: 900, y: 550, width: 60, height: 50 });
    expect(resizeWireframeElement(item, -100, -100)).toMatchObject({ x: 900, y: 550, width: 24, height: 24 });
    expect(resizeWireframeElement(item, 5.6, 2.4)).toMatchObject({ width: 46, height: 42 });
    expect(item).toMatchObject({ width: 40, height: 40 });
  });

  it('moves exactly one layer without mutating the stored order', () => {
    const layers = [element('back'), element('middle'), element('front')];
    expect(moveWireframeLayer(layers, 'middle', 1).map((item) => item.id)).toEqual(['back', 'front', 'middle']);
    expect(moveWireframeLayer(layers, 'middle', -1).map((item) => item.id)).toEqual(['middle', 'back', 'front']);
    expect(moveWireframeLayer(layers, 'front', 1)).toBe(layers);
    expect(moveWireframeLayer(layers, 'missing', -1)).toBe(layers);
    expect(layers.map((item) => item.id)).toEqual(['back', 'middle', 'front']);
  });

  it('recognizes an undone edit as the stored content regardless of property key order', () => {
    const saved = { title: 'Fenster', elements: [element('first'), element('second')] };
    const same = { title: 'Fenster', elements: saved.elements.map((item) => ({
      width: item.width, text: item.text, id: item.id, y: item.y, tone: item.tone,
      height: item.height, kind: item.kind, x: item.x,
    })) };
    expect(sameWireframeContent(same, saved)).toBe(true);
    expect(sameWireframeContent({ ...same, elements: [...same.elements].reverse() }, saved)).toBe(false);
    expect(sameWireframeContent({ ...same, elements: [{ ...same.elements[0]!, x: 101 }, same.elements[1]!] }, saved)).toBe(false);
    expect(sameWireframeContent(same, null)).toBe(false);
  });

  it('includes tablet and mobile content in the unchanged approval check', () => {
    const mobile = element('mobile', 30, 40, 200, 80);
    const saved = { title: 'Fenster', elements: [element('desktop')], artboards: { tablet: [] as WireframeElement[], mobile: [mobile] } };
    expect(sameWireframeContent({ ...saved, artboards: { mobile: [{ ...mobile }], tablet: [] } }, saved)).toBe(true);
    expect(sameWireframeContent({ ...saved, artboards: { tablet: [], mobile: [{ ...mobile, x: 31 }] } }, saved)).toBe(false);
    expect(sameWireframeContent({ ...saved, artboards: { tablet: [] } }, saved)).toBe(false);
  });

  it('treats style edits and undo as content changes on each artboard', () => {
    const base = element('text');
    const styled = { ...base, style: { fontSize: 20, fontWeight: 600 as const, fill: '#ffffff' } };
    const saved = { title: 'Fenster', elements: [styled], artboards: { mobile: [base] } };
    expect(sameWireframeContent({ ...saved, elements: [{ ...styled, style: { fill: '#ffffff', fontWeight: 600, fontSize: 20 } }] }, saved)).toBe(true);
    expect(sameWireframeContent({ ...saved, elements: [{ ...styled, style: { ...styled.style, fontSize: 22 } }] }, saved)).toBe(false);
    expect(sameWireframeContent({ ...saved, artboards: { mobile: [{ ...base, style: { radius: 8 } }] } }, saved)).toBe(false);
    expect(sameWireframeContent({ ...saved, elements: [{ ...styled, style: { ...styled.style } }] }, saved)).toBe(true);
  });

  it('resolves semantic style colors for both regular and accent elements without freezing a theme', () => {
    const panel = { ...element('panel'), style: { fill: WIREFRAME_THEME_COLORS.fill, stroke: WIREFRAME_THEME_COLORS.stroke, textColor: WIREFRAME_THEME_COLORS.textColor } };
    expect(wireframeColorCss(panel, 'fill')).toBe('var(--surface-2)');
    expect(wireframeColorCss(panel, 'stroke')).toBe('var(--accent)');
    expect(wireframeColorCss(panel, 'textColor')).toBe('var(--text)');
    const button: WireframeElement = { ...panel, kind: 'button', tone: 'accent' };
    expect(wireframeColorCss(button, 'fill')).toBe('var(--accent)');
    expect(wireframeColorCss(button, 'stroke')).toBe('var(--bg)');
    expect(wireframeColorCss(button, 'textColor')).toBe('var(--bg)');
    expect(wireframeColorCss({ ...button, tone: 'plain' }, 'textColor')).toBe('var(--text)');
    expect(wireframeColorCss({ ...button, style: { textColor: '#112233' } }, 'textColor')).toBe('#112233');
  });
});
