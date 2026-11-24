import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const path of temporaryProjects.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Der synthetische Workflow erreichte den erwarteten Zustand nicht.');
}

describe('real local multi-step workflow', () => {
  it('keeps a failed second step reviewable after restart and resumes only on request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-multistep-'));
    temporaryProjects.push(root);
    const script = join(root, 'synthetic-agent.cjs');
    writeFileSync(script, String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
const effort = args[args.indexOf('--effort') + 1];
console.log('STEP_ARGS=' + JSON.stringify({ model, effort }));
if (model === 'review-model') {
  const counter = path.join(process.cwd(), 'review-attempts.txt');
  const previous = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(previous + 1));
  if (previous === 0) { console.log('Review needs a deliberate retry.'); process.exit(0); }
}
console.log('[JARVIS_STEP_DONE]');
`);
    const dbPath = join(root, 'studio.sqlite');
    const store = new StudioStore(dbPath);
    const project = store.createProject({ name: 'Synthetic multi-step', path: root });
    const columns = store.snapshot(project.id).columns;
    const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Synthetic task' });
    const agent = store.saveAgent({ name: 'Local synthetic agent', kind: 'antigravity', command: process.execPath, args: [script], model: null, enabled: true });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Implement then review', cardIds: [card.id], steps: [
      { id: 'implement', columnId: columns[2]!.id, agentId: agent.id, model: 'implement-model', effort: 'medium', requireApproval: false },
      { id: 'review', columnId: columns[3]!.id, agentId: agent.id, model: 'review-model', effort: 'high', requireApproval: false },
    ] });
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      await waitFor(() => store.workflow(flow.id).state === 'paused');
      expect(store.workflow(flow.id).currentStep).toBe(1);
      expect(store.workflow(flow.id).pauseReason).toBe('review');
      expect(store.workflowProgress(flow.id, 0)).toMatchObject([{ cardId: card.id, state: 'complete' }]);
      expect(store.workflowProgress(flow.id, 1)).toMatchObject([{ cardId: card.id, state: 'needs_review' }]);
      expect(store.card(card.id).columnId).toBe(columns[3]!.id);
      const sessions = store.snapshot(project.id).sessions.filter((item) => item.cardId === card.id);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((item) => item.state)).toEqual(['exited', 'exited']);
      expect(sessions.some((item) => item.output.includes('"model":"implement-model","effort":"medium"'))).toBe(true);
      expect(sessions.some((item) => item.output.includes('"model":"review-model","effort":"high"') && item.output.includes('Review needs a deliberate retry.'))).toBe(true);
    } finally { runner.dispose(); store.close(); }

    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(flow.id)).toMatchObject({ state: 'paused', currentStep: 1, pauseReason: 'review' });
    expect(reopened.workflowProgress(flow.id, 1)).toMatchObject([{ cardId: card.id, state: 'needs_review' }]);
    expect(reopened.snapshot(project.id).sessions.filter((item) => item.cardId === card.id)).toHaveLength(2);
    let resumedEngine!: WorkflowEngine;
    const resumedRunner = new SessionRunner(reopened, () => undefined, (session, finalMessage) => resumedEngine.onSessionFinished(session, finalMessage));
    resumedEngine = new WorkflowEngine(reopened, resumedRunner);
    try {
      resumedEngine.setState({ id: flow.id, state: 'running' });
      await waitFor(() => reopened.workflow(flow.id).state === 'done');
      expect(reopened.workflow(flow.id).currentStep).toBe(2);
      expect(reopened.workflowProgress(flow.id, 0)).toMatchObject([{ cardId: card.id, state: 'complete' }]);
      expect(reopened.workflowProgress(flow.id, 1)).toMatchObject([{ cardId: card.id, state: 'complete' }]);
      const sessions = reopened.snapshot(project.id).sessions.filter((item) => item.cardId === card.id);
      expect(sessions).toHaveLength(3);
      expect(sessions.filter((item) => item.output.includes('"model":"review-model","effort":"high"'))).toHaveLength(2);
      expect(sessions.some((item) => item.output.trimEnd().endsWith('[JARVIS_STEP_DONE]'))).toBe(true);
      expect(reopened.card(card.id).columnId).toBe(columns[3]!.id);
    } finally { resumedRunner.dispose(); reopened.close(); }
  }, 40_000);
});
