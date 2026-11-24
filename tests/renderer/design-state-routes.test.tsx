import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignStateRoutes, stateRouteSummary } from '../../src/renderer/components/DesignStateRoutes';

describe('design state route controls', () => {
  it('offers four keyboard-usable named choices and never invents a stored route', () => {
    const html = renderToStaticMarkup(createElement(DesignStateRoutes, { projectId: 'synthetic', active: true, previewBusy: false, themePreviewActive: false, onOpen: async () => undefined }));
    expect(html).toContain('UI-Zustände');
    for (const label of ['Normal', 'Loading', 'Empty', 'Error']) expect(html).toContain(label);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Keine Route');
    expect(html).not.toContain('Route gespeichert');
    expect(html).toContain('Branchloom erzeugt diese Zustände nicht selbst');
  });

  it('shows the route and the existence of parameters without rendering query values', () => {
    const route = stateRouteSummary('http://127.0.0.1:5173/empty?state=synthetic#preview');
    expect(route).toContain('http://127.0.0.1:5173/empty');
    expect(route).toContain('Parameter oder Fragment vorhanden');
    expect(route).not.toContain('state=synthetic');
  });
});
