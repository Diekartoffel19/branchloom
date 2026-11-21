import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Column, TrelloImportCard, TrelloImportPreview } from '../../src/shared/types';
import { defaultTrelloSelection, importable, trelloCardStatus, TrelloCardRow, TrelloImportPanel } from '../../src/renderer/components/TrelloImportPanel';

function card(sourceId: string, overrides: Partial<TrelloImportCard> = {}): TrelloImportCard {
  return { sourceId, title: `Testkarte ${sourceId}`, description: '', labels: [], labelNote: null, listName: 'Ideen', archived: false, eligible: true, reason: null, importedCardId: null, ...overrides };
}

const preview: TrelloImportPreview = {
  fingerprint: 'synthetic-fingerprint', boardName: 'Testboard', total: 4, eligible: 2, duplicates: 1,
  cards: [card('active'), card('archived', { archived: true }), card('duplicate', { importedCardId: 'existing' }), card('invalid', { eligible: false, reason: 'Ungültiger Titel' })],
};

describe('Trello import UI', () => {
  it('preselects only valid, new, active cards and allows archived cards explicitly', () => {
    expect(defaultTrelloSelection(preview)).toEqual(['active']);
    expect(importable(preview.cards[1])).toBe(true);
    expect(importable(preview.cards[2])).toBe(false);
    expect(importable(preview.cards[3])).toBe(false);
  });

  it('shows duplicate, invalid and archived reasons separately', () => {
    expect(trelloCardStatus(preview.cards[0])).toBe('Bereit');
    expect(trelloCardStatus(preview.cards[1])).toBe('Archiviert');
    expect(trelloCardStatus(preview.cards[2])).toBe('Bereits importiert');
    expect(trelloCardStatus(preview.cards[3])).toBe('Fehler: Ungültiger Titel');
  });

  it('renders a local file picker with explicit preview and no import before inspection', () => {
    const columns: Column[] = [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }];
    const html = renderToStaticMarkup(createElement(TrelloImportPanel, { projectId: 'p', columns, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(html).toContain('type="file"');
    expect(html).toContain('Trello-JSON importieren');
    expect(html).toContain('Datei prüfen');
    expect(html).not.toContain('Karten importieren');
    expect(html).toContain('Arbeitsspeicher');
    expect(html).toContain('Benannte Labels werden übernommen');
  });

  it('shows imported names and omitted color-only labels in the preview row', () => {
    const row = card('with-labels', { labels: ['Planung', 'Bug'], labelNote: '1 Trello-Label ohne auslesbaren Namen wird ausgelassen.' });
    const html = renderToStaticMarkup(createElement(TrelloCardRow, { card: row, checked: true, disabled: false, onToggle: () => undefined }));
    expect(html).toContain('Labels: Planung, Bug');
    expect(html).toContain('wird ausgelassen');
    expect(html).toContain('checked=""');
  });
});
