import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewAgentHandoff, startAgentHandoff, agentHandoffReceipt } from '../../src/main/agent-handoff';
import { SessionRunner } from '../../src/main/cli';
import { createCardCriterion } from '../../src/main/card-acceptance';
import { addCardContextReference } from '../../src/main/card-context';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
});

function fixture(description = 'Build the widget') {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-handoff-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic handoff', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Widget', description });
  const sourceAgent = store.saveAgent({ name: 'Previous local agent', kind: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'], model: null, enabled: true });
  const targetAgent = store.saveAgent({ name: 'Next local agent', kind: 'custom', command: process.execPath, args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], model: 'fixture-model', enabled: true });
  const source = store.createSession({ cardId: card.id, agentId: sourceAgent.id });
  store.finishSession(source.id, 'exited', 0);
  const args = { projectId: project.id, cardId: card.id, sourceSessionId: source.id, targetAgentId: targetAgent.id, useWorktree: false };
  const runner = new SessionRunner(store, () => undefined, () => undefined);
  return { root, dbPath, store, project, card, source, sourceAgent, targetAgent, args, runner };
}

function selection(preview: ReturnType<typeof previewAgentHandoff>) {
  return preview.passages.filter((item) => item.selected).map((item) => ({ id: item.id, fingerprint: item.fingerprint, text: item.text }));
}

describe('agent context handoff', () => {
  it('previews bounded sourced content with redaction and no agent start', () => {
    const f = fixture(`Synthetic token sk-${'a'.repeat(24)}\nWhen is it ready?`);
    try {
      createCardCriterion(f.store, { cardId: f.card.id, text: 'QA route loads' });
      const criterionAt = new Date(Date.now() + 60_000).toISOString();
      f.store.db.prepare('UPDATE card_acceptance_criteria SET updated_at = ? WHERE card_id = ?').run(criterionAt, f.card.id);
      addCardContextReference(f.store, { cardId: f.card.id, kind: 'url', target: 'https://example.org/guide?token=synthetic-private-value#section' });
      const before = f.store.snapshot(f.project.id).sessions.length;
      const preview = previewAgentHandoff(f.store, f.args);
      expect(preview.passages.map((item) => item.id)).toContain('open-points');
      expect(preview.passages.find((item) => item.id === 'open-points')?.sourceAt).toBe(criterionAt);
      expect(preview.passages.map((item) => item.id)).toContain('criteria');
      expect(preview.passages.find((item) => item.id === 'git')?.text).toContain('HEAD nicht verifiziert');
      expect(preview.passages.find((item) => item.id === 'card')?.text).toContain('[ausgeblendet: API-Schlüssel]');
      expect(preview.passages.find((item) => item.id === 'references')?.text).toContain('https://example.org/guide');
      expect(JSON.stringify(preview)).not.toContain('synthetic-private-value');
      expect(JSON.stringify(preview)).not.toContain(`sk-${'a'.repeat(24)}`);
      expect(f.store.snapshot(f.project.id).sessions).toHaveLength(before);
      expect(agentHandoffReceipt(f.store, { projectId: f.project.id, sessionId: f.source.id })).toBeNull();
      expect(() => startAgentHandoff(f.store, f.runner, { preview, selected: selection(preview) })).toThrow('Modellübergabe gesperrt');
      expect(f.store.snapshot(f.project.id).sessions).toHaveLength(before);
    } finally { f.runner.dispose(); f.store.close(); }
  });

  it('rejects stale, wrong-card and secret-edited packages before a new session', () => {
    const f = fixture();
    try {
      const preview = previewAgentHandoff(f.store, f.args);
      const other = f.store.createCard({ projectId: f.project.id, columnId: f.card.columnId, title: 'Other' });
      expect(() => previewAgentHandoff(f.store, { ...f.args, cardId: other.id })).toThrow('Quelllauf gehört nicht');
      expect(() => previewAgentHandoff(f.store, { ...f.args, targetAgentId: f.sourceAgent.id })).toThrow('anderen aktivierten');
      f.store.saveProjectQueue({ projectId: f.project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
      expect(() => previewAgentHandoff(f.store, f.args)).toThrow('Projektwarteschlange');
      f.store.saveProjectQueue({ projectId: f.project.id, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
      const edited = selection(preview);
      edited[0]!.text += `\nsk-${'b'.repeat(24)}`;
      expect(() => startAgentHandoff(f.store, f.runner, { preview, selected: edited })).toThrow('Modellübergabe gesperrt');
      f.store.updateCard({ id: f.card.id, description: 'Changed after preview' });
      expect(() => startAgentHandoff(f.store, f.runner, { preview, selected: selection(preview) })).toThrow('Quelle hat sich');
      expect(f.store.snapshot(f.project.id).sessions).toHaveLength(1);
    } finally { f.runner.dispose(); f.store.close(); }
  });

  it('starts once only after confirmation and keeps a source receipt across restart', async () => {
    const f = fixture();
    try {
      const reportId = randomUUID();
      f.store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, viewport_width, viewport_height)
        VALUES (?, ?, ?, 'http://127.0.0.1:3000/', NULL, ?, ?, 'failed', '[]', 390, 844)`)
        .run(reportId, f.card.id, f.project.id, new Date(Date.now() - 2000).toISOString(), new Date(Date.now() - 1000).toISOString());
      const preview = previewAgentHandoff(f.store, f.args);
      expect(preview.passages.find((item) => item.id === 'qa')?.text).toContain('failed');
      const selected = selection(preview);
      const run = startAgentHandoff(f.store, f.runner, { preview, selected });
      expect(run.agentId).toBe(f.targetAgent.id);
      expect(f.store.snapshot(f.project.id).sessions).toHaveLength(2);
      expect(() => startAgentHandoff(f.store, f.runner, { preview, selected })).toThrow();
      expect(f.store.snapshot(f.project.id).sessions).toHaveLength(2);
      const receipt = agentHandoffReceipt(f.store, { projectId: f.project.id, sessionId: run.id });
      expect(receipt?.selectedSources).toHaveLength(selected.length);
      expect(receipt?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain('Build the widget');
      f.runner.stop(run.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      f.runner.dispose(); f.store.close();
      const reopened = new StudioStore(f.dbPath);
      try { expect(agentHandoffReceipt(reopened, { projectId: f.project.id, sessionId: run.id })?.token).toBe(preview.token); }
      finally { reopened.close(); }
    } finally { f.runner.dispose(); if (f.store.db.open) f.store.close(); }
  }, 15_000);
});
