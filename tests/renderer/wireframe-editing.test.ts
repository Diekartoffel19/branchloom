import { describe, expect, it } from 'vitest';
import type { WireframeElement } from '../../src/shared/card-wireframe';
import { moveWireframeLayer, resizeWireframeElement } from '../../src/renderer/components/wireframe-editing';

const element = (id: string, x = 100, y = 100, width = 200, height = 80): WireframeElement => ({ id, kind: 'panel', text: '', tone: 'plain', x, y, width, height });

describe('wireframe editor geometry and layer helpers', () => {
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
});
