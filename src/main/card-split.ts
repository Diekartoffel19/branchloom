import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardSplitDraftItem, CardSplitInput, CardSplitLinks, CardSplitPreview, CardSplitResult } from '../shared/card-split';
import type { StudioStore } from './store';

interface RelationRow { child_card_id: string; title: string; archived_at: string | null; depends_on_card_id: string | null; depends_on_title: string | null; position: number }

export function installCardSplits(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS card_splits (
    id TEXT PRIMARY KEY,
    parent_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    child_card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
    depends_on_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (parent_card_id <> child_card_id),
    CHECK (child_card_id <> depends_on_card_id)
  );
  CREATE INDEX IF NOT EXISTS card_splits_parent ON card_splits(parent_card_id, position);`);
}

function checkedItems(raw: unknown): CardSplitDraftItem[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 8) throw new Error('Plane zwei bis acht Teilkarten.');
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Teilkarte ${index + 1} ist ungültig.`);
    const value = item as CardSplitDraftItem;
    if (typeof value.title !== 'string') throw new Error(`Titel von Teilkarte ${index + 1} fehlt.`);
    const title = value.title.trim();
    if (!title || title.length > 160 || /\0/.test(title)) throw new Error(`Titel von Teilkarte ${index + 1} muss 1 bis 160 Zeichen enthalten.`);
    const key = title.toLocaleLowerCase('de-DE');
    if (seen.has(key)) throw new Error('Teilkarten brauchen unterschiedliche Titel.');
    seen.add(key);
    if (typeof value.description !== 'string' || value.description.length > 3000 || /\0/.test(value.description)) throw new Error(`Beschreibung von Teilkarte ${index + 1} darf höchstens 3000 Zeichen enthalten.`);
    if (value.dependsOnIndex !== null && (!Number.isInteger(value.dependsOnIndex) || value.dependsOnIndex < 0 || value.dependsOnIndex >= index)) {
      throw new Error(`Teilkarte ${index + 1} kann nur von einer vorherigen Teilkarte abhängen.`);
    }
    return { title, description: value.description.trim(), dependsOnIndex: value.dependsOnIndex };
  });
}

function checkedPlan(store: StudioStore, input: CardSplitInput): { parent: ReturnType<StudioStore['card']>; destination: ReturnType<StudioStore['column']>; items: CardSplitDraftItem[]; token: string } {
  if (!input || typeof input.cardId !== 'string' || typeof input.columnId !== 'string') throw new Error('Karte und Zielspalte fehlen.');
  const parent = store.card(input.cardId);
  if (parent.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const destination = store.column(input.columnId);
  if (destination.projectId !== parent.projectId) throw new Error('Zielspalte gehört zu einem anderen Projekt.');
  if (destination.autoStart) throw new Error('Zielspalte startet Agenten automatisch. Wähle eine manuelle Spalte.');
  if (destination.name.trim().toLocaleLowerCase('de-DE') === 'to do' && store.projectQueue(parent.projectId).state !== 'off') {
    throw new Error('Die To-Do-Warteschlange ist aktiv oder pausiert. Schalte sie aus oder wähle eine andere Spalte.');
  }
  const items = checkedItems(input.items);
  const existing = store.db.prepare('SELECT c.title FROM card_splits s JOIN cards c ON c.id = s.child_card_id WHERE s.parent_card_id = ?').all(parent.id) as Array<{ title: string }>;
  const count = existing.length;
  if (count + items.length > 30) throw new Error('Eine Karte kann höchstens 30 Teilkarten erhalten.');
  const titles = new Set(existing.map((row) => row.title.toLocaleLowerCase('de-DE')));
  if (items.some((item) => titles.has(item.title.toLocaleLowerCase('de-DE')))) throw new Error('Eine Teilkarte mit diesem Titel ist bereits verknüpft.');
  const token = createHash('sha256').update(JSON.stringify({
    parent: [parent.id, parent.title, parent.description, parent.updatedAt, parent.archivedAt],
    destination: [destination.id, destination.name, destination.autoStart, destination.agentId, destination.model, destination.effort],
    queue: store.projectQueue(parent.projectId).state,
    count,
    items,
  })).digest('hex');
  return { parent, destination, items, token };
}

export function previewCardSplit(store: StudioStore, input: CardSplitInput): CardSplitPreview {
  const { parent, destination, items, token } = checkedPlan(store, input);
  return { parent: { id: parent.id, title: parent.title }, destination: { id: destination.id, name: destination.name }, items, token };
}

export function cardSplitLinks(store: StudioStore, cardId: string): CardSplitLinks {
  store.card(cardId);
  const parent = store.db.prepare(`SELECT p.id AS card_id, p.title, s.depends_on_card_id, d.title AS depends_on_title
    FROM card_splits s JOIN cards p ON p.id = s.parent_card_id LEFT JOIN cards d ON d.id = s.depends_on_card_id WHERE s.child_card_id = ?`)
    .get(cardId) as { card_id: string; title: string; depends_on_card_id: string | null; depends_on_title: string | null } | undefined;
  const children = store.db.prepare(`SELECT s.child_card_id, c.title, c.archived_at, s.depends_on_card_id, d.title AS depends_on_title, s.position
    FROM card_splits s JOIN cards c ON c.id = s.child_card_id LEFT JOIN cards d ON d.id = s.depends_on_card_id
    WHERE s.parent_card_id = ? ORDER BY s.position, s.created_at, s.id`).all(cardId) as RelationRow[];
  return {
    parent: parent ? { cardId: parent.card_id, title: parent.title, dependsOnCardId: parent.depends_on_card_id, dependsOnTitle: parent.depends_on_title } : null,
    children: children.map((row) => ({ cardId: row.child_card_id, title: row.title, archivedAt: row.archived_at, dependsOnCardId: row.depends_on_card_id, dependsOnTitle: row.depends_on_title, position: row.position })),
  };
}

export function createCardSplit(store: StudioStore, input: CardSplitInput & { token: string; confirm: boolean }): CardSplitResult {
  if (!input || input.confirm !== true || typeof input.token !== 'string') throw new Error('Teilkarten nur nach ausdrücklicher Bestätigung anlegen.');
  return store.db.transaction(() => {
    const plan = checkedPlan(store, input);
    if (plan.token !== input.token) throw new Error('Karte, Spalte oder Entwurf hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
    const count = (store.db.prepare('SELECT COUNT(*) AS n FROM card_splits WHERE parent_card_id = ?').get(plan.parent.id) as { n: number }).n;
    const cards = plan.items.map((item) => store.createCard({ projectId: plan.parent.projectId, columnId: plan.destination.id, title: item.title, description: item.description }));
    const insert = store.db.prepare('INSERT INTO card_splits (id, parent_card_id, child_card_id, depends_on_card_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const stamp = new Date().toISOString();
    for (const [index, item] of plan.items.entries()) {
      insert.run(randomUUID(), plan.parent.id, cards[index]!.id, item.dependsOnIndex === null ? null : cards[item.dependsOnIndex]!.id, count + index, stamp);
    }
    return { parentCardId: plan.parent.id, cards, links: cardSplitLinks(store, plan.parent.id) };
  })();
}
