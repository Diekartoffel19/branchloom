import type { WireframeElement } from '../../shared/card-wireframe';
import { WIREFRAME_HEIGHT, WIREFRAME_WIDTH } from '../../shared/card-wireframe';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function resizeWireframeElement(item: WireframeElement, deltaWidth: number, deltaHeight: number): WireframeElement {
  return {
    ...item,
    width: clamp(Math.round(item.width + deltaWidth), 24, WIREFRAME_WIDTH - item.x),
    height: clamp(Math.round(item.height + deltaHeight), 24, WIREFRAME_HEIGHT - item.y),
  };
}

export function moveWireframeLayer(elements: WireframeElement[], id: string, direction: -1 | 1): WireframeElement[] {
  const index = elements.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= elements.length) return elements;
  const next = [...elements];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
