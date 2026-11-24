/** Draws the current unsaved artboard using its live geometry and computed theme. */
export async function wireframePngDataUrl(stage: HTMLElement, width: number, height: number): Promise<string> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048) {
    throw new Error('Ungültige Zeichenflächengröße.');
  }
  if (stage.querySelector('[data-wireframe-inline-editor]')) throw new Error('Beende zuerst die direkte Textbearbeitung.');
  const measuredWidth = stage.offsetWidth;
  if (!measuredWidth) throw new Error('Die Zeichenfläche ist noch nicht sichtbar.');
  const scale = width / measuredWidth;
  const bitmap = document.createElement('canvas');
  bitmap.width = width;
  bitmap.height = height;
  const context = bitmap.getContext('2d');
  if (!context) throw new Error('Der Bildexport ist auf diesem Gerät nicht verfügbar.');
  const background = getComputedStyle(stage).backgroundColor;
  context.fillStyle = background === 'rgba(0, 0, 0, 0)' ? '#fff' : background;
  context.fillRect(0, 0, width, height);

  for (const source of stage.querySelectorAll<HTMLElement>(':scope > .task-wireframe-element')) {
    const css = getComputedStyle(source);
    const x = parseFloat(source.style.left) / 100 * width;
    const y = parseFloat(source.style.top) / 100 * height;
    const w = parseFloat(source.style.width) / 100 * width;
    const h = parseFloat(source.style.height) / 100 * height;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const kind = [...source.classList].find((name) => name.startsWith('kind-'))?.slice(5);
    context.save();
    if (kind === 'line') {
      const line = source.querySelector<SVGLineElement>('.task-wireframe-line-visible');
      const rising = line?.getAttribute('y1') === '98';
      context.beginPath();
      context.moveTo(x + w * .02, y + h * (rising ? .98 : .02));
      context.lineTo(x + w * .98, y + h * (rising ? .02 : .98));
      context.strokeStyle = css.color;
      context.lineWidth = 2 * scale;
      context.stroke();
      context.restore();
      continue;
    }

    const borderWidth = parseFloat(css.borderTopWidth) * scale || 0;
    const radius = Math.min(w / 2, h / 2, parseFloat(css.borderTopLeftRadius) * scale || 0);
    context.beginPath();
    if (kind === 'ellipse') context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else context.roundRect(x, y, w, h, radius);
    if (css.backgroundColor !== 'rgba(0, 0, 0, 0)' && css.backgroundColor !== 'transparent') {
      context.fillStyle = css.backgroundColor;
      context.fill();
    }
    if (borderWidth && css.borderTopColor !== 'rgba(0, 0, 0, 0)' && css.borderTopColor !== 'transparent') {
      context.strokeStyle = css.borderTopColor;
      context.lineWidth = borderWidth;
      context.stroke();
    }

    const label = source.textContent?.trim();
    if (label && kind !== 'ellipse') {
      const padding = parseFloat(css.paddingLeft) * scale || 0;
      const fontSize = parseFloat(css.fontSize) * scale || 12;
      const lineHeight = parseFloat(css.lineHeight) * scale || fontSize * 1.2;
      const centered = kind === 'button';
      const maxTextWidth = Math.max(0, w - padding * 2);
      context.font = `${css.fontWeight} ${fontSize}px ${css.fontFamily}`;
      context.fillStyle = css.color;
      context.textAlign = centered ? 'center' : 'left';
      context.textBaseline = 'middle';
      context.beginPath();
      context.rect(x, y, w, h);
      context.clip();
      let display = label;
      if (context.measureText(display).width > maxTextWidth) {
        while (display.length && context.measureText(`${display}…`).width > maxTextWidth) display = display.slice(0, -1);
        display = display ? `${display}…` : '';
      }
      context.fillText(display, centered ? x + w / 2 : x + padding, kind === 'panel' ? y + padding + lineHeight / 2 : y + h / 2);
    }
    context.restore();
  }
  return bitmap.toDataURL('image/png');
}
