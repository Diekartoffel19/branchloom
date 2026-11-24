import { createHash } from 'node:crypto';
import { cardLabels } from '../shared/card-metadata';

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_CARDS = 5000;
const TRELLO_ID = /^[a-f0-9]{24}$/i;

export interface ParsedTrelloCard {
  sourceId: string;
  title: string;
  description: string;
  labels: string[];
  labelNote: string | null;
  listId: string | null;
  listName: string | null;
  archived: boolean;
  eligible: boolean;
  reason: string | null;
}

export interface ParsedTrelloBoard {
  fingerprint: string;
  boardName: string | null;
  cards: ParsedTrelloCard[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseLabels(source: Record<string, unknown>, boardNames: Map<string, string>): { labels: string[]; labelNote: string | null; reason: string | null } {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const names: string[] = [];
  let unnamed = 0;
  const add = (id: string | null, name: unknown): void => {
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    const label = typeof name === 'string' ? name.trim() : '';
    if (label) {
      const key = label.toLocaleLowerCase('de-DE');
      if (!seenNames.has(key)) { seenNames.add(key); names.push(label); }
    } else unnamed += 1;
  };
  if (Array.isArray(source.labels)) for (const value of source.labels) {
    const item = record(value);
    if (!item) { unnamed += 1; continue; }
    const id = typeof item.id === 'string' && TRELLO_ID.test(item.id) ? item.id.toLowerCase() : null;
    add(id, (id && boardNames.get(id)) || item.name);
  }
  if (Array.isArray(source.idLabels)) for (const value of source.idLabels) {
    const id = typeof value === 'string' && TRELLO_ID.test(value) ? value.toLowerCase() : null;
    add(id, id ? boardNames.get(id) : null);
  }
  const labelNote = unnamed ? `${unnamed} Trello-Label${unnamed === 1 ? '' : 's'} ohne auslesbaren Namen ${unnamed === 1 ? 'wird' : 'werden'} ausgelassen.` : null;
  try { return { labels: cardLabels(names), labelNote, reason: null }; }
  catch (error) { return { labels: [], labelNote, reason: `Label-Import: ${error instanceof Error ? error.message : String(error)}` }; }
}

/** Parse only an individual Trello board export. No actions, members or attachments are read. */
export function parseTrelloBoard(rawJson: string): ParsedTrelloBoard {
  if (typeof rawJson !== 'string' || !rawJson.trim()) throw new Error('Bitte eine Trello-Board-JSON-Datei auswählen.');
  if (Buffer.byteLength(rawJson, 'utf8') > MAX_JSON_BYTES) throw new Error('Die Trello-Datei darf höchstens 8 MiB groß sein.');
  let value: unknown;
  try { value = JSON.parse(rawJson) as unknown; }
  catch { throw new Error('Die Datei enthält kein gültiges JSON.'); }
  const root = record(value);
  if (!root || !Array.isArray(root.cards) || !Array.isArray(root.lists)) throw new Error('Erwartet wird ein einzelner Trello-Board-Export mit cards und lists.');
  if (root.cards.length > MAX_CARDS) throw new Error(`Ein Board-Import ist auf ${MAX_CARDS} Karten begrenzt.`);
  const boardName = typeof root.name === 'string' && root.name.trim() ? root.name.trim().slice(0, 200) : null;
  const listNames = new Map<string, string>();
  for (const item of root.lists) {
    const list = record(item);
    if (list && typeof list.id === 'string' && TRELLO_ID.test(list.id) && typeof list.name === 'string') listNames.set(list.id.toLowerCase(), list.name.trim().slice(0, 200));
  }
  const boardNames = new Map<string, string>();
  if (Array.isArray(root.labels)) for (const item of root.labels) {
    const label = record(item);
    if (label && typeof label.id === 'string' && TRELLO_ID.test(label.id) && typeof label.name === 'string' && label.name.trim()) {
      boardNames.set(label.id.toLowerCase(), label.name.trim());
    }
  }
  const seen = new Set<string>();
  const cards: ParsedTrelloCard[] = [];
  for (const item of root.cards) {
    const source = record(item);
    if (!source || typeof source.id !== 'string' || !TRELLO_ID.test(source.id)) throw new Error('Eine Trello-Karte hat keine gültige stabile ID.');
    const sourceId = source.id.toLowerCase();
    if (seen.has(sourceId)) throw new Error('Der Trello-Export enthält dieselbe Karten-ID mehrfach.');
    seen.add(sourceId);
    const title = typeof source.name === 'string' ? source.name.trim() : '';
    const description = typeof source.desc === 'string' ? source.desc : '';
    const parsedLabels = parseLabels(source, boardNames);
    const reason = !title || title.length > 200 || title.includes('\0') ? 'Ungültiger oder zu langer Titel (maximal 200 Zeichen).'
      : description.length > 30000 || description.includes('\0') ? 'Beschreibung ist zu lang oder enthält ein Nullzeichen.' : parsedLabels.reason;
    const listId = typeof source.idList === 'string' && TRELLO_ID.test(source.idList) ? source.idList.toLowerCase() : null;
    cards.push({
      sourceId,
      title: title.slice(0, 200),
      description: description.slice(0, 30000),
      labels: parsedLabels.labels,
      labelNote: parsedLabels.labelNote,
      listId,
      listName: listId ? listNames.get(listId) ?? null : null,
      archived: source.closed === true,
      eligible: reason === null,
      reason,
    });
  }
  return { fingerprint: createHash('sha256').update(rawJson, 'utf8').digest('hex'), boardName, cards };
}
