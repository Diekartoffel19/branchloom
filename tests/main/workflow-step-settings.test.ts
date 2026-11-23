import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { buildAgentArgs, SessionRunner, stepLaunchOverrides } from '../../src/main/cli';
import { WorkflowEngine } from '../../src/main/workflows';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-step-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[2]!;
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic task' });
  const codex = store.agents().find((agent) => agent.kind === 'codex')!;
  return { root, dbPath, store, project, column, card, codex };
}

describe('workflow step model and effort', () => {
  it('inherits missing fields and keeps a different agent independent of column settings', () => {
    const { store, column, codex } = fixture();
    try {
      store.updateColumn({ id: column.id, agentId: codex.id, model: 'column-model', effort: 'high' });
      const configured = store.column(column.id);
      expect(stepLaunchOverrides(configured, codex, { model: null, effort: null })).toEqual({ model: 'column-model', effort: 'high' });
      expect(stepLaunchOverrides(configured, codex, { model: 'step-model', effort: null })).toEqual({ model: 'step-model', effort: 'high' });
      const other = store.saveAgent({ name: 'Other Codex', kind: 'codex', command: process.execPath, args: [], model: 'profile-model', enabled: true });
      const independent = stepLaunchOverrides(configured, other, { model: null, effort: null });
      expect(independent).toEqual({ model: null, effort: null });
      expect(buildAgentArgs(other, 'Work', 'one-shot', undefined, independent)).toContain('profile-model');
      expect(buildAgentArgs(other, 'Work', 'one-shot', undefined, independent)).not.toContain('column-model');
    } finally { store.close(); }
  });

  it('persists an edited step across restart and reads old step JSON with defaults', () => {
    const { store, dbPath, project, column, card, codex } = fixture();
    const first = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [card.id], steps: [{ id: 'step', columnId: column.id, agentId: codex.id, model: 'model-a', effort: 'high', requireApproval: false }] });
    expect(first.steps[0]).toMatchObject({ model: 'model-a', effort: 'high' });
    store.updateDraftWorkflow({ id: first.id, name: 'Route', cardIds: [card.id], steps: [{ id: 'step', columnId: column.id, agentId: codex.id, model: 'model-b', effort: 'low', requireApproval: false }] });
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(first.id).steps[0]).toMatchObject({ model: 'model-b', effort: 'low' });
    reopened.db.prepare('UPDATE workflows SET steps_json = ? WHERE id = ?').run(JSON.stringify([{ id: 'step', columnId: column.id, agentId: codex.id, requireApproval: false }]), first.id);
    expect(reopened.workflow(first.id).steps[0]).toMatchObject({ model: null, effort: null });
    reopened.close();
  });

  it('copies model and effort from a queue template to the claimed card', () => {
    const { store, project, column, card, codex } = fixture();
    try {
      const template = store.createWorkflow({ projectId: project.id, name: 'Template', cardIds: [card.id], steps: [{ id: 'template-step', columnId: column.id, agentId: codex.id, model: 'queue-model', effort: 'medium', requireApproval: false }] });
      const todo = store.snapshot(project.id).columns[0]!;
      const queued = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Next task' });
      store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id, activeWorkflowId: null, pauseReason: null });
      const claimed = store.claimQueueCard(project.id, queued.id, template.id);
      expect(claimed.steps[0]).toMatchObject({ model: 'queue-model', effort: 'medium', agentId: codex.id });
      expect(claimed.steps[0]?.id).not.toBe('template-step');
    } finally { store.close(); }
  });

  it('rejects invalid or unsupported step overrides without changing a draft', () => {
    const { store, project, column, card, codex } = fixture();
    try {
      const flow = store.createWorkflow({ projectId: project.id, name: 'Safe', cardIds: [card.id], steps: [{ id: 'step', columnId: column.id, agentId: codex.id, requireApproval: false }] });
      const step = { id: 'step', columnId: column.id, agentId: codex.id, requireApproval: false };
      const update = (extra: Record<string, unknown>) => store.updateDraftWorkflow({ id: flow.id, name: 'Changed', cardIds: [card.id], steps: [{ ...step, ...extra }] });
      expect(() => update({ model: '--override' })).toThrow('Schritt-Modell');
      expect(() => update({ effort: 'impossible' })).toThrow('Schritt-Effort');
      expect(() => update({ agentId: null, model: 'model-a' })).toThrow('Schritt-Agenten');
      const gemini = store.agents().find((agent) => agent.kind === 'gemini')!;
      expect(() => update({ agentId: gemini.id, effort: 'high' })).toThrow('nur für Codex');
      const antigravity = store.saveAgent({ name: 'Antigravity', kind: 'antigravity', command: process.execPath, args: [], model: null, enabled: true });
      expect(() => update({ agentId: antigravity.id, effort: 'ultra' })).toThrow('max');
      const custom = store.saveAgent({ name: 'Custom', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
      expect(() => update({ agentId: custom.id, model: 'model-a' })).toThrow('Agentenprofil');
      expect(store.workflow(flow.id).name).toBe('Safe');
      expect(store.workflow(flow.id).steps[0]).toMatchObject({ model: null, effort: null });
    } finally { store.close(); }
  });

  it('passes explicit step values through a real local PTY and completes the route', async () => {
    const { root, store, project, column, card } = fixture();
    const script = join(root, 'synthetic-agent.cjs');
    writeFileSync(script, 'console.log("STEP_ARGS=" + JSON.stringify(process.argv.slice(2))); console.log("[JARVIS_STEP_DONE]");');
    const agent = store.saveAgent({ name: 'Synthetic Antigravity', kind: 'antigravity', command: process.execPath, args: [script], model: null, enabled: true });
    store.updateColumn({ id: column.id, agentId: agent.id, model: 'column-model', effort: 'low' });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Run', cardIds: [card.id], steps: [{ id: 'step', columnId: column.id, agentId: agent.id, model: 'step-model', effort: 'high', requireApproval: false }] });
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      for (let attempt = 0; attempt < 100 && store.workflow(flow.id).state === 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      const output = store.snapshot(project.id).sessions.find((session) => session.cardId === card.id)?.output ?? '';
      expect(store.workflow(flow.id).state).toBe('done');
      expect(output).toContain('STEP_ARGS=');
      expect(output).toContain('"--model","step-model","--effort","high"');
      expect(output).not.toContain('"column-model"');
    } finally { runner.dispose(); store.close(); }
  }, 15_000);
});
