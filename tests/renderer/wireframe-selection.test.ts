import { describe, expect, it } from 'vitest';
import type { WireframeElement } from '../../src/shared/card-wireframe';
import { snapWireframePosition } from '../../src/renderer/components/wireframe-editing';
import { alignWireframeSelection, duplicateWireframeSelection, expandWireframeGroupSelection, moveWireframeSelection, removeWireframeSelection, selectWireframeMarquee, selectWireframeTarget } from '../../src/renderer/components/wireframe-selection';

const item = (id: string, x: number, y: number, width = 40, height = 20): WireframeElement =>
  ({ id, kind: 'panel', text: id, tone: 'plain', x, y, width, height });

describe('wireframe multi-selection geometry', () => {
  it('selects whole persistent groups from a member or a crossing marquee', () => {
    const elements = [{ ...item('a', 10, 10), groupId: 'group-one' }, { ...item('b', 100, 100), groupId: 'group-one' }, item('c', 200, 200)];
    expect(expandWireframeGroupSelection(elements, ['b'])).toEqual(['a', 'b']);
    expect(selectWireframeMarquee(elements, { x: 5, y: 5 }, { x: 30, y: 20 })).toEqual(['a', 'b']);
    expect(moveWireframeSelection(elements, expandWireframeGroupSelection(elements, ['a']), 5, 7, 300, 300).map(({ x, y }) => [x, y]))
      .toEqual([[15, 17], [105, 107], [200, 200]]);
  });

  it('selects, drags and frames only members inside an entered group', () => {
    const elements = [{ ...item('a', 10, 10), groupId: 'group-one' }, { ...item('b', 100, 100), groupId: 'group-one' }, item('c', 15, 15)];
    expect(selectWireframeTarget(elements, 'a')).toEqual(['a', 'b']);
    expect(selectWireframeTarget(elements, 'a', 'group-one')).toEqual(['a']);
    expect(selectWireframeTarget(elements, 'c', 'group-one')).toEqual(['c']);
    expect(selectWireframeMarquee(elements, { x: 0, y: 0 }, { x: 60, y: 60 }, [], 'group-one')).toEqual(['a']);
    expect(selectWireframeMarquee(elements, { x: 0, y: 0 }, { x: 60, y: 60 }, ['b'], 'group-one')).toEqual(['a', 'b']);
    expect(moveWireframeSelection(elements, ['a'], 6, 8, 300, 300, 'group-one').map(({ x, y }) => [x, y]))
      .toEqual([[16, 18], [100, 100], [15, 15]]);
    expect(moveWireframeSelection(elements, ['a'], 6, 8, 300, 300).map(({ x, y }) => [x, y]))
      .toEqual([[16, 18], [106, 108], [15, 15]]);
  });

  it('duplicates a member within its current group without copying siblings or saving', () => {
    const elements = [{ ...item('a', 10, 10), groupId: 'group-one' }, { ...item('b', 100, 100), groupId: 'group-one' }];
    const result = duplicateWireframeSelection(elements, ['a'], 300, 300, () => 'copy-a', 'group-one')!;
    expect(result.selectedIds).toEqual(['copy-a']);
    expect(result.elements).toHaveLength(3);
    expect(result.elements[2]).toMatchObject({ id: 'copy-a', groupId: 'group-one', x: 26, y: 26 });
    expect(elements).toHaveLength(2);
  });

  it('removes a member and clears an orphaned group ID without touching other groups', () => {
    const elements = [{ ...item('a', 10, 10), groupId: 'first' }, { ...item('b', 50, 50), groupId: 'first' }, { ...item('c', 90, 90), groupId: 'second' }, { ...item('d', 130, 130), groupId: 'second' }];
    expect(removeWireframeSelection(elements, ['a'])).toMatchObject([{ id: 'b', groupId: undefined }, { id: 'c', groupId: 'second' }, { id: 'd', groupId: 'second' }]);
    expect(elements[1]!.groupId).toBe('first');
  });

  it('duplicates a group under a fresh group ID while leaving source membership untouched', () => {
    const elements = [{ ...item('a', 10, 10), groupId: 'group-old' }, { ...item('b', 100, 100), groupId: 'group-old' }];
    let sequence = 0;
    const result = duplicateWireframeSelection(elements, ['a', 'b'], 300, 300, () => `new-${++sequence}`)!;
    expect(result.elements[2]!.groupId).toBe(result.elements[3]!.groupId);
    expect(result.elements[2]!.groupId).not.toBe('group-old');
    expect(elements.map((entry) => entry.groupId)).toEqual(['group-old', 'group-old']);
    expect(expandWireframeGroupSelection(result.elements, [result.selectedIds[0]!])).toEqual(result.selectedIds);
  });
  it('selects intersecting layers in both drag directions without altering their geometry', () => {
    const elements = [item('a', 10, 10), item('b', 70, 50), item('c', 140, 140)];
    expect(selectWireframeMarquee(elements, { x: 100, y: 80 }, { x: 35, y: 25 })).toEqual(['a', 'b']);
    expect(selectWireframeMarquee(elements, { x: 35, y: 25 }, { x: 100, y: 80 })).toEqual(['a', 'b']);
    expect(elements[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('adds to an existing selection and ignores edge-only or zero-area contact', () => {
    const elements = [item('a', 10, 10), item('b', 70, 50), item('c', 140, 140)];
    expect(selectWireframeMarquee(elements, { x: 70, y: 50 }, { x: 110, y: 70 }, ['a'])).toEqual(['a', 'b']);
    expect(selectWireframeMarquee(elements, { x: 50, y: 10 }, { x: 70, y: 30 })).toEqual([]);
    expect(selectWireframeMarquee(elements, { x: 10, y: 10 }, { x: 10, y: 80 }, ['a'])).toEqual(['a']);
  });

  it('duplicates selected layers with fresh IDs, preserved styles and a bounded shared offset', () => {
    const styled = { ...item('a', 350, 800, 40, 20), style: { fontSize: 20, fill: '#ffffff' } } as WireframeElement;
    const elements = [item('back', 10, 10), styled, item('b', 300, 700, 40, 20)];
    const result = duplicateWireframeSelection(elements, ['b', 'a'], 390, 844, () => 'back')!;
    expect(result.selectedIds).toEqual(['copy-a-1', 'copy-b-1']);
    expect(result.elements.slice(3)).toMatchObject([
      { id: 'copy-a-1', x: 334, y: 816, style: { fontSize: 20, fill: '#ffffff' } },
      { id: 'copy-b-1', x: 284, y: 716 },
    ]);
    expect(result.elements[3]!.style).not.toBe(styled.style);
    expect(elements).toHaveLength(3);
    expect(elements[1]).toMatchObject({ x: 350, y: 800 });
  });

  it('places edge copies up-left and refuses an overfull artboard without partial changes', () => {
    const elements = [item('edge', 350, 824, 40, 20)];
    expect(duplicateWireframeSelection(elements, ['edge'], 390, 844, () => 'copy-1')?.elements[1])
      .toMatchObject({ id: 'copy-1', x: 334, y: 808 });
    expect(duplicateWireframeSelection(elements, ['missing'], 390, 844, () => 'copy-2')).toBeNull();
    const full = Array.from({ length: 40 }, (_, index) => item(`item-${index}`, 0, 0));
    expect(duplicateWireframeSelection(full, ['item-0'], 390, 844, () => 'copy-3')).toBeNull();
    expect(full).toHaveLength(40);
  });
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
