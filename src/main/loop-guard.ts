import type { Session } from '../shared/types';
import type { StudioStore } from './store';

type FailureRow = Pick<Session, 'id' | 'agentId' | 'state' | 'exitCode' | 'output'>;

const stripTerminalCodes = (value: string): string => value
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  .replace(/\r/g, '');

/** A conservative signature from an actual failed CLI process, never from a model's completion claim. */
export function failureSignature(row: FailureRow): string | null {
  if (row.state !== 'failed' || row.exitCode === null || row.exitCode === 0) return null;
  const lines = stripTerminalCodes(row.output).split('\n').slice(-80).map((line) => line.trim().replace(/\s+/g, ' '));
  const detail = lines.reverse().find((line) => line.length >= 12 && line.length <= 500
    && /^(?:error\b|fatal\b|exception\b|failed\b|npm err!|[\w.]+error:)/i.test(line));
  return detail ? `${row.agentId}\u0000${row.exitCode}\u0000${detail}` : null;
}

export interface QueueFailureLoop { sessionIds: [string, string, string]; exitCode: number; excerpt: string }

/** The three latest queue-linked sessions must all have the exact same structured failure line. */
export function detectQueueFailureLoop(store: StudioStore, projectId: string): QueueFailureLoop | null {
  store.project(projectId);
  const rows = store.db.prepare(`SELECT s.id, s.agent_id AS agentId, s.state, s.exit_code AS exitCode,
    substr(s.output, -8192) AS output
    FROM sessions s
    JOIN workflow_progress p ON p.session_id = s.id
    JOIN queue_runs q ON q.workflow_id = p.workflow_id AND q.project_id = s.project_id
    WHERE s.project_id = ?
    ORDER BY coalesce(s.ended_at, s.started_at) DESC, s.rowid DESC LIMIT 3`).all(projectId) as FailureRow[];
  if (rows.length !== 3) return null;
  const signatures = rows.map(failureSignature);
  if (!signatures[0] || signatures.some((key) => key !== signatures[0])) return null;
  const excerpt = signatures[0].split('\u0000')[2]!;
  return { sessionIds: [rows[0]!.id, rows[1]!.id, rows[2]!.id], exitCode: rows[0]!.exitCode!, excerpt: excerpt.slice(0, 180) };
}
