import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { RunGitPoint, RunLaunchEvidence, RunLinkedQa, SessionRunEvidence, VersionCheck } from '../shared/session-evidence';
import type { StudioStore } from './store';

type LaunchRow = {
  session_id: string; agent_name: string; agent_kind: RunLaunchEvidence['agentKind']; mode: RunLaunchEvidence['mode'];
  configured_model: string | null; configured_effort: RunLaunchEvidence['configuredEffort']; profile_argument_count: number;
  sources_json: string; prompt_delivery: RunLaunchEvidence['promptDelivery']; git_scope: RunGitPoint['scope'];
  git_head: string | null; git_dirty: number | null; git_checked_at: string; version: string | null;
  version_check: VersionCheck; version_checked_at: string | null; recorded_at: string;
};
type QaRow = RunLinkedQa & { report_id: string; linked_at: string; started_at: string; ended_at: string; requested_url: string; viewport_width: number; viewport_height: number };

export function installSessionEvidence(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS session_run_evidence (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL, agent_kind TEXT NOT NULL, mode TEXT NOT NULL,
    configured_model TEXT, configured_effort TEXT, profile_argument_count INTEGER NOT NULL,
    sources_json TEXT NOT NULL, prompt_delivery TEXT NOT NULL,
    git_scope TEXT NOT NULL, git_head TEXT, git_dirty INTEGER, git_checked_at TEXT NOT NULL,
    version TEXT, version_check TEXT NOT NULL, version_checked_at TEXT, recorded_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_run_qa (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    report_id TEXT NOT NULL REFERENCES card_qa_reports(id) ON DELETE CASCADE,
    linked_at TEXT NOT NULL, PRIMARY KEY(session_id, report_id)
  );`);
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true', ...args], {
      cwd, encoding: 'utf8', timeout: 1200, maxBuffer: 64 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

/** Read only the checkout actually selected for the launch, before spawning its PTY. */
export function captureRunGit(cwd: string, scope: RunGitPoint['scope']): RunGitPoint {
  const checkedAt = new Date().toISOString();
  const first = git(cwd, ['rev-parse', '--verify', 'HEAD']);
  const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']);
  const second = git(cwd, ['rev-parse', '--verify', 'HEAD']);
  const head = first && first === second && /^[0-9a-f]{40,64}$/i.test(first) ? first : null;
  return { scope, head, dirty: head && status !== null ? Boolean(status) : null, checkedAt };
}

export function recordSessionLaunch(store: StudioStore, input: Omit<RunLaunchEvidence, 'version' | 'versionCheck' | 'versionCheckedAt' | 'recordedAt'>): void {
  store.session(input.sessionId);
  if (input.agentName.length > 80 || !Array.isArray(input.sources) || input.sources.length > 3) throw new Error('Ungültiger Laufbeleg.');
  store.db.prepare(`INSERT INTO session_run_evidence (session_id, agent_name, agent_kind, mode,
    configured_model, configured_effort, profile_argument_count, sources_json, prompt_delivery,
    git_scope, git_head, git_dirty, git_checked_at, version, version_check, version_checked_at, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unchecked', NULL, ?)`)
    .run(input.sessionId, input.agentName, input.agentKind, input.mode, input.configuredModel,
      input.configuredEffort, input.profileArgumentCount, JSON.stringify(input.sources), input.promptDelivery,
      input.git.scope, input.git.head, input.git.dirty === null ? null : Number(input.git.dirty), input.git.checkedAt, new Date().toISOString());
}

/** Called only for a known CLI after its bounded local --version check, never for custom programs. */
export function recordSessionVersion(store: StudioStore, sessionId: string, status: Exclude<VersionCheck, 'unchecked'>, version: string | null): void {
  if (!['ready', 'timeout', 'error'].includes(status) || (version && version.length > 160)) throw new Error('Ungültige CLI-Versionsprüfung.');
  store.db.prepare('UPDATE session_run_evidence SET version = ?, version_check = ?, version_checked_at = ? WHERE session_id = ?')
    .run(status === 'ready' ? version : null, status, new Date().toISOString(), sessionId);
}

/** Local PTY write returned without throwing. This does not prove CLI receipt or processing. */
export function recordSessionPromptWrite(store: StudioStore, sessionId: string): void {
  store.db.prepare("UPDATE session_run_evidence SET prompt_delivery = 'pty-written' WHERE session_id = ? AND prompt_delivery = 'pty-delayed'").run(sessionId);
}

function checkedSession(store: StudioStore, input: { projectId: string; sessionId: string }) {
  if (!input || typeof input.projectId !== 'string' || typeof input.sessionId !== 'string') throw new Error('Ungültige Laufbelegabfrage.');
  return store.sessionForProject(input.projectId, input.sessionId);
}

export function sessionRunEvidence(store: StudioStore, input: { projectId: string; sessionId: string }): SessionRunEvidence {
  const session = checkedSession(store, input);
  const row = store.db.prepare('SELECT * FROM session_run_evidence WHERE session_id = ?').get(session.id) as LaunchRow | undefined;
  const qa = store.db.prepare(`SELECT link.report_id, link.linked_at, report.status, report.started_at, report.ended_at,
    report.requested_url, report.viewport_width, report.viewport_height FROM session_run_qa link
    JOIN card_qa_reports report ON report.id = link.report_id AND report.card_id = ? AND report.project_id = ?
    WHERE link.session_id = ? ORDER BY link.linked_at DESC, link.report_id`).all(session.cardId, session.projectId, session.id) as QaRow[];
  return {
    sessionId: session.id, projectId: session.projectId, cardId: session.cardId,
    launch: row ? {
      sessionId: row.session_id, agentName: row.agent_name, agentKind: row.agent_kind, mode: row.mode,
      configuredModel: row.configured_model, configuredEffort: row.configured_effort,
      profileArgumentCount: row.profile_argument_count, sources: JSON.parse(row.sources_json) as RunLaunchEvidence['sources'],
      promptDelivery: row.prompt_delivery, git: { scope: row.git_scope, head: row.git_head, dirty: row.git_dirty === null ? null : row.git_dirty === 1, checkedAt: row.git_checked_at },
      version: row.version, versionCheck: row.version_check, versionCheckedAt: row.version_checked_at, recordedAt: row.recorded_at,
    } : null,
    linkedQa: qa.map((item) => ({ reportId: item.report_id, linkedAt: item.linked_at, status: item.status,
      startedAt: item.started_at, endedAt: item.ended_at, requestedUrl: item.requested_url,
      viewportWidth: item.viewport_width, viewportHeight: item.viewport_height })),
  };
}

export function linkSessionQa(store: StudioStore, input: { projectId: string; sessionId: string; reportId: string }): SessionRunEvidence {
  const session = checkedSession(store, input);
  if (store.card(session.cardId).archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  if (typeof input.reportId !== 'string' || !input.reportId) throw new Error('QA-Bericht fehlt.');
  const report = store.db.prepare('SELECT started_at FROM card_qa_reports WHERE id = ? AND card_id = ? AND project_id = ?')
    .get(input.reportId, session.cardId, session.projectId) as { started_at: string } | undefined;
  if (!report) throw new Error('QA-Bericht gehört nicht zu diesem Kartenlauf.');
  if (report.started_at < session.startedAt) throw new Error('QA-Bericht wurde vor dem Agentenlauf gestartet.');
  const count = store.db.prepare('SELECT COUNT(*) AS n FROM session_run_qa WHERE session_id = ?').get(session.id) as { n: number };
  if (count.n >= 10) throw new Error('Höchstens zehn QA-Berichte pro Lauf.');
  const result = store.db.prepare('INSERT OR IGNORE INTO session_run_qa (session_id, report_id, linked_at) VALUES (?, ?, ?)')
    .run(session.id, input.reportId, new Date().toISOString());
  if (!result.changes) throw new Error('QA-Bericht ist diesem Lauf bereits zugeordnet.');
  return sessionRunEvidence(store, input);
}

export function unlinkSessionQa(store: StudioStore, input: { projectId: string; sessionId: string; reportId: string }): SessionRunEvidence {
  const session = checkedSession(store, input);
  if (store.card(session.cardId).archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const result = store.db.prepare('DELETE FROM session_run_qa WHERE session_id = ? AND report_id = ?').run(session.id, input.reportId);
  if (!result.changes) throw new Error('QA-Verweis ist diesem Lauf nicht zugeordnet.');
  return sessionRunEvidence(store, input);
}
