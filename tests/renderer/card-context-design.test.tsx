import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignContextSourceList } from '../../src/renderer/components/DesignContextSources';
import { DESIGN_CONTEXT_DRAG_TYPE } from '../../src/renderer/design-context-drag';
import type { DesignSelection } from '../../src/shared/design-inspection';

const selection: DesignSelection = {
  id: '00000000-0000-4000-8000-000000000001', projectId: 'project', sourceUrl: 'http://127.0.0.1:5173/page',
  selector: 'button#save', tag: 'button', text: 'Save', styles: {}, tokens: [], capturedAt: '2026-11-24T05:00:00Z',
};

describe('saved design context source list', () => {
  it('offers one draggable saved record and an equivalent keyboard button', () => {
    const html = renderToStaticMarkup(createElement(DesignContextSourceList, { selections: [selection], disabled: false, onPrepare: () => undefined }));
    expect(html).toContain('draggable="true"');
    expect(html).toContain('button · button#save');
    expect(html).toContain('http://127.0.0.1:5173/page');
    expect(html).toContain('Vorbereiten');
    expect(html).not.toContain(selection.id);
    expect(DESIGN_CONTEXT_DRAG_TYPE).toBe('application/x-branchloom-design-selection');
  });

  it('disables drag and preparation for an archived or busy card', () => {
    const html = renderToStaticMarkup(createElement(DesignContextSourceList, { selections: [selection], disabled: true, onPrepare: () => undefined }));
    expect(html).toContain('draggable="false"');
    expect(html).toContain('disabled=""');
  });
});
