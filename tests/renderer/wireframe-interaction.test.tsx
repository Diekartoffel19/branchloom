import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WireframeInteractionEditor } from '../../src/renderer/components/WireframeInteractionEditor';
import type { WireframeElement, WireframeInteraction } from '../../src/shared/card-wireframe';

const button: WireframeElement = { id: 'open', kind: 'button', x: 20, y: 20, width: 120, height: 40, text: 'Details', tone: 'plain' };
const panel: WireframeElement = { id: 'panel', kind: 'panel', x: 200, y: 20, width: 240, height: 260, text: 'Seitenleiste', tone: 'muted' };
const interaction: WireframeInteraction = { triggerElementId: 'open', panelElementId: 'panel', trigger: 'click', action: 'toggle-panel', durationMs: 240, enterOffsetPx: 24, closedOpacity: 0, reducedMotionDurationMs: 0, focusOnOpen: 'panel', focusOnClose: 'trigger' };

describe('wireframe interaction editor', () => {
  it('offers only a valid button and panel pair and renders the stored timing and focus requirements', () => {
    const empty = renderToStaticMarkup(createElement(WireframeInteractionEditor, { elements: [button], interaction: null, disabled: false, onChange: () => undefined }));
    expect(empty).toContain('Für eine Interaktion brauchst du');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Klick → Fläche anlegen/);
    const html = renderToStaticMarkup(createElement(WireframeInteractionEditor, { elements: [button, panel], interaction, disabled: false, onChange: () => undefined }));
    expect(html).toContain('Interaktion Auslöser');
    expect(html).toContain('Interaktion Zielfläche');
    expect(html).toContain('240 ms · Fläche sichtbar');
    expect(html).toContain('Beim Öffnen auf die Fläche');
    expect(html).toContain('Reduzierte Bewegung: 0 ms');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-expanded="false"');
    const controlledPanel = html.match(/aria-controls="([^"]+)"/);
    expect(controlledPanel?.[1]).toBeTruthy();
    expect(html).toContain(`id="${controlledPanel?.[1]}"`);
    expect(html).toContain('Interaktionsvorschau');
  });
});
