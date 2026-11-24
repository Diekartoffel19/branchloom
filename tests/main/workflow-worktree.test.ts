import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import { globalInboxItems } from '../../src/main/global-inbox';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}

function fixture(withGit = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-workflow-worktree-'));
  roots.push(root);
  const repository = join(root, 'repository');
  mkdirSync(repository);
  if (withGit) {
    git(repository, ['init', '-q']);
    writeFileSync(join(repository, 'tracked.txt'), 'original\n');
    git(repository, ['add', 'tracked.txt']);
    git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Initial']);
  }
  const dbPath = join(root, 'data', 'studio.sqlite');
  mkdirSync(join(root, 'data'));
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repository });
  const column = store.snapshot(project.id).columns[2]!;
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic task' });
  const script = join(root, 'agent.cjs');
  writeFileSync(script, 'require("node:fs").writeFileSync("worktree-result.txt", "synthetic"); console.log("[JARVIS_STEP_DONE]");\n');
  const agent = store.saveAgent({ name: 'Synthetic Node', kind: 'custom', command: process.execPath, args: [script], model: null, enabled: true });
  return { root, repository, dbPath, store, project, column, card, agent };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Der synthetische Workflow endete nicht rechtzeitig.');
}

describe('optional card worktree in workflow steps', () => {
  it('runs a workflow agent in the persisted card worktree and leaves the project checkout unchanged', async () => {
    const { repository, dbPath, store, project, column, card, agent } = fixture();
    const flow = store.createWorkflow({ projectId: project.id, name: 'Isolated step', cardIds: [card.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true },
    ] });
    expect(store.workflow(flow.id).steps[0]?.useWorktree).toBe(true);
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      await waitFor(() => store.workflow(flow.id).state === 'done');
      const session = store.snapshot(project.id).sessions.find((item) => item.cardId === card.id)!;
      expect(session.state).toBe('exited');
      expect(session.exitCode).toBe(0);
      expect(session.worktreePath).toBe(store.cardWorktree(card.id)?.path);
      expect(readFileSync(join(session.worktreePath!, 'worktree-result.txt'), 'utf8')).toBe('synthetic');
      expect(existsSync(join(repository, 'worktree-result.txt'))).toBe(false);
    } finally { runner.dispose(); store.close(); }
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(flow.id).steps[0]?.useWorktree).toBe(true);
    expect(reopened.workflow(flow.id).state).toBe('done');
    expect(reopened.snapshot(project.id).sessions[0]?.worktreePath).toBe(reopened.cardWorktree(card.id)?.path);
    reopened.close();
  }, 30_000);

  it('keeps old steps on the project checkout and rejects invalid or agentless worktree choices', async () => {
    const { repository, store, project, column, card, agent } = fixture(false);
    expect(() => store.createWorkflow({ projectId: project.id, name: 'Invalid', cardIds: [card.id], steps: [
      { id: 'invalid', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: 'yes' as unknown as boolean },
    ] })).toThrow('Ja/Nein');
    expect(() => store.createWorkflow({ projectId: project.id, name: 'Manual', cardIds: [card.id], steps: [
      { id: 'manual', columnId: column.id, agentId: null, requireApproval: false, useWorktree: true },
    ] })).toThrow('manueller Schritt');
    const flow = store.createWorkflow({ projectId: project.id, name: 'Legacy default', cardIds: [card.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false },
    ] });
    expect(store.workflow(flow.id).steps[0]?.useWorktree).toBe(false);
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      await waitFor(() => store.workflow(flow.id).state === 'done');
      expect(store.snapshot(project.id).sessions[0]?.worktreePath).toBeNull();
      expect(readFileSync(join(repository, 'worktree-result.txt'), 'utf8')).toBe('synthetic');
      expect(store.cardWorktree(card.id)).toBeNull();
    } finally { runner.dispose(); store.close(); }
  }, 30_000);

  it('persists a prelaunch Git error for review, then clears it only after a deliberate successful resume', async () => {
    const { repository, dbPath, store, project, column, card, agent } = fixture(false);
    const template = store.createWorkflow({ projectId: project.id, name: 'Queue route', cardIds: [card.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true },
    ] });
    const cloneCard = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Queued card' });
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id, activeWorkflowId: null, pauseReason: null });
    const cloned = store.claimQueueCard(project.id, cloneCard.id, template.id);
    expect(cloned.steps[0]?.useWorktree).toBe(true);
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const engine = new WorkflowEngine(store, runner);
    try {
      expect(() => engine.setState({ id: cloned.id, state: 'running' })).toThrow('Git-Repository');
      expect(store.workflow(cloned.id).state).toBe('paused');
      expect(store.workflow(cloned.id).startError?.message).toContain('Git-Repository');
      expect(globalInboxItems(store, { query: 'Git-Repository' }).items.some((item) => item.sourceId === cloned.id && item.detail.includes('Workflow-Start fehlgeschlagen'))).toBe(true);
      expect(store.latestSession(cloneCard.id)).toBeNull();
      expect(store.cardWorktree(cloneCard.id)).toBeNull();
    } finally { runner.dispose(); store.close(); }
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(cloned.id).startError?.message).toContain('Git-Repository');
    git(repository, ['init', '-q']);
    writeFileSync(join(repository, 'tracked.txt'), 'original\n');
    git(repository, ['add', 'tracked.txt']);
    git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Initial']);
    let resumedEngine!: WorkflowEngine;
    const resumedRunner = new SessionRunner(reopened, () => undefined, (session, finalMessage) => resumedEngine.onSessionFinished(session, finalMessage));
    resumedEngine = new WorkflowEngine(reopened, resumedRunner);
    try {
      resumedEngine.setState({ id: cloned.id, state: 'running' });
      await waitFor(() => reopened.workflow(cloned.id).state === 'done');
      expect(reopened.workflow(cloned.id).startError).toBeUndefined();
      expect(reopened.snapshot(project.id).sessions.find((item) => item.cardId === cloneCard.id)?.worktreePath).toBe(reopened.cardWorktree(cloneCard.id)?.path);
    } finally { resumedRunner.dispose(); reopened.close(); }
  }, 30_000);
});
