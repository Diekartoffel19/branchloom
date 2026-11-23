import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../../src/shared/types';
import { ProjectQueueEngine } from '../../src/main/queue';
import { detectQueueFailureLoop, failureSignature } from '../../src/main/loop-guard';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import type { SessionRunner } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-loop-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic loop project', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template' });
  const cards = Array.from({ length: 4 }, (_, i) => store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: `Card ${i + 1}` }));
  const template = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [templateCard.id], steps: [{ id: 'run', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
  const started: Session[] = [];
  const runner = { start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
    const session = store.createSession({ cardId, agentId }); started.push(session); return session;
  }, stop: () => undefined } as unknown as SessionRunner;
  const workflows = new WorkflowEngine(store, runner);
  const queue = new ProjectQueueEngine(store, workflows);
  return { store, project, cards, template, started, workflows, queue, agent };
}

describe('conservative queue failure loop', () => {
  it('uses a real nonzero exit and an exact error line, not ordinary output or a stopped process', () => {
    const row = { id: 'one', agentId: 'codex', state: 'failed', exitCode: 1, output: '\x1b[31mError: connection refused by test server\x1b[0m' } as Session;
    expect(failureSignature(row)).toContain('Error: connection refused by test server');
    expect(failureSignature({ ...row, output: 'No verified completion' })).toBeNull();
    expect(failureSignature({ ...row, state: 'stopped' })).toBeNull();
    expect(failureSignature({ ...row, exitCode: null })).toBeNull();
    expect(failureSignature({ ...row, exitCode: 0 })).toBeNull();
    expect(failureSignature({ ...row, output: 'Error: a different failure' })).not.toBe(failureSignature(row));
  });

  it('pauses only the running queue after three equal queue-linked failures; no fourth card starts', () => {
    const { store, project, cards, template, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    for (let index = 0; index < 3; index += 1) {
      expect(started[index]?.cardId).toBe(cards[index]?.id);
      const activeWorkflowId = store.projectQueue(project.id).activeWorkflowId!;
      store.appendOutput(started[index]!.id, 'Error: synthetic connection refused\n');
      const failed = store.finishSession(started[index]!.id, 'failed', 1);
      workflows.onSessionFinished(failed, 'Error: synthetic connection refused');
      queue.onSessionFinished(failed);
      expect(store.projectQueue(project.id).state).toBe('paused');
      if (index < 2) {
        expect(store.projectQueue(project.id).pauseReason).not.toContain('Drei aufeinanderfolgende');
        store.skipQueuedCard({ projectId: project.id, workflowId: activeWorkflowId, reason: 'Synthetischen Fehler geprüft' });
        queue.setState({ projectId: project.id, state: 'running' });
      }
    }
    expect(started).toHaveLength(3);
    expect(detectQueueFailureLoop(store, project.id)?.sessionIds).toEqual([started[2]!.id, started[1]!.id, started[0]!.id]);
    expect(store.projectQueue(project.id).pauseReason).toContain('Drei aufeinanderfolgende');
    expect(store.nextQueueCard(project.id)?.id).toBe(cards[3]?.id);
    store.close();
  });

  it('ignores a manually started failure and separates different queue errors', () => {
    const { store, project, cards, template, started, workflows, queue, agent } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const manual = store.createSession({ cardId: cards[3]!.id, agentId: agent.id });
    store.appendOutput(manual.id, 'Error: synthetic connection refused');
    const manualFailed = store.finishSession(manual.id, 'failed', 1);
    queue.onSessionFinished(manualFailed);
    expect(store.projectQueue(project.id).state).toBe('running');
    expect(detectQueueFailureLoop(store, project.id)).toBeNull();
    for (let index = 0; index < 3; index += 1) {
      const activeWorkflowId = store.projectQueue(project.id).activeWorkflowId!;
      store.appendOutput(started[index]!.id, index === 1 ? 'Error: a distinct test failure' : 'Error: synthetic connection refused');
      const failed = store.finishSession(started[index]!.id, 'failed', 1);
      workflows.onSessionFinished(failed, null);
      queue.onSessionFinished(failed);
      if (index < 2) {
        store.skipQueuedCard({ projectId: project.id, workflowId: activeWorkflowId, reason: 'Synthetischen Fehler geprüft' });
        queue.setState({ projectId: project.id, state: 'running' });
      }
    }
    expect(detectQueueFailureLoop(store, project.id)).toBeNull();
    expect(store.projectQueue(project.id).pauseReason).not.toContain('Drei aufeinanderfolgende');
    store.close();
  });
});
