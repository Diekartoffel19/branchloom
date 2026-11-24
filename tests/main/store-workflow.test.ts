import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../../src/shared/types';
import { StudioStore } from '../../src/main/store';
import { hasCompletionMarker, WorkflowEngine } from '../../src/main/workflows';
import { DONE_MARKER, type SessionRunner } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-test-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Test card', description: 'Do a verifiable thing' });
  const agent = store.agents().find((row) => row.kind === 'codex')!;
  return { store, dbPath, project, columns, card, agent };
}

function fakeRunner(store: StudioStore) {
  const started: Session[] = [];
  const stopped: string[] = [];
  const runner = {
    start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
      const row = store.createSession({ cardId, agentId });
      started.push(row);
      return row;
    },
    stop: (id: string) => { stopped.push(id); store.finishSession(id, 'stopped', null); },
  } as unknown as SessionRunner;
  return { runner, started, stopped };
}

describe('durable store and workflow gate', () => {
  it('persists cards and notes, and refuses cross-project moves', () => {
    const { store, project, card } = fixture();
    const otherRoot = mkdtempSync(join(tmpdir(), 'jarvis-studio-other-'));
    roots.push(otherRoot);
    const other = store.createProject({ name: 'Other', path: otherRoot });
    const otherColumn = store.snapshot(other.id).columns[0]!;
    expect(() => store.moveCard({ id: card.id, columnId: otherColumn.id })).toThrow('another project');
    const note = store.saveNote({ projectId: project.id, title: 'Decision', body: 'Check the source', tags: ['architecture'], links: [] });
    expect(store.snapshot(project.id).notes[0]?.id).toBe(note.id);
    expect(store.snapshot(project.id).cards[0]?.id).toBe(card.id);
    store.close();
  });

  it('does not mistake a marker echoed earlier for a completed step', () => {
    expect(hasCompletionMarker(`Prompt: ${DONE_MARKER}\nStill working`)).toBe(false);
    expect(hasCompletionMarker(`Finished\n${DONE_MARKER}\n`)).toBe(true);
    expect(hasCompletionMarker(`Finished\n${DONE_MARKER}\nFailed afterwards`)).toBe(false);
    expect(hasCompletionMarker(`Finished\r\n\x1b]0;synthetic title\x07\x1b[?25h${DONE_MARKER}\r\n`)).toBe(true);
  });

  it('recognizes a final marker positioned at column one by a PTY', () => {
    const output = `\x1b[?25l\x1b[2J\x1b[m\x1b[H\x1b]0;synthetic-cli\x07\x1b[?25h` +
      `Synthetic step completed.\x1b[4;1H${DONE_MARKER}\r\n\x1b[?25h`;
    expect(hasCompletionMarker(output)).toBe(true);
    expect(hasCompletionMarker(`Prompt echo: ${DONE_MARKER}`)).toBe(false);
    expect(hasCompletionMarker(`Prompt: ${DONE_MARKER}\x1b[4;1HStill working`)).toBe(false);
    expect(hasCompletionMarker(`Finished\x1b[4;1H${DONE_MARKER}\r\nLater output`)).toBe(false);
    expect(hasCompletionMarker(`Finished\x1b[4;1H${DONE_MARKER}\x1b[5;1HLater output`)).toBe(false);
    expect(hasCompletionMarker('Finished\x1b[4;1H\x1b[?25h')).toBe(false);
  });

  it('persists a completed Antigravity PTY step after SQLite reload', () => {
    const { store, dbPath, project, columns, card } = fixture();
    const agent = store.agents().find((row) => row.kind === 'antigravity')!;
    const { runner, started } = fakeRunner(store);
    const engine = new WorkflowEngine(store, runner);
    const flow = store.createWorkflow({ projectId: project.id, name: 'PTY route', cardIds: [card.id], steps: [
      { id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false },
    ] });
    engine.setState({ id: flow.id, state: 'running' });
    expect(started).toHaveLength(1);
    store.appendOutput(started[0]!.id, `Synthetic step completed.\x1b[4;1H${DONE_MARKER}\r\n\x1b[?25h`);
    engine.onSessionFinished(store.finishSession(started[0]!.id, 'exited', 0));
    expect(store.workflow(flow.id).state).toBe('done');
    expect(store.workflowProgress(flow.id, 0)[0]?.state).toBe('complete');
    store.close();

    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(flow.id).state).toBe('done');
    expect(reopened.workflowProgress(flow.id, 0)[0]?.state).toBe('complete');
    reopened.close();
  });

  it('pauses on a missing gate and retries only after a deliberate resume', () => {
    const { store, project, columns, card, agent } = fixture();
    const { runner, started } = fakeRunner(store);
    const engine = new WorkflowEngine(store, runner);
    const flow = store.createWorkflow({ projectId: project.id, name: 'Test route', cardIds: [card.id], steps: [
      { id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false },
      { id: 'review', columnId: columns[3]!.id, agentId: agent.id, requireApproval: false },
    ] });
    engine.setState({ id: flow.id, state: 'running' });
    expect(started).toHaveLength(1);
    expect(store.card(card.id).columnId).toBe(columns[2]!.id);
    const failed = store.finishSession(started[0]!.id, 'exited', 0);
    engine.onSessionFinished(failed);
    expect(store.workflow(flow.id).state).toBe('paused');
    expect(store.workflow(flow.id).currentStep).toBe(0);
    expect(started).toHaveLength(1);
    engine.setState({ id: flow.id, state: 'running' });
    expect(started).toHaveLength(2);
    store.appendOutput(started[1]!.id, `Verified\n${DONE_MARKER}`);
    engine.onSessionFinished(store.finishSession(started[1]!.id, 'exited', 0), `Verified\n${DONE_MARKER}`);
    expect(store.workflow(flow.id).currentStep).toBe(1);
    expect(started).toHaveLength(3);
    expect(store.card(card.id).columnId).toBe(columns[3]!.id);
    store.close();
  });

  it('requires approval before a step starts and parks running work on restart', () => {
    const { store, dbPath, project, columns, card, agent } = fixture();
    const { runner, started } = fakeRunner(store);
    const engine = new WorkflowEngine(store, runner);
    const flow = store.createWorkflow({ projectId: project.id, name: 'Approval route', cardIds: [card.id], steps: [
      { id: 'review', columnId: columns[3]!.id, agentId: agent.id, requireApproval: true },
      { id: 'test', columnId: columns[4]!.id, agentId: agent.id, requireApproval: false },
    ] });
    engine.setState({ id: flow.id, state: 'running' });
    expect(store.workflow(flow.id).state).toBe('paused');
    expect(store.workflow(flow.id).pauseReason).toBe('approval');
    expect(started).toHaveLength(0);
    expect(store.card(card.id).columnId).toBe(columns[0]!.id);
    engine.setState({ id: flow.id, state: 'running' });
    expect(store.isStepApproved(flow.id, 0)).toBe(true);
    expect(started).toHaveLength(1);
    store.appendOutput(started[0]!.id, `Reviewed\n${DONE_MARKER}`);
    engine.onSessionFinished(store.finishSession(started[0]!.id, 'exited', 0), `Reviewed\n${DONE_MARKER}`);
    expect(store.workflow(flow.id).currentStep).toBe(1);
    expect(started).toHaveLength(2);
    store.close();

    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(flow.id).state).toBe('paused');
    expect(reopened.session(started[1]!.id).state).toBe('failed');
    expect(reopened.workflowProgress(flow.id, 1)[0]?.state).toBe('needs_review');
    reopened.close();
  });

  it('does not auto-complete an agentless step before manual confirmation', () => {
    const { store, project, columns, card, agent } = fixture();
    store.updateColumn({ id: columns[1]!.id, agentId: agent.id });
    const { runner, started } = fakeRunner(store);
    const engine = new WorkflowEngine(store, runner);
    const flow = store.createWorkflow({ projectId: project.id, name: 'Manual route', cardIds: [card.id], steps: [
      { id: 'manual', columnId: columns[1]!.id, agentId: null, requireApproval: false },
      { id: 'done', columnId: columns[5]!.id, agentId: null, requireApproval: false },
    ] });
    engine.setState({ id: flow.id, state: 'running' });
    expect(store.workflow(flow.id).state).toBe('paused');
    expect(store.workflow(flow.id).pauseReason).toBe('manual');
    expect(store.workflow(flow.id).currentStep).toBe(0);
    expect(store.workflowProgress(flow.id, 0)[0]?.state).toBe('manual_wait');
    expect(started).toHaveLength(0);
    expect(store.card(card.id).columnId).toBe(columns[1]!.id);
    engine.setState({ id: flow.id, state: 'running' });
    expect(store.workflow(flow.id).currentStep).toBe(1);
    expect(store.workflow(flow.id).state).toBe('paused');
    expect(store.workflowProgress(flow.id, 1)[0]?.state).toBe('manual_wait');
    engine.setState({ id: flow.id, state: 'running' });
    expect(store.workflow(flow.id).state).toBe('done');
    store.close();
  });

  it('stops a live card on pause and does not let another workflow take it', () => {
    const { store, project, columns, card, agent } = fixture();
    const { runner, started, stopped } = fakeRunner(store);
    const engine = new WorkflowEngine(store, runner);
    const steps = [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }];
    const first = store.createWorkflow({ projectId: project.id, name: 'First', cardIds: [card.id], steps });
    const second = store.createWorkflow({ projectId: project.id, name: 'Second', cardIds: [card.id], steps });
    engine.setState({ id: first.id, state: 'running' });
    expect(() => engine.setState({ id: second.id, state: 'running' })).toThrow('already running');
    engine.setState({ id: first.id, state: 'paused' });
    expect(stopped).toEqual([started[0]!.id]);
    expect(store.workflowProgress(first.id, 0)[0]?.state).toBe('needs_review');
    expect(store.workflow(first.id).pauseReason).toBe('review');
    expect(started).toHaveLength(1);
    store.close();
  });
});
