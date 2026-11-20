import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MemoryNote } from '../../src/shared/types';
import { MemoryMarkdown, parseMemoryBlocks } from '../../src/renderer/memory-markdown';

const note: MemoryNote = {
  id: 'linked', projectId: 'project', title: 'Entscheidung', body: '',
  tags: [], links: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('Memory Markdown preview', () => {
  it('parses headings, list items, quotes, paragraphs and fenced code without executing markup', () => {
    expect(parseMemoryBlocks('# Plan\n\n- eins\n- zwei\n\n> Zitat\n\nText\n\n```js\nconst x = 1;\n```')).toEqual([
      { kind: 'heading', level: 1, text: 'Plan' },
      { kind: 'list', items: ['eins', 'zwei'] },
      { kind: 'quote', text: 'Zitat' },
      { kind: 'paragraph', text: 'Text' },
      { kind: 'code', text: 'const x = 1;' },
    ]);
  });

  it('links only known notes and escapes raw HTML and code', () => {
    const html = renderToStaticMarkup(createElement(MemoryMarkdown, {
      body: 'Zu [[Entscheidung]] und [[Unbekannt]]. <script>alert(1)</script> **wichtig**\n\n```html\n<img src=x onerror=alert(1)>\n```',
      notes: [note], onOpenNote: () => undefined,
    }));
    expect(html).toContain('<button');
    expect(html).toContain('[[Entscheidung]]');
    expect(html).toContain('memory-wikilink missing');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
});
