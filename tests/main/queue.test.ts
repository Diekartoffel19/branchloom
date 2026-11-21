import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../../src/shared/types';
import { DONE_MARKER, type SessionRunner } from '../../src/main/cli';
import { ProjectQueueEngine } from '../../src/main/queue';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-queue-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template only' });
  const first = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'First queued' });
  const second = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Second queued' });
  const template = store.createWorkflow({ projectId: project.id, name: 'Implement route', cardIds: [templateCard.id], steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
  const started: Session[] = [];
  const stopped: string[] = [];
  const runner = {
    start: ({ cardId, agentId }: { cardId: string; agentId: string }) => { const session = store.createSession({ cardId, agentId }); started.push(session); return session; },
    stop: (id: string) => { stopped.push(id); store.finishSession(id, 'stopped', null); },
  } as unknown as SessionRunner;
  const workflows = new WorkflowEngine(store, runner);
  const queue = new ProjectQueueEngine(store, workflows);
  return { store, dbPath, project, columns, template, first, second, started, stopped, workflows, queue };
}

describe('explicit durable project queue', () => {
  it('claims the user-reordered To-Do card first without starting on the reorder itself', () => {
    const { store, project, template, first, second, started, queue } = fixture();
    store.reorderCard({ id: second.id, direction: 'up' });
    expect(store.nextQueueCard(project.id)?.id).toBe(second.id);
    expect(started).toHaveLength(0);
    expect(store.projectQueue(project.id).state).toBe('off');
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(started.map((session) => session.cardId)).toEqual([second.id]);
    expect(store.card(first.id).columnId).toBe(store.snapshot(project.id).columns[0]?.id);
    store.close();
  });

  it('is off by default, requires a route and processes one free To-Do card at a time', () => {
    const { store, project, template, first, second, started, workflows, queue } = fixture();
    expect(store.projectQueue(project.id).state).toBe('off');
    expect(() => queue.setState({ projectId: project.id, state: 'running' })).toThrow('Vorlage');
    const active = queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(active.state).toBe('running');
    expect(started).toHaveLength(1);
    expect(started[0]?.cardId).toBe(first.id);
    expect(store.projectQueue(project.id).activeWorkflowId).not.toBe(template.id);
    expect(store.card(first.id).columnId).toBe(store.snapshot(project.id).columns[2]?.id);
    store.appendOutput(started[0]!.id, `Done\n${DONE_MARKER}`);
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(finished, `Done\n${DONE_MARKER}`);
    queue.onSessionFinished(finished);
    expect(started).toHaveLength(2);
    expect(started[1]?.cardId).toBe(second.id);
    expect(store.projectQueue(project.id).completedCount).toBe(1);
    expect(store.snapshot(project.id).sessions.filter((item) => item.state === 'running')).toHaveLength(1);
    store.close();
  });

  it('pauses on a missing completion gate and never starts the next card automatically', () => {
    const { store, project, template, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(finished, 'No verified completion');
    queue.onSessionFinished(finished);
    expect(store.projectQueue(project.id).state).toBe('paused');
    expect(store.projectQueue(project.id).pauseReason).toContain('prüfen');
    expect(started).toHaveLength(1);
    expect(() => queue.setState({ projectId: project.id, state: 'running' })).toThrow('nicht selbst erneut');
    store.close();
  });

  it('resumes a completed active workflow and claims exactly the next card', () => {
    const { store, project, template, second, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const completed = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(completed, `Done\n${DONE_MARKER}`);
    // Simulate a pause between workflow completion and queue reconciliation.
    expect(store.workflow(store.projectQueue(project.id).activeWorkflowId!).state).toBe('done');
    queue.setState({ projectId: project.id, state: 'paused' });
    expect(started).toHaveLength(1);
    const resumed = queue.setState({ projectId: project.id, state: 'running' });
    expect(resumed.state).toBe('running');
    expect(started).toHaveLength(2);
    expect(started[1]?.cardId).toBe(second.id);
    expect(store.projectQueue(project.id).completedCount).toBe(1);
    store.close();
  });

  it('stops the active agent on pause and preserves a reviewable workflow after restart', () => {
    const { store, dbPath, project, template, started, stopped, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    queue.setState({ projectId: project.id, state: 'paused' });
    expect(stopped).toEqual([started[0]!.id]);
    expect(store.workflow(activeId).state).toBe('paused');
    expect(store.workflowProgress(activeId, 0)[0]?.state).toBe('needs_review');
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.projectQueue(project.id).activeWorkflowId).toBe(activeId);
    expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    reopened.close();
  });

  it('pauses on app restart without replay even if a session was running at shutdown', () => {
    const { store, dbPath, project, template, started, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    store.close(); // Simulated app loss: no agent callback.
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.projectQueue(project.id).pauseReason).toContain('neu gestartet');
    expect(reopened.session(started[0]!.id).state).toBe('failed');
    expect(reopened.workflow(activeId).state).toBe('paused');
    const runner = { start: () => { throw new Error('Must not replay'); }, stop: () => undefined } as unknown as SessionRunner;
    const restoredQueue = new ProjectQueueEngine(reopened, new WorkflowEngine(reopened, runner));
    restoredQueue.onBoardChanged(project.id);
    expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    expect(() => restoredQueue.setState({ projectId: project.id, state: 'running' })).toThrow('nicht selbst erneut');
    reopened.close();
  });
});
