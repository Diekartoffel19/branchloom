import type Database from 'better-sqlite3';
import type { SessionSearchHit } from '../shared/types';

interface SearchRow { sessionId: string; cardId: string; cardTitle: string; agentName: string; startedAt: string; snippet: string }

/** The FTS index lives in the existing local SQLite file. Only completed runs are indexed. */
export function installSessionSearch(db: Database.Database): void {
  db.transaction(() => {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_output_fts'").get() !== undefined;
    db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_output_fts USING fts5(
      output, content='sessions', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS session_output_fts_finished AFTER UPDATE OF state ON sessions
    WHEN old.state = 'running' AND new.state != 'running' AND new.output != '' BEGIN
      INSERT INTO session_output_fts(rowid, output) VALUES (new.rowid, new.output);
    END;
    CREATE TRIGGER IF NOT EXISTS session_output_fts_changed AFTER UPDATE OF output ON sessions
    WHEN old.state != 'running' AND new.state != 'running' AND old.output != '' AND new.output != '' BEGIN
      INSERT INTO session_output_fts(session_output_fts, rowid, output) VALUES ('delete', old.rowid, old.output);
      INSERT INTO session_output_fts(rowid, output) VALUES (new.rowid, new.output);
    END;
    CREATE TRIGGER IF NOT EXISTS session_output_fts_added AFTER UPDATE OF output ON sessions
    WHEN old.state != 'running' AND new.state != 'running' AND old.output = '' AND new.output != '' BEGIN
      INSERT INTO session_output_fts(rowid, output) VALUES (new.rowid, new.output);
    END;
    CREATE TRIGGER IF NOT EXISTS session_output_fts_cleared AFTER UPDATE OF output ON sessions
    WHEN old.state != 'running' AND new.state != 'running' AND old.output != '' AND new.output = '' BEGIN
      INSERT INTO session_output_fts(session_output_fts, rowid, output) VALUES ('delete', old.rowid, old.output);
    END;
    CREATE TRIGGER IF NOT EXISTS session_output_fts_deleted AFTER DELETE ON sessions
    WHEN old.state != 'running' AND old.output != '' BEGIN
      INSERT INTO session_output_fts(session_output_fts, rowid, output) VALUES ('delete', old.rowid, old.output);
    END;
    `);
    if (!exists) db.exec("INSERT INTO session_output_fts(rowid, output) SELECT rowid, output FROM sessions WHERE state != 'running' AND output != ''");
  })();
}

function matchExpression(query: string): string | null {
  if (typeof query !== 'string' || query.length > 160) throw new Error('Suchbegriff muss höchstens 160 Zeichen lang sein.');
  const terms = query.normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu)
    ?.map((term) => term.toLocaleLowerCase('de-DE')).filter((term) => term.length >= 2).slice(0, 6) ?? [];
  return terms.length ? terms.map((term) => `"${term}"*`).join(' AND ') : null;
}

function readableSnippet(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 220);
}

/** Search all finished sessions in one project, including runs beyond the 200-row UI snapshot. */
export function searchSessionTranscripts(db: Database.Database, projectId: string, query: string): SessionSearchHit[] {
  if (typeof projectId !== 'string' || !/^[a-f0-9-]{36}$/i.test(projectId)) throw new Error('Ungültiges Projekt.');
  const expression = matchExpression(query);
  if (!expression) return [];
  const rows = db.prepare(`
    SELECT s.id AS sessionId, s.card_id AS cardId, c.title AS cardTitle,
           a.name AS agentName, s.started_at AS startedAt,
           snippet(session_output_fts, 0, '', '', '…', 18) AS snippet
    FROM session_output_fts
    JOIN sessions s ON s.rowid = session_output_fts.rowid
    JOIN cards c ON c.id = s.card_id
    JOIN agents a ON a.id = s.agent_id
    WHERE session_output_fts MATCH ? AND s.project_id = ? AND s.state != 'running'
    ORDER BY bm25(session_output_fts), s.started_at DESC
    LIMIT 15
  `).all(expression, projectId) as SearchRow[];
  return rows.map((row) => ({ ...row, snippet: readableSnippet(row.snippet) }));
}
