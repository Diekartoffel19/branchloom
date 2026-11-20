import { createHash } from 'node:crypto';

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_CARDS = 5000;
const TRELLO_ID = /^[a-f0-9]{24}$/i;

export interface ParsedTrelloCard {
  sourceId: string;
  title: string;
  description: string;
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
    if (list && typeof list.id === 'string' && TRELLO_ID.test(list.id) && typeof list.name === 'string') listNames.set(list.id, list.name.trim().slice(0, 200));
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
    const reason = !title || title.length > 200 || title.includes('\0') ? 'Ungültiger oder zu langer Titel (maximal 200 Zeichen).'
      : description.length > 30000 || description.includes('\0') ? 'Beschreibung ist zu lang oder enthält ein Nullzeichen.' : null;
    cards.push({
      sourceId,
      title: title.slice(0, 200),
      description: description.slice(0, 30000),
      listName: typeof source.idList === 'string' ? listNames.get(source.idList) ?? null : null,
      archived: source.closed === true,
      eligible: reason === null,
      reason,
    });
  }
  return { fingerprint: createHash('sha256').update(rawJson, 'utf8').digest('hex'), boardName, cards };
}
