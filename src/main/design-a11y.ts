import type { DesignA11yCheck } from '../shared/design-a11y';

type Color = [number, number, number];

function rgb(value: unknown): Color | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1(?:\.0+)?))?\s*\)$/.exec(value);
  if (!match || (match[4] && Number(match[4]) !== 1)) return null;
  const components = [Number(match[1]), Number(match[2]), Number(match[3])];
  return components.every((part) => part <= 255) ? components as Color : null;
}

function luminance(color: Color): number {
  const [red, green, blue] = color.map((part) => {
    const channel = part / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const front = rgb(foreground), back = rgb(background);
  if (!front || !back) return null;
  const values = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

export interface RawA11yMeasurement {
  found: boolean;
  tag?: string;
  text?: boolean;
  foreground?: string;
  background?: string;
  backgroundUnknown?: boolean;
  interactive?: boolean;
  width?: number;
  height?: number;
}

/** An advisory check of one live DOM element, never a WCAG conformance verdict. */
export function evaluateA11yMeasurement(selection: Pick<DesignA11yCheck, 'projectId' | 'selectionId' | 'selector' | 'sourceUrl'>, raw: RawA11yMeasurement): DesignA11yCheck {
  if (!raw || raw.found !== true) throw new Error('Das ausgewählte Element ist in der aktuellen Vorschau nicht mehr vorhanden. Wähle es erneut aus.');
  const foreground = typeof raw.foreground === 'string' ? raw.foreground.slice(0, 80) : null;
  const background = typeof raw.background === 'string' ? raw.background.slice(0, 80) : null;
  const ratio = raw.text && !raw.backgroundUnknown && foreground && background ? contrastRatio(foreground, background) : null;
  const reason = !raw.text ? 'Kein direkter Text im ausgewählten Element.' : raw.backgroundUnknown ? 'Bild, Verlauf, Transparenz oder Effekt verhindert eine verlässliche Farbberechnung.' : ratio === null ? 'Die berechneten Farben konnten nicht als deckende RGB-Werte gelesen werden.' : null;
  const interactive = raw.interactive === true;
  const width = interactive && Number.isFinite(raw.width) && raw.width! >= 0 && raw.width! <= 100_000 ? Math.round(raw.width! * 10) / 10 : null;
  const height = interactive && Number.isFinite(raw.height) && raw.height! >= 0 && raw.height! <= 100_000 ? Math.round(raw.height! * 10) / 10 : null;
  return {
    ...selection, checkedAt: new Date().toISOString(),
    contrast: { ratio, foreground, background, belowBodyTextReference: ratio === null ? null : ratio < 4.5, reason },
    target: { interactive, width, height, belowSizeReference: width === null || height === null ? null : width < 24 || height < 24 },
  };
}

/** Runs only inside the already opened, isolated local design preview. */
export function a11yMeasurementScript(selector: string): string { return `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!(node instanceof Element)) return { found: false };
  const computed = getComputedStyle(node);
  let hasDirectText = false;
  for (let index = 0; index < Math.min(node.childNodes.length, 100); index++) {
    const child = node.childNodes[index];
    if (child?.nodeType === Node.TEXT_NODE && child.textContent?.slice(0, 512).trim()) { hasDirectText = true; break; }
  }
  let background = null;
  let backgroundUnknown = false;
  let current = node;
  let depth = 0;
  for (; current && depth < 64; current = current.parentElement, depth++) {
    const style = getComputedStyle(current);
    if (style.opacity !== '1' || style.mixBlendMode !== 'normal' || style.filter !== 'none') { backgroundUnknown = true; break; }
    if (!background) {
      if (style.backgroundImage !== 'none') { backgroundUnknown = true; break; }
      const color = style.backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') background = color;
    }
  }
  if (current) backgroundUnknown = true;
  if (!background) backgroundUnknown = true;
  const tag = node.tagName.toLowerCase();
  const interactive = ['button', 'input', 'select', 'textarea', 'summary'].includes(tag) || (tag === 'a' && node.hasAttribute('href')) || ['button', 'link', 'checkbox', 'radio', 'switch'].includes(node.getAttribute('role'));
  const rect = node.getBoundingClientRect();
  return { found: true, tag, text: hasDirectText, foreground: computed.color, background, backgroundUnknown, interactive, width: rect.width, height: rect.height };
})()`; }
