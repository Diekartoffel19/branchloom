import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentHandoffPreview, AgentHandoffReceipt, AgentHandoffSelection, HandoffPassage } from '../shared/agent-handoff';
import type { Session } from '../shared/types';
import { cardCriteria } from './card-acceptance';
import { cardContextReferences } from './card-context';
import { cardQaReports } from './card-qa';
import { captureRunGit, sessionRunEvidence } from './session-evidence';
import { reviewCardWorktree } from './git-worktree';
import { assertSafeModelContext, redactSensitiveText } from './sensitive-content';
import type { SessionRunner } from './cli';
import type { StudioStore } from './store';

const MAX_PASSAGE = 1_800;
const MAX_TOTAL = 10_000;
const MAX_AGE_MS = 15 * 60_000;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export function installAgentHandoffs(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_handoffs (
    token TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    target_agent_id TEXT NOT NULL REFERENCES agents(id),
    target_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    selected_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('starting', 'started', 'failed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_handoffs_session ON agent_handoffs(target_session_id);`);
}

function passage(id: string, title: string, source: string, sourceAt: string, raw: string, selected: boolean, revision = ''): HandoffPassage {
  const redaction = redactSensitiveText(raw);
  const truncated = redaction.text.length > MAX_PASSAGE;
  return { id, title, source, sourceAt, text: truncated ? `${redaction.text.slice(0, MAX_PASSAGE)}\n[gekürzt]` : redaction.text,
    fingerprint: hash(JSON.stringify([id, raw, revision])), selected, truncated, redacted: redaction.redacted };
}

function contextTarget(kind: string, target: string, label?: string | null): string {
  if (kind === 'design') return label || 'Gespeicherter Design-Beleg';
  if (kind !== 'url') return target;
  try { const url = new URL(target); return `${url.origin}${url.pathname}`; }
  catch { return '[ungültige URL]'; }
}

function checkedSource(store: StudioStore, input: { projectId: string; cardId: string; sourceSessionId: string; targetAgentId: string }) {
  if (!input || typeof input.projectId !== 'string' || typeof input.cardId !== 'string' || typeof input.sourceSessionId !== 'string' || typeof input.targetAgentId !== 'string') throw new Error('Ungültige Agentenwechsel-Anfrage.');
  const card = store.card(input.cardId);
  if (card.projectId !== input.projectId) throw new Error('Karte gehört nicht zu diesem Projekt.');
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const source = store.sessionForProject(input.projectId, input.sourceSessionId);
  if (source.cardId !== card.id) throw new Error('Quelllauf gehört nicht zu dieser Karte.');
  if (source.state === 'running') throw new Error('Laufenden Quellagenten zuerst beenden.');
  if (store.interruptedSessions(input.projectId).some((item) => item.sessionId === source.id)) throw new Error('Unterbrochenen Quelllauf zuerst in der Decision Inbox prüfen.');
  if (store.projectQueue(input.projectId).state === 'running') throw new Error('Projektwarteschlange vor dem Agentenwechsel pausieren.');
  if (store.latestSession(card.id)?.id !== source.id) throw new Error('Inzwischen wurde ein neuer Kartenlauf gestartet. Paket neu vorbereiten.');
  const target = store.agent(input.targetAgentId);
  if (!target.enabled || target.id === source.agentId) throw new Error('Wähle einen anderen aktivierten CLI-Agenten.');
  return { card, source, target };
}

function sourcePassages(store: StudioStore, input: { projectId: string; cardId: string; sourceSessionId: string; targetAgentId: string; useWorktree: boolean }): HandoffPassage[] {
  const { card, source } = checkedSource(store, input);
  const result: HandoffPassage[] = [];
  result.push(passage('card', 'Kartenziel', 'Gespeicherte Karte', card.updatedAt,
    `${card.title}\n\n${card.description || '[Keine Beschreibung gespeichert]'}`, true));

  const criteria = cardCriteria(store, card.id);
  if (criteria.length) result.push(passage('criteria', 'Abnahmekriterien', 'Gespeicherte Kartenkriterien',
    criteria.reduce((last, item) => item.updatedAt > last ? item.updatedAt : last, criteria[0]!.updatedAt),
    criteria.slice(0, 8).map((item, index) => `${index + 1}. ${item.text} · ${item.evidence.filter((link) => link.currentForCriterion && link.sourceAvailable).length} aktuelle Quellenverweise`).join('\n')
      + (criteria.length > 8 ? `\n[${criteria.length - 8} weitere Kriterien nicht einbezogen]` : ''), true));

  const launch = sessionRunEvidence(store, { projectId: input.projectId, sessionId: source.id }).launch;
  const lastRunAt = [source.endedAt ?? source.startedAt, launch?.recordedAt, launch?.versionCheckedAt].filter((value): value is string => Boolean(value)).sort().at(-1)!;
  result.push(passage('last-run', 'Letzter Kartenlauf', 'Gespeicherte Sitzung und lokaler Startbeleg', lastRunAt,
    `Sitzung ${source.id}; Status ${source.state}; Exit-Code ${source.exitCode ?? 'unbekannt'}.\n` +
    (launch ? `Agent ${launch.agentName} (${launch.agentKind}); konfiguriertes Modell ${launch.configuredModel ?? 'nicht ermittelt'}; CLI-Version ${launch.versionCheck === 'ready' ? launch.version ?? 'ohne Ausgabe' : launch.versionCheck}; Git vor Start ${launch.git.head ?? 'unbekannt'}; Arbeitsbaum ${launch.git.dirty === null ? 'unbekannt' : launch.git.dirty ? 'geändert' : 'sauber'}; Eingabequellen ${launch.sources.join(', ') || 'keine'}.` : 'Für diesen älteren Lauf liegt kein Startbeleg vor.')
    + '\nTerminaltext und Modellverarbeitung wurden nicht ausgewertet.', true));

  const qa = cardQaReports(store, card.id).slice(0, 2);
  if (qa.length) result.push(passage('qa', 'Letzte Browser-QA', 'Gespeicherte Karten-QA-Berichte', qa[0]!.endedAt,
    qa.map((item) => `${item.endedAt}: ${item.status}; ${item.viewportWidth} × ${item.viewportHeight}; Bericht ${item.id}; ${item.diagnostics.length} Diagnosen.`).join('\n')
      + '\nDie Berichte beweisen keine Agenten-Testausführung und keine Bindung der ausgelieferten Seite an einen Commit.', true));

  const refs = cardContextReferences(store, card.id).slice(0, 8);
  if (refs.length) result.push(passage('references', 'Verknüpfte Quellen', 'Gespeicherte Karten-Kontextbezüge', refs.at(-1)!.addedAt,
    refs.map((item) => `${item.kind}: ${contextTarget(item.kind, item.target, item.label)} (${item.available ? 'lokal verfügbar' : 'nicht verfügbar'})`).join('\n')
      + '\nURL-Zugangsdaten, Suchparameter und Fragmente werden nicht übernommen. Datei-, Ordner- und Webseiteninhalte wurden nicht gelesen.', false,
    JSON.stringify(refs.map((item) => [item.id, item.kind, item.target, item.available, item.addedAt]))));

  const project = store.project(card.projectId);
  const git = captureRunGit(project.path, 'project');
  let gitText = `Projekt-Checkout: HEAD ${git.head ?? 'nicht verifiziert'}; Arbeitsbaum ${git.dirty === null ? 'unbekannt' : git.dirty ? 'geändert' : 'sauber'}.`;
  if (store.cardWorktree(card.id)) {
    try {
      const review = reviewCardWorktree(store, card.id);
      if (review) gitText += `\nKarten-Worktree: HEAD ${review.sourceHead}; ${review.sourceStatus.length} Statuszeilen; ${review.ahead} Commits vor und ${review.behind} hinter dem Projekt-Checkout.`;
    } catch { gitText += '\nKarten-Worktree konnte nicht erneut verifiziert werden.'; }
  } else if (input.useWorktree) gitText += '\nFür diese Karte ist noch kein Worktree gespeichert; er würde erst beim bestätigten Start angelegt.';
  result.push(passage('git', 'Git-Stand', 'Lesende lokale Git-Abfrage', git.checkedAt, gitText, true));

  const explicitQuestions = card.description.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('?')).slice(0, 3);
  const unchecked = criteria.filter((item) => !item.evidence.some((link) => link.currentForCriterion && link.sourceAvailable && link.sourceStatus === 'passed')).slice(0, 3);
  const openAt = unchecked.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, card.updatedAt);
  if (explicitQuestions.length || unchecked.length) result.push(passage('open-points', 'Offene Punkte', 'Fragen im Kartentext und fehlende aktuelle QA-Verweise', openAt,
    [...explicitQuestions.map((line) => `Frage im Kartentext: ${line}`), ...unchecked.map((item) => `Kriterium ohne aktuell verknüpfte bestandene QA: ${item.text}`)].join('\n')
      + '\nDiese Liste ist eine Quellenübersicht, keine automatische Entscheidung über Erledigung.', false));
  return result;
}

export function previewAgentHandoff(store: StudioStore, input: { projectId: string; cardId: string; sourceSessionId: string; targetAgentId: string; useWorktree: boolean }): AgentHandoffPreview {
  if (typeof input?.useWorktree !== 'boolean') throw new Error('Worktree-Auswahl fehlt.');
  return { token: randomUUID(), projectId: input.projectId, cardId: input.cardId, sourceSessionId: input.sourceSessionId,
    targetAgentId: input.targetAgentId, useWorktree: input.useWorktree, createdAt: new Date().toISOString(), passages: sourcePassages(store, input) };
}

export function startAgentHandoff(store: StudioStore, runner: SessionRunner, input: { preview: AgentHandoffPreview; selected: AgentHandoffSelection[] }): Session {
  const preview = input?.preview;
  if (!preview || !/^[0-9a-f-]{36}$/i.test(preview.token) || !Array.isArray(preview.passages) || typeof preview.createdAt !== 'string') throw new Error('Kontextpaket fehlt.');
  const age = Date.now() - Date.parse(preview.createdAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) throw new Error('Kontextpaket ist abgelaufen. Bitte neu vorbereiten.');
  const sourceInput = { projectId: preview.projectId, cardId: preview.cardId, sourceSessionId: preview.sourceSessionId, targetAgentId: preview.targetAgentId, useWorktree: preview.useWorktree };
  const fresh = sourcePassages(store, sourceInput);
  if (fresh.length !== preview.passages.length || fresh.some((item, index) => item.id !== preview.passages[index]?.id || item.fingerprint !== preview.passages[index]?.fingerprint)) throw new Error('Eine Quelle hat sich seit der Vorschau geändert. Paket neu vorbereiten.');
  if (!Array.isArray(input.selected) || !input.selected.length || input.selected.length > fresh.length) throw new Error('Wähle mindestens eine Paketpassage.');
  const ids = new Set<string>();
  let length = 0;
  const sections = input.selected.map((selection) => {
    const original = fresh.find((item) => item.id === selection?.id);
    if (!original || ids.has(original.id) || selection.fingerprint !== original.fingerprint || typeof selection.text !== 'string' || !selection.text.trim() || selection.text.length > MAX_PASSAGE + 200 || selection.text.includes('\0')) throw new Error('Ungültige oder veraltete Paketauswahl.');
    ids.add(original.id); length += selection.text.length;
    return { field: original.title, text: `### ${original.title}\nQuelle: ${original.source}; Stand: ${original.sourceAt}; ${selection.text === original.text ? 'Originalausschnitt' : 'vom Nutzer bearbeitet'}\n${selection.text.trim()}` };
  });
  if (length > MAX_TOTAL) throw new Error('Kontextpaket ist zu lang.');
  const prompt = `Arbeite an dieser Karte mit dem bewusst ausgewählten Kontextpaket. Prüfe Aussagen und Quellen selbst; ein alter Lauf oder QA-Bericht bestätigt keine Modellverarbeitung.\n\n${sections.map((item) => item.text).join('\n\n')}`;
  assertSafeModelContext([{ field: 'Kontextpaket', text: prompt }]);
  const createdAt = new Date().toISOString();
  const inserted = store.db.prepare(`INSERT OR IGNORE INTO agent_handoffs (token, project_id, card_id, source_session_id, target_agent_id, target_session_id, selected_json, content_sha256, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'starting', ?, ?)`).run(preview.token, preview.projectId, preview.cardId, preview.sourceSessionId, preview.targetAgentId,
      JSON.stringify(input.selected.map((item) => ({ id: item.id, fingerprint: item.fingerprint }))), hash(prompt), createdAt, createdAt);
  if (!inserted.changes) throw new Error('Dieses Kontextpaket wurde bereits verwendet. Bitte den Kartenlauf prüfen.');
  try {
    const session = runner.start({ cardId: preview.cardId, agentId: preview.targetAgentId, prompt, useWorktree: preview.useWorktree });
    store.db.prepare("UPDATE agent_handoffs SET target_session_id = ?, state = 'started', updated_at = ? WHERE token = ?")
      .run(session.id, new Date().toISOString(), preview.token);
    return session;
  } catch (error) {
    store.db.prepare("UPDATE agent_handoffs SET state = 'failed', updated_at = ? WHERE token = ?")
      .run(new Date().toISOString(), preview.token);
    throw error;
  }
}

export function agentHandoffReceipt(store: StudioStore, input: { projectId: string; sessionId: string }): AgentHandoffReceipt | null {
  const session = store.sessionForProject(input.projectId, input.sessionId);
  const row = store.db.prepare("SELECT * FROM agent_handoffs WHERE target_session_id = ? AND project_id = ? AND card_id = ? AND state = 'started'")
    .get(session.id, session.projectId, session.cardId) as { token: string; project_id: string; card_id: string; source_session_id: string; target_session_id: string; target_agent_id: string; selected_json: string; content_sha256: string; created_at: string } | undefined;
  return row ? { token: row.token, projectId: row.project_id, cardId: row.card_id, sourceSessionId: row.source_session_id,
    targetSessionId: row.target_session_id, targetAgentId: row.target_agent_id, selectedSources: JSON.parse(row.selected_json),
    contentSha256: row.content_sha256, startedAt: row.created_at } : null;
}
