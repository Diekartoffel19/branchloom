import type { WireframeElement, WireframeVariant } from '../../shared/card-wireframe';
import { WIREFRAME_ARTBOARDS, WIREFRAME_WIDTH } from '../../shared/card-wireframe';

const clamp = (value: number, lower: number, upper: number): number => Math.max(lower, Math.min(upper, value));

/** A starting copy, not a claim that the layout is responsive. */
export function copyDesktopToArtboard(elements: WireframeElement[], target: WireframeVariant): WireframeElement[] {
  const canvas = WIREFRAME_ARTBOARDS[target];
  const ratio = canvas.width / WIREFRAME_WIDTH;
  return elements.map((element) => {
    const x = clamp(Math.round(element.x * ratio), 0, canvas.width - 24);
    const width = clamp(Math.round(element.width * ratio), 24, canvas.width - x);
    const y = clamp(element.y, 0, canvas.height - 24);
    const height = clamp(element.height, 24, canvas.height - y);
    return { ...element, x, y, width, height };
  });
}
