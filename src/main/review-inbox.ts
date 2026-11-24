import type Database from 'better-sqlite3';
import type { AcknowledgeReviewInboxComment, ReviewInboxItem, ReviewInboxPage, ReviewInboxQuery, ReviewInboxSource } from '../shared/review-inbox';
import type { StudioStore } from './store';

const LIMIT = 100;
type Row = { id: string; kind: ReviewInboxSource; project_id: string; source_id: string; source_title: string; location: string; body: string; created_at: string };
const fromRow = (row: Row): ReviewInboxItem => ({ id: row.id, kind: row.kind, projectId: row.project_id, sourceId: row.source_id,
  sourceTitle: row.source_title, location: row.location, body: row.body, createdAt: row.created_at });

export function installReviewInbox(db: Database.Database): void {
  db.function('review_search_fold', { deterministic: true }, (value: string) => value.normalize('NFKC').toLocaleLowerCase('de-DE'));
  db.exec(`CREATE TABLE IF NOT EXISTS review_inbox_acknowledgements (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('plan','diff')),
    comment_id TEXT NOT NULL, acknowledged_at TEXT NOT NULL,
    PRIMARY KEY(project_id, kind, comment_id)
  );`);
}

/** Read only existing comments for one project. An accepted or replaced plan is no longer waiting for review. */
export function reviewInboxItems(store: StudioStore, input: ReviewInboxQuery): ReviewInboxPage {
  if (!input || typeof input.projectId !== 'string' || (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200))
    || (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0))) throw new Error('Ungültige Review-Inbox-Abfrage.');
  const projectId = input.projectId;
  const query = (input.query?.trim() ?? '').normalize('NFKC').toLocaleLowerCase('de-DE');
  store.project(projectId);
  const rows = store.db.prepare(`SELECT * FROM (
    SELECT pc.id, 'plan' AS kind, p.project_id, p.id AS source_id,
      substr(p.request, 1, 120) AS source_title,
      'Planzeile ' || pc.line || ': ' || substr(pc.text, 1, 120) AS location,
      pc.body, pc.created_at
    FROM plan_comments pc JOIN reviewed_plans p ON p.id = pc.plan_id
    LEFT JOIN review_inbox_acknowledgements ack ON ack.project_id = p.project_id AND ack.kind = 'plan' AND ack.comment_id = pc.id
    WHERE p.project_id = ? AND p.state = 'open' AND ack.comment_id IS NULL
    UNION ALL
    SELECT rc.id, 'diff' AS kind, c.project_id, c.id AS source_id,
      c.title AS source_title, 'Diff ' || rc.file_path || ':' || rc.line AS location,
      rc.body, rc.created_at
    FROM review_comments rc JOIN cards c ON c.id = rc.card_id
    LEFT JOIN review_inbox_acknowledgements ack ON ack.project_id = c.project_id AND ack.kind = 'diff' AND ack.comment_id = rc.id
    WHERE c.project_id = ? AND c.archived_at IS NULL AND ack.comment_id IS NULL
  ) WHERE (? = '' OR instr(review_search_fold(source_title), ?) > 0 OR instr(review_search_fold(location), ?) > 0 OR instr(review_search_fold(body), ?) > 0)
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(projectId, projectId, query, query, query, query, LIMIT + 1, input.offset ?? 0) as Row[];
  return { items: rows.slice(0, LIMIT).map(fromRow), hasMore: rows.length > LIMIT };
}

/** Acknowledgement only clears the inbox entry; it never approves a plan, changes a card or starts an agent. */
export function acknowledgeReviewInboxComment(store: StudioStore, input: AcknowledgeReviewInboxComment): void {
  if (!input || typeof input.projectId !== 'string' || (input.kind !== 'plan' && input.kind !== 'diff')
    || typeof input.commentId !== 'string' || !input.commentId) throw new Error('Ungültiger Review-Kommentar.');
  store.db.transaction(() => {
    store.project(input.projectId);
    const source = input.kind === 'plan'
      ? store.db.prepare(`SELECT p.project_id FROM plan_comments pc JOIN reviewed_plans p ON p.id = pc.plan_id
          WHERE pc.id = ? AND p.state = 'open'`).get(input.commentId) as { project_id: string } | undefined
      : store.db.prepare(`SELECT c.project_id FROM review_comments rc JOIN cards c ON c.id = rc.card_id
          WHERE rc.id = ? AND c.archived_at IS NULL`).get(input.commentId) as { project_id: string } | undefined;
    if (!source || source.project_id !== input.projectId) throw new Error('Review-Kommentar gehört nicht zu diesem aktiven Projekt.');
    store.db.prepare(`INSERT OR IGNORE INTO review_inbox_acknowledgements (project_id, kind, comment_id, acknowledged_at)
      VALUES (?, ?, ?, ?)`).run(input.projectId, input.kind, input.commentId, new Date().toISOString());
  })();
}
