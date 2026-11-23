import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CreateReviewRuleFromComment, ReviewRule, ReviewRuleSource, UpdateReviewRule } from '../shared/review-rules';
import type { StudioStore } from './store';

const MAX_RULES = 30;
const MAX_BODY = 2_000;
const MAX_PROMPT_RULES = 10;
const MAX_PROMPT_CHARS = 4_000;

type RuleRow = { id: string; project_id: string; body: string; enabled: number; source_kind: ReviewRuleSource; source_id: string; source_label: string; created_at: string; updated_at: string };
type SourceRow = { project_id: string; body: string; source_label: string };
const ruleOf = (row: RuleRow): ReviewRule => ({ id: row.id, projectId: row.project_id, body: row.body, enabled: row.enabled === 1,
  sourceKind: row.source_kind, sourceId: row.source_id, sourceLabel: row.source_label, createdAt: row.created_at, updatedAt: row.updated_at });

export function installReviewRules(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS review_rules (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    body TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    source_kind TEXT NOT NULL CHECK(source_kind IN ('plan','diff')),
    source_id TEXT NOT NULL, source_label TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(source_kind, source_id)
  );
  CREATE INDEX IF NOT EXISTS idx_review_rules_project ON review_rules(project_id, updated_at DESC);`);
}

function sourceFor(store: StudioStore, kind: ReviewRuleSource, id: string): SourceRow | undefined {
  if (kind === 'plan') return store.db.prepare(`SELECT p.project_id, c.body,
    'Planzeile ' || c.line || ': ' || substr(c.text, 1, 100) AS source_label
    FROM plan_comments c JOIN reviewed_plans p ON p.id = c.plan_id WHERE c.id = ?`).get(id) as SourceRow | undefined;
  return store.db.prepare(`SELECT c.project_id, r.body,
    'Diff ' || r.file_path || ':' || r.line AS source_label
    FROM review_comments r JOIN cards c ON c.id = r.card_id WHERE r.id = ?`).get(id) as SourceRow | undefined;
}

function checkedBody(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_BODY || value.includes('\0')) throw new Error('Projektregel muss 1 bis 2000 Zeichen enthalten.');
  return value.trim();
}

export function listReviewRules(store: StudioStore, projectId: string): ReviewRule[] {
  store.project(projectId);
  return (store.db.prepare('SELECT * FROM review_rules WHERE project_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(projectId, MAX_RULES + 1) as RuleRow[]).map(ruleOf);
}

export function createReviewRuleFromComment(store: StudioStore, input: CreateReviewRuleFromComment): ReviewRule {
  if (!input || typeof input.projectId !== 'string' || (input.sourceKind !== 'plan' && input.sourceKind !== 'diff')
    || typeof input.sourceId !== 'string') throw new Error('Ungültige Review-Quelle.');
  return store.db.transaction(() => {
    store.project(input.projectId);
    const source = sourceFor(store, input.sourceKind, input.sourceId);
    if (!source || source.project_id !== input.projectId) throw new Error('Review-Kommentar gehört nicht zu diesem Projekt.');
    const existing = store.db.prepare('SELECT * FROM review_rules WHERE source_kind = ? AND source_id = ?').get(input.sourceKind, input.sourceId) as RuleRow | undefined;
    if (existing) return ruleOf(existing);
    const body = checkedBody(source.body);
    const count = store.db.prepare('SELECT COUNT(*) AS count FROM review_rules WHERE project_id = ?').get(input.projectId) as { count: number };
    if (count.count >= MAX_RULES) throw new Error('Maximal 30 Projektregeln. Alte Regeln zuerst entfernen.');
    const id = randomUUID();
    const at = new Date().toISOString();
    store.db.prepare('INSERT INTO review_rules VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)')
      .run(id, input.projectId, body, input.sourceKind, input.sourceId, source.source_label, at, at);
    return ruleOf(store.db.prepare('SELECT * FROM review_rules WHERE id = ?').get(id) as RuleRow);
  })();
}

export function updateReviewRule(store: StudioStore, input: UpdateReviewRule): ReviewRule {
  if (!input || typeof input.projectId !== 'string' || typeof input.id !== 'string') throw new Error('Ungültige Projektregel.');
  return store.db.transaction(() => {
    const before = store.db.prepare('SELECT * FROM review_rules WHERE id = ? AND project_id = ?').get(input.id, input.projectId) as RuleRow | undefined;
    if (!before) throw new Error('Projektregel nicht gefunden.');
    if (input.body === undefined && input.enabled === undefined) throw new Error('Keine Regeländerung angegeben.');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Ungültiger Regelstatus.');
    const body = input.body === undefined ? before.body : checkedBody(input.body);
    store.db.prepare('UPDATE review_rules SET body = ?, enabled = ?, updated_at = ? WHERE id = ? AND project_id = ?')
      .run(body, input.enabled === undefined ? before.enabled : Number(input.enabled), new Date().toISOString(), input.id, input.projectId);
    return ruleOf(store.db.prepare('SELECT * FROM review_rules WHERE id = ?').get(input.id) as RuleRow);
  })();
}

export function deleteReviewRule(store: StudioStore, input: { projectId: string; id: string }): void {
  if (!input || typeof input.projectId !== 'string' || typeof input.id !== 'string') throw new Error('Ungültige Projektregel.');
  const result = store.db.prepare('DELETE FROM review_rules WHERE id = ? AND project_id = ?').run(input.id, input.projectId);
  if (!result.changes) throw new Error('Projektregel nicht gefunden.');
}

/** Only explicitly approved, enabled rules enter the read-only planner prompt. */
export function reviewRulePromptContext(store: StudioStore, projectId: string): { text: string; included: number; total: number } {
  const enabled = listReviewRules(store, projectId).filter((rule) => rule.enabled);
  const chosen: Array<{ source: string; rule: string }> = [];
  let text = '';
  for (const rule of enabled) {
    if (chosen.length >= MAX_PROMPT_RULES) break;
    const candidate = [...chosen, { source: `${rule.sourceKind}:${rule.sourceId}`, rule: rule.body }];
    const serialized = JSON.stringify(candidate);
    if (serialized.length > MAX_PROMPT_CHARS) continue;
    chosen.push({ source: `${rule.sourceKind}:${rule.sourceId}`, rule: rule.body }); text = serialized;
  }
  return { text, included: chosen.length, total: enabled.length };
}
