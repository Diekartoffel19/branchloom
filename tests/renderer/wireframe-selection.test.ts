import { describe, expect, it } from 'vitest';
import type { WireframeElement } from '../../src/shared/card-wireframe';
import { snapWireframePosition } from '../../src/renderer/components/wireframe-editing';
import { alignWireframeSelection, moveWireframeSelection } from '../../src/renderer/components/wireframe-selection';

const item = (id: string, x: number, y: number, width = 40, height = 20): WireframeElement =>
  ({ id, kind: 'panel', text: id, tone: 'plain', x, y, width, height });

describe('wireframe multi-selection geometry', () => {
  it('snaps the grabbed item and keeps spacing in a dragged group', () => {
    const elements = [item('a', 10, 20), item('b', 90, 70)];
    const dx = snapWireframePosition(elements[0]!.x + 21, 40, 160) - elements[0]!.x;
    const dy = snapWireframePosition(elements[0]!.y + 17, 20, 110) - elements[0]!.y;
    expect(moveWireframeSelection(elements, ['a', 'b'], dx, dy, 160, 110).map(({ x, y }) => [x, y]))
      .toEqual([[32, 40], [112, 90]]);
  });
  it('moves the entire selected group within the canvas without changing other layers', () => {
    const elements = [item('a', 10, 20), item('b', 90, 70), item('c', 120, 80)];
    expect(moveWireframeSelection(elements, ['a', 'b'], 100, 100, 160, 110).map(({ x, y }) => [x, y]))
      .toEqual([[40, 40], [120, 90], [120, 80]]);
    expect(moveWireframeSelection(elements, ['a', 'b'], -999, -999, 160, 110).map(({ x, y }) => [x, y]))
      .toEqual([[0, 0], [80, 50], [120, 80]]);
    expect(elements[0]).toMatchObject({ x: 10, y: 20 });
    expect(moveWireframeSelection(elements, ['missing'], 4, 4, 160, 110)).toBe(elements);
  });

  it('aligns both axes to selection bounds in one undoable change', () => {
    const elements = [item('a', 10, 20, 40, 20), item('b', 90, 70, 20, 40), item('c', 130, 100)];
    expect(alignWireframeSelection(elements, ['a', 'b'], 'left').map(({ x }) => x)).toEqual([10, 10, 130]);
    expect(alignWireframeSelection(elements, ['a', 'b'], 'center-x').map(({ x }) => x)).toEqual([40, 50, 130]);
    expect(alignWireframeSelection(elements, ['a', 'b'], 'right').map(({ x }) => x)).toEqual([70, 90, 130]);
    expect(alignWireframeSelection(elements, ['a', 'b'], 'top').map(({ y }) => y)).toEqual([20, 20, 100]);
    expect(alignWireframeSelection(elements, ['a', 'b'], 'center-y').map(({ y }) => y)).toEqual([55, 45, 100]);
    expect(alignWireframeSelection(elements, ['a', 'b'], 'bottom').map(({ y }) => y)).toEqual([90, 70, 100]);
    expect(alignWireframeSelection(elements, ['a'], 'left')).toBe(elements);
    expect(elements[1]).toMatchObject({ x: 90, y: 70 });
  });

  it('distributes three layers by equal gaps and rejects impossible overlap', () => {
    const elements = [item('a', 10, 20), item('b', 80, 75), item('c', 190, 180)];
    expect(alignWireframeSelection(elements, ['a', 'b', 'c'], 'distribute-x').map(({ x }) => x)).toEqual([10, 100, 190]);
    expect(alignWireframeSelection(elements, ['a', 'b', 'c'], 'distribute-y').map(({ y }) => y)).toEqual([20, 100, 180]);
    expect(alignWireframeSelection(elements, ['a', 'b'], 'distribute-x')).toBe(elements);
    const overlap = [item('a', 10, 20, 100), item('b', 30, 30, 100), item('c', 50, 40, 100)];
    expect(alignWireframeSelection(overlap, ['a', 'b', 'c'], 'distribute-x')).toBe(overlap);
  });
});
