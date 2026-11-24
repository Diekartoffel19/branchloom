import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignViewportCanvas } from '../../src/renderer/components/DesignViewportCanvas';

describe('design viewport canvas', () => {
  it('requires an opened preview and an explicit capture before showing images', () => {
    const closed = renderToStaticMarkup(createElement(DesignViewportCanvas, { projectId: 'project', ready: false, themePreviewActive: false, revision: 0 }));
    expect(closed).toContain('Öffne oben zuerst');
    expect(closed).toContain('disabled');
    const ready = renderToStaticMarkup(createElement(DesignViewportCanvas, { projectId: 'project', ready: true, themePreviewActive: false, revision: 0 }));
    expect(ready).toContain('Größen aufnehmen');
    expect(ready).not.toContain('<img');
    expect(ready).toContain('Momentaufnahmen');
  });

  it('requires the temporary theme preview to be reset first', () => {
    const html = renderToStaticMarkup(createElement(DesignViewportCanvas, { projectId: 'project', ready: true, themePreviewActive: true, revision: 0 }));
    expect(html).toContain('Die neuen Browser übernehmen sie nicht');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Größen aufnehmen/);
  });
});
