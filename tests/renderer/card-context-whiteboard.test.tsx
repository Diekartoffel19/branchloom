import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhiteboardContextSourceList } from '../../src/renderer/components/WhiteboardContextSources';
import type { WhiteboardNode } from '../../src/shared/types';

const nodes: WhiteboardNode[] = [
  { id: 'file', projectId: 'project', title: 'Guide', description: '', x: 0, y: 0, reference: { kind: 'file', path: 'docs\\guide.md' }, createdAt: '', updatedAt: '' },
  { id: 'folder', projectId: 'project', title: 'Folder', description: '', x: 0, y: 0, reference: { kind: 'folder', path: 'docs' }, createdAt: '', updatedAt: '' },
  { id: 'card', projectId: 'project', title: 'Task', description: '', x: 0, y: 0, reference: { kind: 'card', cardId: 'task' }, createdAt: '', updatedAt: '' },
];

describe('Whiteboard context source list', () => {
  it('offers drag and a keyboard button only for persisted file boxes', () => {
    const html = renderToStaticMarkup(createElement(WhiteboardContextSourceList, { nodes, disabled: false, onPrepare: () => undefined }));
    expect(html).toContain('draggable="true"');
    expect(html).toContain('Vorbereiten');
    expect(html).toContain('docs/guide.md');
    expect(html).not.toContain('Folder');
    expect(html).not.toContain('Task');
  });

  it('disables preparation for an archived or busy card', () => {
    const html = renderToStaticMarkup(createElement(WhiteboardContextSourceList, { nodes, disabled: true, onPrepare: () => undefined }));
    expect(html).toContain('draggable="false"');
    expect(html).toContain('disabled=""');
  });
});
