import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardAttachment } from '../../src/shared/types';
import { AttachmentList } from '../../src/renderer/components/CardAttachments';

const base: CardAttachment = { id: 'a', cardId: 'c', name: 'notes.pdf', size: 42, addedAt: '2026-01-01', available: true, canOpen: true };

describe('card attachment display', () => {
  it('shows the basename and explicit actions without exposing a path', () => {
    const html = renderToStaticMarkup(createElement(AttachmentList, { items: [base], archived: false, busy: false, onOpen: () => undefined, onRemove: () => undefined }));
    expect(html).toContain('notes.pdf');
    expect(html).toContain('Öffnen');
    expect(html).toContain('Verknüpfung „notes.pdf“ entfernen');
    expect(html).not.toContain('C:\\');
  });

  it('disables opening a missing or blocked file and removal for archived cards', () => {
    const html = renderToStaticMarkup(createElement(AttachmentList, { items: [{ ...base, available: false }, { ...base, id: 'b', name: 'run.cmd', canOpen: false }], archived: true, busy: false, onOpen: () => undefined, onRemove: () => undefined }));
    expect(html).toContain('Datei fehlt oder Pfad geändert');
    expect(html).toContain('Öffnen für diesen Dateityp gesperrt');
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
