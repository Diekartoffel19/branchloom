import type { WireframeElement } from '../../shared/card-wireframe';

export type WireframeAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'distribute-x' | 'distribute-y';

export interface WireframeDuplication { elements: WireframeElement[]; selectedIds: string[] }
export interface WireframePoint { x: number; y: number }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Return layers intersecting a non-empty drag rectangle in artboard coordinates. */
export function selectWireframeMarquee(
  elements: WireframeElement[], start: WireframePoint, end: WireframePoint, existingIds: readonly string[] = [],
): string[] {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  if (right <= left || bottom <= top) return [...existingIds];
  const chosen = new Set(existingIds);
  for (const item of elements) {
    if (item.x < right && item.x + item.width > left && item.y < bottom && item.y + item.height > top) chosen.add(item.id);
  }
  return elements.filter((item) => chosen.has(item.id)).map((item) => item.id);
}

/** Duplicate the current artboard selection in front of existing layers. The entire group shifts together. */
export function duplicateWireframeSelection(
  elements: WireframeElement[], ids: readonly string[], canvasWidth: number, canvasHeight: number,
  makeId: () => string,
): WireframeDuplication | null {
  const chosen = new Set(ids);
  const selected = elements.filter((item) => chosen.has(item.id));
  if (!selected.length || elements.length + selected.length > 40) return null;
  const used = new Set(elements.map((item) => item.id));
  const minDx = -Math.min(...selected.map((item) => item.x));
  const maxDx = Math.min(...selected.map((item) => canvasWidth - item.x - item.width));
  const minDy = -Math.min(...selected.map((item) => item.y));
  const maxDy = Math.min(...selected.map((item) => canvasHeight - item.y - item.height));
  // Prefer a small down-right offset; at the edge, place the copy up-left.
  const dx = maxDx > 0 ? Math.min(16, maxDx) : Math.max(-16, minDx);
  const dy = maxDy > 0 ? Math.min(16, maxDy) : Math.max(-16, minDy);
  const copies = selected.map((item) => {
    let id = makeId();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || used.has(id)) {
      let suffix = 1;
      do { id = `copy-${item.id.slice(0, 40)}-${suffix++}`; } while (used.has(id));
    }
    used.add(id);
    return { ...item, id, x: item.x + dx, y: item.y + dy, ...(item.style ? { style: { ...item.style } } : {}) };
  });
  return { elements: [...elements, ...copies], selectedIds: copies.map((item) => item.id) };
}

/** Move selected elements as one group, preserving their spacing and canvas bounds. */
export function moveWireframeSelection(
  elements: WireframeElement[], ids: readonly string[], deltaX: number, deltaY: number,
  canvasWidth: number, canvasHeight: number,
): WireframeElement[] {
  const selected = elements.filter((item) => ids.includes(item.id));
  if (!selected.length) return elements;
  const dx = clamp(Math.round(deltaX), -Math.min(...selected.map((item) => item.x)), Math.min(...selected.map((item) => canvasWidth - item.x - item.width)));
  const dy = clamp(Math.round(deltaY), -Math.min(...selected.map((item) => item.y)), Math.min(...selected.map((item) => canvasHeight - item.y - item.height)));
  if (dx === 0 && dy === 0) return elements;
  const chosen = new Set(ids);
  return elements.map((item) => chosen.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item);
}

/** Align selected objects to their joint bounds; distribute uses their outer edges. */
export function alignWireframeSelection(
  elements: WireframeElement[], ids: readonly string[], alignment: WireframeAlignment,
): WireframeElement[] {
  const selected = elements.filter((item) => ids.includes(item.id));
  if (selected.length < (alignment.startsWith('distribute') ? 3 : 2)) return elements;
  const left = Math.min(...selected.map((item) => item.x));
  const top = Math.min(...selected.map((item) => item.y));
  const right = Math.max(...selected.map((item) => item.x + item.width));
  const bottom = Math.max(...selected.map((item) => item.y + item.height));
  const changes = new Map<string, Partial<Pick<WireframeElement, 'x' | 'y'>>>();
  if (alignment === 'distribute-x' || alignment === 'distribute-y') {
    const horizontal = alignment === 'distribute-x';
    const ordered = [...selected].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
    const available = horizontal ? right - left : bottom - top;
    const total = ordered.reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0);
    // An even gap cannot be represented without pushing overlapping items past the bounds.
    if (total > available) return elements;
    const gap = (available - total) / (ordered.length - 1);
    let cursor = horizontal ? left : top;
    for (const item of ordered) {
      changes.set(item.id, horizontal ? { x: Math.round(cursor) } : { y: Math.round(cursor) });
      cursor += (horizontal ? item.width : item.height) + gap;
    }
  } else {
    for (const item of selected) {
      const position = alignment === 'left' ? { x: left }
        : alignment === 'center-x' ? { x: Math.round((left + right - item.width) / 2) }
        : alignment === 'right' ? { x: right - item.width }
        : alignment === 'top' ? { y: top }
        : alignment === 'center-y' ? { y: Math.round((top + bottom - item.height) / 2) }
        : { y: bottom - item.height };
      changes.set(item.id, position);
    }
  }
  const next = elements.map((item) => changes.has(item.id) ? { ...item, ...changes.get(item.id)! } : item);
  return next.every((item, index) => item.x === elements[index]!.x && item.y === elements[index]!.y) ? elements : next;
}
