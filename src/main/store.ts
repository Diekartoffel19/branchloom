import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { AgentPreset, Card, CardPriority, Column, MemoryNote, Project, ProjectQueue, ProjectSnapshot, QueueState, Session, SessionSearchHit, SessionState, TrelloImportPreview, TrelloImportResult, Workflow, WorkflowAgentSettings, WorkflowProposal, WorkflowState, WorkflowStep } from '../shared/types';
import { cardLabels, cardPriority } from '../shared/card-metadata';
import { validateWorkflowProposal } from './workflow-proposal';
import { parseTrelloBoard } from './trello-import';
import { installSessionSearch, searchSessionTranscripts } from './session-search';

const now = (): string => new Date().toISOString();
const asBool = (value: number): boolean => value === 1;
const json = (value: unknown): string => JSON.stringify(value);
const parseArray = <T>(value: string): T[] => JSON.parse(value) as T[];
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
function trimmed(value: string, label: string, max = 200): string {
  const result = value.trim();
  if (!result || result.length > max || /\0/.test(result)) throw new Error(`${label} must be 1-${max} characters`);
  return result;
}
function optionalText(value: string, label: string, max = 30000): string {
  if (value.length > max || /\0/.test(value)) throw new Error(`${label} exceeds ${max} characters`);
  return value;
}

interface ProjectRow { id: string; name: string; path: string; created_at: string }
interface ColumnRow { id: string; project_id: string; name: string; position: number; auto_start: number; agent_id: string | null }
interface CardRow { id: string; project_id: string; column_id: string; title: string; description: string; priority: CardPriority; labels_json: string; position: number; created_at: string; updated_at: string; archived_at: string | null }
interface AgentRow { id: string; name: string; kind: AgentPreset['kind']; command: string; args_json: string; model: string | null; enabled: number }
interface SessionRow { id: string; project_id: string; card_id: string; agent_id: string; state: SessionState; started_at: string; ended_at: string | null; exit_code: number | null; output: string; worktree_path: string | null }
export interface CardWorktree { cardId: string; projectId: string; sourceRoot: string; path: string; branch: string; createdAt: string }
interface WorktreeRow { card_id: string; project_id: string; source_root: string; path: string; branch: string; created_at: string }
interface WorkflowRow { id: string; project_id: string; name: string; card_ids_json: string; steps_json: string; state: WorkflowState; current_step: number; created_at: string; updated_at: string }
interface QueueRow { project_id: string; state: QueueState; template_workflow_id: string | null; active_workflow_id: string | null; pause_reason: string | null; updated_at: string }
interface NoteRow { id: string; project_id: string; title: string; body: string; tags_json: string; links_json: string; created_at: string; updated_at: string }

const project = (row: ProjectRow): Project => ({ id: row.id, name: row.name, path: row.path, createdAt: row.created_at });
const column = (row: ColumnRow): Column => ({ id: row.id, projectId: row.project_id, name: row.name, position: row.position, autoStart: asBool(row.auto_start), agentId: row.agent_id });
const card = (row: CardRow): Card => ({ id: row.id, projectId: row.project_id, columnId: row.column_id, title: row.title, description: row.description, priority: row.priority, labels: parseArray<string>(row.labels_json), position: row.position, createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at });
const agent = (row: AgentRow): AgentPreset => ({ id: row.id, name: row.name, kind: row.kind, command: row.command, args: parseArray<string>(row.args_json), model: row.model, enabled: asBool(row.enabled) });
const session = (row: SessionRow): Session => ({ id: row.id, projectId: row.project_id, cardId: row.card_id, agentId: row.agent_id, state: row.state, startedAt: row.started_at, endedAt: row.ended_at, exitCode: row.exit_code, output: row.output, worktreePath: row.worktree_path });
const workflow = (row: WorkflowRow): Workflow => ({ id: row.id, projectId: row.project_id, name: row.name, cardIds: parseArray<string>(row.card_ids_json), steps: parseArray<WorkflowStep>(row.steps_json), state: row.state, currentStep: row.current_step, createdAt: row.created_at, updatedAt: row.updated_at });
const note = (row: NoteRow): MemoryNote => ({ id: row.id, projectId: row.project_id, title: row.title, body: row.body, tags: parseArray<string>(row.tags_json), links: parseArray<string>(row.links_json), createdAt: row.created_at, updatedAt: row.updated_at });

/** The only persisted state. The database lives in Electron userData, never inside a project or Git repository. */
export class StudioStore {
  readonly db: Database.Database;
  readonly worktreeBase: string;

  constructor(file: string) {
    this.worktreeBase = join(dirname(file), 'worktrees');
    this.db = new Database(file);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, command TEXT NOT NULL, args_json TEXT NOT NULL, model TEXT, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, agent_id TEXT REFERENCES agents(id));
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, column_id TEXT NOT NULL REFERENCES columns(id), title TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, priority TEXT NOT NULL DEFAULT 'none', labels_json TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, agent_id TEXT NOT NULL REFERENCES agents(id), state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, output TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, card_ids_json TEXT NOT NULL, steps_json TEXT NOT NULL, state TEXT NOT NULL, current_step INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_progress (workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, session_id TEXT REFERENCES sessions(id), state TEXT NOT NULL, PRIMARY KEY (workflow_id, step_index, card_id));
      CREATE TABLE IF NOT EXISTS workflow_step_approvals (workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY (workflow_id, step_index));
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, tags_json TEXT NOT NULL, links_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trello_imports (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_id TEXT NOT NULL, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, imported_at TEXT NOT NULL, PRIMARY KEY (project_id, source_id));
      CREATE TABLE IF NOT EXISTS card_worktrees (card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_root TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_queues (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, state TEXT NOT NULL, template_workflow_id TEXT REFERENCES workflows(id), active_workflow_id TEXT REFERENCES workflows(id), pause_reason TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queue_runs (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE, PRIMARY KEY (project_id, card_id));
      CREATE INDEX IF NOT EXISTS idx_columns_project ON columns(project_id, position);
      CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
      CREATE INDEX IF NOT EXISTS idx_sessions_card ON sessions(card_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id, state);
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, updated_at DESC);
    `);
    const sessionColumns = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessionColumns.some((item) => item.name === 'worktree_path')) this.db.exec('ALTER TABLE sessions ADD COLUMN worktree_path TEXT');
    const cardColumns = this.db.pragma('table_info(cards)') as Array<{ name: string }>;
    if (!cardColumns.some((item) => item.name === 'archived_at')) this.db.exec('ALTER TABLE cards ADD COLUMN archived_at TEXT');
    if (!cardColumns.some((item) => item.name === 'priority')) this.db.exec("ALTER TABLE cards ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'");
    if (!cardColumns.some((item) => item.name === 'labels_json')) this.db.exec("ALTER TABLE cards ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]'");
    installSessionSearch(this.db);
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM agents').get() as { count: number };
    if (count.count === 0) {
      for (const preset of [
        { name: 'Codex CLI', kind: 'codex', command: 'codex' },
        { name: 'Claude Code', kind: 'claude', command: 'claude' },
        { name: 'Gemini CLI', kind: 'gemini', command: 'gemini' },
      ] as const) this.saveAgent({ ...preset, args: [], model: null, enabled: true });
    }
    // A process crash cannot leave an old PTY marked live. Restarting an agent
    // is a deliberate action; a possibly completed external write is never replayed.
    this.db.prepare("UPDATE sessions SET state = 'failed', ended_at = ?, output = substr(output || ?, -200000) WHERE state = 'running'")
      .run(now(), '\n[Jarvis Studio restarted; this session was not replayed.]\n');
    this.db.prepare("UPDATE workflows SET state = 'paused', updated_at = ? WHERE state = 'running'").run(now());
    this.db.prepare("UPDATE workflow_progress SET state = 'needs_review' WHERE state = 'running'").run();
    this.db.prepare("UPDATE project_queues SET state = 'paused', pause_reason = 'App neu gestartet: aktiven Workflow und Agentenlauf prüfen.', updated_at = ? WHERE state = 'running'").run(now());
  }

  close(): void { this.db.close(); }
  projects(): Project[] { return (this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[]).map(project); }
  project(id: string): Project { return project(required(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined, 'Project not found')); }
  createProject(input: { name: string; path: string }): Project {
    const name = trimmed(input.name, 'Project name');
    if (!isAbsolute(input.path)) throw new Error('Choose an absolute project folder');
    const path = realpathSync(input.path);
    if (!statSync(path).isDirectory()) throw new Error('Project path must be a folder');
    const result: Project = { id: randomUUID(), name, path, createdAt: now() };
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(result.id, result.name, result.path, result.createdAt);
      for (const [position, columnName] of ['To Do', 'Planning', 'Executing', 'Review', 'Testing', 'Done'].entries()) {
        this.db.prepare('INSERT INTO columns VALUES (?, ?, ?, ?, 0, NULL)').run(randomUUID(), result.id, columnName, position);
      }
    })();
    return result;
  }

  snapshot(projectId: string): ProjectSnapshot {
    return {
      project: this.project(projectId),
      columns: (this.db.prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position').all(projectId) as ColumnRow[]).map(column),
      cards: (this.db.prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY position').all(projectId) as CardRow[]).map(card),
      agents: this.agents(),
      sessions: (this.db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 200').all(projectId) as SessionRow[]).map(session),
      workflows: (this.db.prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as WorkflowRow[]).map((row) => this.hydrateWorkflow(row)),
      notes: (this.db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as NoteRow[]).map(note),
      queue: this.projectQueue(projectId),
    };
  }

  projectQueue(projectId: string): ProjectQueue {
    this.project(projectId);
    const row = this.db.prepare('SELECT * FROM project_queues WHERE project_id = ?').get(projectId) as QueueRow | undefined;
    const completedCount = (this.db.prepare("SELECT COUNT(*) AS count FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id WHERE q.project_id = ? AND w.state = 'done' AND w.current_step >= json_array_length(w.steps_json)").get(projectId) as { count: number }).count;
    return row ? { projectId, state: row.state, templateWorkflowId: row.template_workflow_id, activeWorkflowId: row.active_workflow_id, pauseReason: row.pause_reason, completedCount, updatedAt: row.updated_at }
      : { projectId, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount, updatedAt: null };
  }
  saveProjectQueue(input: { projectId: string; state: QueueState; templateWorkflowId: string | null; activeWorkflowId: string | null; pauseReason: string | null }): ProjectQueue {
    this.project(input.projectId);
    if (!['off', 'running', 'paused'].includes(input.state)) throw new Error('Ungültiger Warteschlangen-Status.');
    if (input.templateWorkflowId && this.workflow(input.templateWorkflowId).projectId !== input.projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
    if (input.activeWorkflowId && this.workflow(input.activeWorkflowId).projectId !== input.projectId) throw new Error('Aktiver Workflow gehört zu einem anderen Projekt.');
    this.db.prepare('INSERT INTO project_queues (project_id, state, template_workflow_id, active_workflow_id, pause_reason, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET state=excluded.state, template_workflow_id=excluded.template_workflow_id, active_workflow_id=excluded.active_workflow_id, pause_reason=excluded.pause_reason, updated_at=excluded.updated_at').run(input.projectId, input.state, input.templateWorkflowId, input.activeWorkflowId, input.pauseReason, now());
    return this.projectQueue(input.projectId);
  }
  activeSessionForProject(projectId: string): Session | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE project_id = ? AND state = 'running' ORDER BY started_at DESC LIMIT 1").get(projectId) as SessionRow | undefined;
    return row ? session(row) : null;
  }
  nextQueueCard(projectId: string): Card | null {
    const snapshot = this.snapshot(projectId);
    const todo = snapshot.columns.find((item) => item.name.trim().toLowerCase() === 'to do');
    if (!todo) throw new Error('Für die Warteschlange fehlt eine To-Do-Spalte.');
    const linked = new Set(snapshot.workflows.flatMap((item) => item.cardIds));
    const claimed = new Set((this.db.prepare('SELECT card_id FROM queue_runs WHERE project_id = ?').all(projectId) as Array<{ card_id: string }>).map((item) => item.card_id));
    return snapshot.cards.filter((item) => item.columnId === todo.id && !item.archivedAt && !linked.has(item.id) && !claimed.has(item.id)).sort((a, b) => a.position - b.position)[0] ?? null;
  }
  claimQueueCard(projectId: string, cardId: string, templateWorkflowId: string): Workflow {
    return this.db.transaction(() => {
      const queue = this.projectQueue(projectId);
      if (queue.state !== 'running' || queue.activeWorkflowId || queue.templateWorkflowId !== templateWorkflowId) throw new Error('Warteschlange ist nicht bereit.');
      if (this.nextQueueCard(projectId)?.id !== cardId) throw new Error('Karte ist nicht die nächste freie To-Do-Karte.');
      const template = this.workflow(templateWorkflowId);
      if (template.projectId !== projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
      const card = this.card(cardId);
      const flow = this.createWorkflow({ projectId, name: `${template.name}: ${card.title}`.slice(0, 200), cardIds: [cardId], steps: template.steps.map((step) => ({ ...step, id: randomUUID() })) });
      this.db.prepare('INSERT INTO queue_runs (project_id, card_id, workflow_id) VALUES (?, ?, ?)').run(projectId, cardId, flow.id);
      this.saveProjectQueue({ projectId, state: 'running', templateWorkflowId, activeWorkflowId: flow.id, pauseReason: null });
      return flow;
    })();
  }

  column(id: string): Column { return column(required(this.db.prepare('SELECT * FROM columns WHERE id = ?').get(id) as ColumnRow | undefined, 'Column not found')); }
  createColumn(input: { projectId: string; name: string; autoStart?: boolean; agentId?: string | null }): Column {
    this.project(input.projectId);
    if (input.agentId) this.agent(input.agentId);
    const row: Column = { id: randomUUID(), projectId: input.projectId, name: trimmed(input.name, 'Column name'), position: (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM columns WHERE project_id = ?').get(input.projectId) as { next: number }).next, autoStart: input.autoStart === true, agentId: input.agentId ?? null };
    this.db.prepare('INSERT INTO columns VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.projectId, row.name, row.position, Number(row.autoStart), row.agentId);
    return row;
  }
  updateColumn(input: { id: string; name?: string; autoStart?: boolean; agentId?: string | null }): Column {
    const old = this.column(input.id);
    if (input.agentId) this.agent(input.agentId);
    const value = { ...old, name: input.name === undefined ? old.name : trimmed(input.name, 'Column name'), autoStart: input.autoStart ?? old.autoStart, agentId: input.agentId === undefined ? old.agentId : input.agentId };
    this.db.prepare('UPDATE columns SET name = ?, auto_start = ?, agent_id = ? WHERE id = ?').run(value.name, Number(value.autoStart), value.agentId, input.id);
    return value;
  }
  card(id: string): Card { return card(required(this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined, 'Card not found')); }
  createCard(input: { projectId: string; columnId: string; title: string; description?: string; priority?: CardPriority; labels?: string[] }): Card {
    const destination = this.column(input.columnId);
    if (destination.projectId !== input.projectId) throw new Error('Column belongs to another project');
    const stamp = now();
    const value: Card = { id: randomUUID(), projectId: input.projectId, columnId: input.columnId, title: trimmed(input.title, 'Card title'), description: optionalText(input.description ?? '', 'Card description'), priority: cardPriority(input.priority ?? 'none'), labels: cardLabels(input.labels ?? []), position: (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE column_id = ?').get(input.columnId) as { next: number }).next, createdAt: stamp, updatedAt: stamp, archivedAt: null };
    this.db.prepare('INSERT INTO cards (id, project_id, column_id, title, description, position, created_at, updated_at, archived_at, priority, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(value.id, value.projectId, value.columnId, value.title, value.description, value.position, value.createdAt, value.updatedAt, value.priority, json(value.labels));
    return value;
  }
  updateCard(input: { id: string; title?: string; description?: string; priority?: CardPriority; labels?: string[] }): Card {
    const old = this.card(input.id);
    if (old.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    const value = { ...old, title: input.title === undefined ? old.title : trimmed(input.title, 'Card title'), description: input.description === undefined ? old.description : optionalText(input.description, 'Card description'), priority: input.priority === undefined ? old.priority : cardPriority(input.priority), labels: input.labels === undefined ? old.labels : cardLabels(input.labels), updatedAt: now() };
    this.db.prepare('UPDATE cards SET title = ?, description = ?, priority = ?, labels_json = ?, updated_at = ? WHERE id = ?').run(value.title, value.description, value.priority, json(value.labels), value.updatedAt, input.id);
    return value;
  }
  moveCard(input: { id: string; columnId: string }): Card {
    const old = this.card(input.id);
    if (old.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    const destination = this.column(input.columnId);
    if (destination.projectId !== old.projectId) throw new Error('Cannot move a card to another project');
    const value = { ...old, columnId: destination.id, position: (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE column_id = ?').get(destination.id) as { next: number }).next, updatedAt: now() };
    this.db.prepare('UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?').run(value.columnId, value.position, value.updatedAt, input.id);
    return value;
  }
  setCardArchived(input: { id: string; archived: boolean }): Card {
    if (typeof input.archived !== 'boolean') throw new Error('Archivstatus muss wahr oder falsch sein.');
    const old = this.card(input.id);
    if (Boolean(old.archivedAt) === input.archived) return old;
    if (input.archived) {
      if (this.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running' LIMIT 1").get(old.id)) throw new Error('Laufende Agentensitzung zuerst stoppen.');
      const running = this.db.prepare("SELECT card_ids_json FROM workflows WHERE project_id = ? AND state = 'running'").all(old.projectId) as Array<{ card_ids_json: string }>;
      if (running.some((row) => parseArray<string>(row.card_ids_json).includes(old.id))) throw new Error('Laufenden Workflow mit dieser Karte zuerst pausieren.');
    }
    const stamp = now();
    this.db.prepare('UPDATE cards SET archived_at = ?, updated_at = ? WHERE id = ?').run(input.archived ? stamp : null, stamp, old.id);
    return this.card(old.id);
  }

  previewTrelloImport(input: { projectId: string; json: string }): TrelloImportPreview {
    this.project(input.projectId);
    const parsed = parseTrelloBoard(input.json);
    const imported = new Map((this.db.prepare('SELECT source_id, card_id FROM trello_imports WHERE project_id = ?').all(input.projectId) as Array<{ source_id: string; card_id: string }>).map((row) => [row.source_id, row.card_id]));
    const cards = parsed.cards.map((item) => ({ ...item, importedCardId: imported.get(item.sourceId) ?? null }));
    return {
      fingerprint: parsed.fingerprint,
      boardName: parsed.boardName,
      cards,
      total: cards.length,
      eligible: cards.filter((item) => item.eligible && !item.importedCardId).length,
      duplicates: cards.filter((item) => item.importedCardId !== null).length,
    };
  }

  acceptTrelloImport(input: { projectId: string; columnId: string; json: string; fingerprint: string; sourceIds: string[] }): TrelloImportResult {
    this.project(input.projectId);
    if (this.column(input.columnId).projectId !== input.projectId) throw new Error('Die Zielspalte gehört zu einem anderen Projekt.');
    const parsed = parseTrelloBoard(input.json);
    if (parsed.fingerprint !== input.fingerprint) throw new Error('Die Trello-Datei hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
    if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0 || input.sourceIds.length > parsed.cards.length || new Set(input.sourceIds).size !== input.sourceIds.length) throw new Error('Bitte gültige Karten-IDs einmalig auswählen.');
    const sourceCards = new Map(parsed.cards.map((item) => [item.sourceId, item]));
    for (const sourceId of input.sourceIds) {
      const item = sourceCards.get(sourceId);
      if (!item || !item.eligible) throw new Error('Eine gewählte Trello-Karte kann nicht importiert werden.');
    }
    return this.db.transaction(() => {
      const created: Card[] = [];
      const skippedDuplicateIds: string[] = [];
      const lookup = this.db.prepare('SELECT card_id FROM trello_imports WHERE project_id = ? AND source_id = ?');
      const insert = this.db.prepare('INSERT INTO trello_imports (project_id, source_id, card_id, imported_at) VALUES (?, ?, ?, ?)');
      for (const sourceId of input.sourceIds) {
        if (lookup.get(input.projectId, sourceId)) {
          skippedDuplicateIds.push(sourceId);
          continue;
        }
        const item = sourceCards.get(sourceId)!;
        // Direct store insertion intentionally bypasses the IPC move-to-column auto-start path.
        const added = this.createCard({ projectId: input.projectId, columnId: input.columnId, title: item.title, description: item.description, labels: item.labels });
        const newCard = item.archived ? this.setCardArchived({ id: added.id, archived: true }) : added;
        insert.run(input.projectId, sourceId, newCard.id, now());
        created.push(newCard);
      }
      return { created, skippedDuplicateIds };
    })();
  }

  agents(): AgentPreset[] { return (this.db.prepare('SELECT * FROM agents ORDER BY name').all() as AgentRow[]).map(agent); }
  agent(id: string): AgentPreset { return agent(required(this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined, 'Agent not found')); }
  saveAgent(input: Omit<AgentPreset, 'id'> & { id?: string }): AgentPreset {
    if (!['codex', 'claude', 'gemini', 'custom'].includes(input.kind)) throw new Error('Invalid agent kind');
    if (!Array.isArray(input.args) || input.args.length > 40 || input.args.some((arg) => typeof arg !== 'string' || arg.length > 1000 || /[\0\r\n]/.test(arg))) throw new Error('Invalid agent arguments');
    const command = trimmed(input.command, 'Agent command', 1000);
    if (/[\r\n]/.test(command)) throw new Error('Invalid agent command');
    const value: AgentPreset = { id: input.id ?? randomUUID(), name: trimmed(input.name, 'Agent name'), kind: input.kind, command, args: input.args, model: input.model ? trimmed(input.model, 'Model name', 200) : null, enabled: input.enabled === true };
    this.db.prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, command=excluded.command, args_json=excluded.args_json, model=excluded.model, enabled=excluded.enabled').run(value.id, value.name, value.kind, value.command, json(value.args), value.model, Number(value.enabled));
    return value;
  }

  latestSession(cardId: string): Session | null { const row = this.db.prepare('SELECT * FROM sessions WHERE card_id = ? ORDER BY started_at DESC LIMIT 1').get(cardId) as SessionRow | undefined; return row ? session(row) : null; }
  session(id: string): Session { return session(required(this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined, 'Session not found')); }
  sessionForProject(projectId: string, sessionId: string): Session {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ? AND project_id = ?').get(sessionId, projectId) as SessionRow | undefined;
    if (!row) throw new Error('Sitzung gehört zu einem anderen Projekt oder wurde entfernt.');
    return session(row);
  }
  searchSessionTranscripts(projectId: string, query: string): SessionSearchHit[] {
    this.project(projectId);
    return searchSessionTranscripts(this.db, projectId, query);
  }
  createSession(input: { cardId: string; agentId: string; worktreePath?: string | null }): Session {
    const source = this.card(input.cardId);
    if (source.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    this.agent(input.agentId);
    const value: Session = { id: randomUUID(), projectId: source.projectId, cardId: source.id, agentId: input.agentId, state: 'running', startedAt: now(), endedAt: null, exitCode: null, output: '', worktreePath: input.worktreePath ?? null };
    this.db.prepare('INSERT INTO sessions (id, project_id, card_id, agent_id, state, started_at, ended_at, exit_code, output, worktree_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.projectId, value.cardId, value.agentId, value.state, value.startedAt, value.endedAt, value.exitCode, value.output, value.worktreePath);
    return value;
  }
  cardWorktree(cardId: string): CardWorktree | null {
    const row = this.db.prepare('SELECT * FROM card_worktrees WHERE card_id = ?').get(cardId) as WorktreeRow | undefined;
    return row ? { cardId: row.card_id, projectId: row.project_id, sourceRoot: row.source_root, path: row.path, branch: row.branch, createdAt: row.created_at } : null;
  }
  saveCardWorktree(input: Omit<CardWorktree, 'createdAt'>): CardWorktree {
    const source = this.card(input.cardId);
    if (source.projectId !== input.projectId) throw new Error('Worktree card belongs to another project');
    const value: CardWorktree = { ...input, createdAt: now() };
    this.db.prepare('INSERT INTO card_worktrees (card_id, project_id, source_root, path, branch, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(value.cardId, value.projectId, value.sourceRoot, value.path, value.branch, value.createdAt);
    return value;
  }
  appendOutput(id: string, text: string): void {
    if (!text) return;
    this.db.prepare('UPDATE sessions SET output = substr(output || ?, -200000) WHERE id = ?').run(text.slice(-200000), id);
  }
  finishSession(id: string, state: Exclude<SessionState, 'running'>, exitCode: number | null): Session {
    this.db.prepare("UPDATE sessions SET state = ?, ended_at = ?, exit_code = ? WHERE id = ? AND state = 'running'").run(state, now(), exitCode, id);
    return this.session(id);
  }

  workflow(id: string): Workflow { return this.hydrateWorkflow(required(this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined, 'Workflow not found')); }
  private hydrateWorkflow(row: WorkflowRow): Workflow {
    const value = workflow(row);
    if (value.state !== 'paused') return value;
    const step = value.steps[value.currentStep];
    const progress = this.workflowProgress(value.id, value.currentStep);
    const pauseReason: NonNullable<Workflow['pauseReason']> = step?.requireApproval && !this.isStepApproved(value.id, value.currentStep)
      ? 'approval'
      : progress.some((item) => item.state === 'manual_wait')
        ? 'manual'
        : progress.some((item) => item.state === 'needs_review')
          ? 'review'
          : 'user';
    return { ...value, pauseReason };
  }
  createWorkflow(input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Workflow {
    this.project(input.projectId);
    if (input.cardIds.length === 0 || input.steps.length === 0 || input.steps.length > 30) throw new Error('Workflow needs cards and 1-30 steps');
    if (new Set(input.cardIds).size !== input.cardIds.length) throw new Error('Workflow has duplicate cards');
    for (const cardId of input.cardIds) {
      const item = this.card(cardId);
      if (item.projectId !== input.projectId) throw new Error('Workflow card belongs to another project');
      if (item.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    }
    for (const step of input.steps) {
      if (this.column(step.columnId).projectId !== input.projectId) throw new Error('Workflow column belongs to another project');
      if (step.agentId) this.agent(step.agentId);
    }
    const stamp = now();
    const value: Workflow = { id: randomUUID(), projectId: input.projectId, name: trimmed(input.name, 'Workflow name'), cardIds: input.cardIds, steps: input.steps, state: 'draft', currentStep: 0, createdAt: stamp, updatedAt: stamp };
    this.db.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.projectId, value.name, json(value.cardIds), json(value.steps), value.state, value.currentStep, value.createdAt, value.updatedAt);
    return value;
  }
  setWorkflowState(id: string, state: WorkflowState): Workflow {
    const current = this.workflow(id);
    if (!['draft', 'running', 'paused', 'done'].includes(state)) throw new Error('Invalid workflow state');
    if (state === 'running' && current.cardIds.some((cardId) => this.card(cardId).archivedAt)) throw new Error('Archivierte Workflow-Karte zuerst wiederherstellen.');
    this.db.prepare('UPDATE workflows SET state = ?, updated_at = ? WHERE id = ?').run(state, now(), id);
    return this.workflow(id);
  }
  workflowAgentSettings(): WorkflowAgentSettings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'workflow_agent'").get() as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as WorkflowAgentSettings : { agentId: null, model: null, effort: null };
  }
  saveWorkflowAgentSettings(input: WorkflowAgentSettings): WorkflowAgentSettings {
    if (input.agentId !== null && (typeof input.agentId !== 'string' || !this.agent(input.agentId).enabled)) throw new Error('Choose an enabled workflow agent');
    if (input.model !== null && (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || /[\r\n\0]/.test(input.model))) throw new Error('Invalid workflow model');
    if (input.effort !== null && !['low', 'medium', 'high'].includes(input.effort)) throw new Error('Invalid workflow effort');
    const value: WorkflowAgentSettings = { agentId: input.agentId, model: input.model?.trim() ?? null, effort: input.effort };
    this.db.prepare("INSERT INTO settings VALUES ('workflow_agent', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(json(value));
    return value;
  }
  acceptWorkflowProposal(input: { projectId: string; proposal: WorkflowProposal }): Workflow {
    const snapshot = this.snapshot(input.projectId);
    const proposal = validateWorkflowProposal(input.proposal, snapshot.columns);
    const todo = snapshot.columns.find((item) => item.name.toLowerCase() === 'to do') ?? snapshot.columns[0];
    if (!todo) throw new Error('Project has no board columns');
    return this.db.transaction(() => {
      const cards = proposal.cards.map((item) => this.createCard({ projectId: input.projectId, columnId: todo.id, title: item.title, description: item.description }));
      const steps: WorkflowStep[] = proposal.columnIds.map((id) => {
        const column = this.column(id);
        return { id: randomUUID(), columnId: id, agentId: column.agentId, requireApproval: !column.autoStart };
      });
      return this.createWorkflow({ projectId: input.projectId, name: proposal.title, cardIds: cards.map((item) => item.id), steps });
    })();
  }
  advanceWorkflow(id: string): Workflow {
    const old = this.workflow(id);
    const step = old.currentStep + 1;
    const state: WorkflowState = step >= old.steps.length ? 'done' : old.state;
    this.db.prepare('UPDATE workflows SET current_step = ?, state = ?, updated_at = ? WHERE id = ?').run(step, state, now(), id);
    return this.workflow(id);
  }
  ensureWorkflowProgress(id: string, stepIndex: number, cardIds: string[]): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO workflow_progress (workflow_id, step_index, card_id, session_id, state) VALUES (?, ?, ?, NULL, 'pending')");
    this.db.transaction(() => { for (const cardId of cardIds) insert.run(id, stepIndex, cardId); })();
  }
  workflowProgress(id: string, stepIndex: number): Array<{ cardId: string; sessionId: string | null; state: 'pending' | 'running' | 'complete' | 'needs_review' | 'manual_wait' }> {
    const rows = this.db.prepare('SELECT card_id, session_id, state FROM workflow_progress WHERE workflow_id = ? AND step_index = ? ORDER BY rowid').all(id, stepIndex) as Array<{ card_id: string; session_id: string | null; state: 'pending' | 'running' | 'complete' | 'needs_review' | 'manual_wait' }>;
    return rows.map((row) => ({ cardId: row.card_id, sessionId: row.session_id, state: row.state }));
  }
  beginWorkflowCard(id: string, stepIndex: number, cardId: string, sessionId: string): void {
    this.db.prepare("UPDATE workflow_progress SET state = 'running', session_id = ? WHERE workflow_id = ? AND step_index = ? AND card_id = ? AND state IN ('pending', 'needs_review')").run(sessionId, id, stepIndex, cardId);
  }
  markManualWait(id: string, stepIndex: number, cardId: string): void {
    this.db.prepare("UPDATE workflow_progress SET state = 'manual_wait' WHERE workflow_id = ? AND step_index = ? AND card_id = ? AND state = 'pending'").run(id, stepIndex, cardId);
  }
  confirmManualWait(id: string, stepIndex: number): boolean {
    const row = this.db.prepare("SELECT card_id FROM workflow_progress WHERE workflow_id = ? AND step_index = ? AND state = 'manual_wait' ORDER BY rowid LIMIT 1").get(id, stepIndex) as { card_id: string } | undefined;
    if (!row) return false;
    this.db.prepare("UPDATE workflow_progress SET state = 'complete' WHERE workflow_id = ? AND step_index = ? AND card_id = ? AND state = 'manual_wait'").run(id, stepIndex, row.card_id);
    return true;
  }
  isStepApproved(id: string, stepIndex: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM workflow_step_approvals WHERE workflow_id = ? AND step_index = ?').get(id, stepIndex));
  }
  approveStep(id: string, stepIndex: number): void {
    this.db.prepare('INSERT OR IGNORE INTO workflow_step_approvals VALUES (?, ?, ?)').run(id, stepIndex, now());
  }
  resetWorkflowReview(id: string, stepIndex: number): void {
    this.db.prepare("UPDATE workflow_progress SET state = 'pending', session_id = NULL WHERE workflow_id = ? AND step_index = ? AND state = 'needs_review'").run(id, stepIndex);
  }
  finishWorkflowCard(sessionId: string, complete: boolean): void {
    this.db.prepare("UPDATE workflow_progress SET state = ? WHERE session_id = ? AND state = 'running'").run(complete ? 'complete' : 'needs_review', sessionId);
  }
  workflowForSession(sessionId: string): { id: string; stepIndex: number; cardId: string } | null {
    const row = this.db.prepare('SELECT workflow_id, step_index, card_id FROM workflow_progress WHERE session_id = ?').get(sessionId) as { workflow_id: string; step_index: number; card_id: string } | undefined;
    return row ? { id: row.workflow_id, stepIndex: row.step_index, cardId: row.card_id } : null;
  }

  note(id: string): MemoryNote { return note(required(this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined, 'Memory note not found')); }
  saveNote(input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }): MemoryNote {
    this.project(input.projectId);
    if (!Array.isArray(input.tags) || !Array.isArray(input.links) || input.tags.length > 50 || input.links.length > 100) throw new Error('Too many tags or links');
    const tags = input.tags.map((tag) => trimmed(tag, 'Tag', 80));
    const links = input.links.map((link) => trimmed(link, 'Link', 200));
    if (input.id && this.note(input.id).projectId !== input.projectId) throw new Error('Note belongs to another project');
    const stamp = now();
    const value: MemoryNote = { id: input.id ?? randomUUID(), projectId: input.projectId, title: trimmed(input.title, 'Note title'), body: optionalText(input.body, 'Note body', 200000), tags, links, createdAt: input.id ? this.note(input.id).createdAt : stamp, updatedAt: stamp };
    this.db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, tags_json=excluded.tags_json, links_json=excluded.links_json, updated_at=excluded.updated_at').run(value.id, value.projectId, value.title, value.body, json(value.tags), json(value.links), value.createdAt, value.updatedAt);
    return value;
  }
  deleteNote(id: string): void { this.note(id); this.db.prepare('DELETE FROM notes WHERE id = ?').run(id); }
}
