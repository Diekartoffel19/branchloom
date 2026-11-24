import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Session } from '../../src/shared/types';
import { SessionRunner, DONE_MARKER } from '../../src/main/cli';
import { approveCardWireframe, saveCardWireframe } from '../../src/main/card-wireframe';
import { wireframeStartBlockReason } from '../../src/main/card-wireframe-gate';
import { ProjectQueueEngine } from '../../src/main/queue';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-wireframe-gate-'));
  roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath);
  const dbFile = join(root, 'studio.sqlite');
  const store = new StudioStore(dbFile);
  const project = store.createProject({ name: 'Synthetic gate', path: projectPath });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Windows UI' });
  const key = { projectId: project.id, cardId: card.id };
  const element = { id: 'title', kind: 'text' as const, x: 20, y: 30, width: 340, height: 40, text: 'Fenster', tone: 'plain' as const };
  return { store, dbFile, project, columns, agent, card, key, element };
}

function fakeWorkflowRunner(store: StudioStore) {
  const started: Session[] = [];
  const runner = {
    start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
      const session = store.createSession({ cardId, agentId });
      started.push(session);
      return session;
    },
    stop: (id: string) => { store.finishSession(id, 'stopped', null); },
  } as unknown as SessionRunner;
  return { runner, started };
}

describe('optional wireframe start gate', () => {
  it('migrates an existing cards table with the requirement safely off', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-wireframe-migration-'));
    roots.push(root);
    const dbFile = join(root, 'old.sqlite');
    const legacy = new Database(dbFile);
    legacy.exec('CREATE TABLE cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, column_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    legacy.close();
    const store = new StudioStore(dbFile);
    const project = store.createProject({ name: 'Migration', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Existing shape' });
    expect(store.card(card.id).wireframeRequired).toBe(false);
    store.close();
  });

  it('does not change the requirement underneath an already running card agent', () => {
    const { store, card, agent } = fixture();
    const running = store.createSession({ cardId: card.id, agentId: agent.id });
    expect(() => store.updateCard({ id: card.id, wireframeRequired: true })).toThrow('Laufenden Agenten');
    expect(store.card(card.id).wireframeRequired).toBe(false);
    store.finishSession(running.id, 'stopped', null);
    expect(store.updateCard({ id: card.id, wireframeRequired: true }).wireframeRequired).toBe(true);
    store.close();
  });

  it('defaults off, persists the explicit setting and blocks every direct agent start before session creation', () => {
    const { store, dbFile, card, agent, key, element } = fixture();
    expect(card.wireframeRequired).toBe(false);
    expect(wireframeStartBlockReason(store, card.id)).toBeNull();
    expect(() => store.updateCard({ id: card.id, wireframeRequired: 'yes' as unknown as boolean })).toThrow('Ungültige Wireframe-Einstellung');
    expect(store.updateCard({ id: card.id, wireframeRequired: true }).wireframeRequired).toBe(true);
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    expect(() => runner.start({ cardId: card.id, agentId: agent.id, prompt: 'Code schreiben' })).toThrow('aktuell freigegebenen Wireframe');
    expect(store.snapshot(key.projectId).sessions).toHaveLength(0);
    saveCardWireframe(store, { ...key, title: 'Fenster', elements: [element], expectedRevision: 0 });
    expect(() => runner.start({ cardId: card.id, agentId: agent.id })).toThrow('aktuell freigegebenen Wireframe');
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    expect(wireframeStartBlockReason(store, card.id)).toBeNull();
    saveCardWireframe(store, { ...key, title: 'Neue Fassung', elements: [{ ...element, x: 40 }], expectedRevision: 1 });
    expect(() => runner.start({ cardId: card.id, agentId: agent.id })).toThrow('aktuell freigegebenen Wireframe');
    runner.dispose(); store.close();
    const reopened = new StudioStore(dbFile);
    expect(reopened.card(card.id).wireframeRequired).toBe(true);
    expect(wireframeStartBlockReason(reopened, card.id)).toContain('aktuell freigegebenen Wireframe');
    expect(reopened.snapshot(key.projectId).sessions).toHaveLength(0);
    reopened.close();
  });

  it('pauses a workflow before moving its card or starting an agent, then resumes after approval', () => {
    const { store, project, columns, agent, card, key, element } = fixture();
    store.updateCard({ id: card.id, wireframeRequired: true });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Implement UI', cardIds: [card.id], steps: [{ id: 'code', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
    const { runner, started } = fakeWorkflowRunner(store);
    const workflows = new WorkflowEngine(store, runner);
    expect(workflows.setState({ id: flow.id, state: 'running' })).toMatchObject({ state: 'paused', pauseReason: 'wireframe' });
    expect(started).toHaveLength(0);
    expect(store.card(card.id).columnId).toBe(columns[0]!.id);
    saveCardWireframe(store, { ...key, title: 'Fenster', elements: [element], expectedRevision: 0 });
    expect(workflows.setState({ id: flow.id, state: 'running' })).toMatchObject({ state: 'paused', pauseReason: 'wireframe' });
    approveCardWireframe(store, { ...key, expectedRevision: 1 });
    expect(workflows.setState({ id: flow.id, state: 'running' }).state).toBe('running');
    expect(started).toHaveLength(1);
    expect(store.card(card.id).columnId).toBe(columns[2]!.id);
    store.close();
  });

  it('keeps a queued card paused across restart until explicit design and workflow/queue resume', () => {
    const { store, dbFile, project, columns, agent, card, key, element } = fixture();
    const next = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Unrestricted next card' });
    store.updateCard({ id: card.id, wireframeRequired: true });
    const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template' });
    const template = store.createWorkflow({ projectId: project.id, name: 'Code route', cardIds: [templateCard.id], steps: [{ id: 'code', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
    const { runner, started } = fakeWorkflowRunner(store);
    const workflows = new WorkflowEngine(store, runner);
    const queue = new ProjectQueueEngine(store, workflows);
    const paused = queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(paused).toMatchObject({ state: 'paused', pauseReason: expect.stringContaining('Wireframe') });
    const activeId = paused.activeWorkflowId!;
    expect(store.workflow(activeId)).toMatchObject({ state: 'paused', pauseReason: 'wireframe' });
    expect(started).toHaveLength(0);
    expect(store.card(card.id).columnId).toBe(columns[0]!.id);
    queue.dispose(); store.close();

    const reopened = new StudioStore(dbFile);
    expect(reopened.projectQueue(project.id)).toMatchObject({ state: 'paused', activeWorkflowId: activeId });
    expect(reopened.workflow(activeId)).toMatchObject({ state: 'paused', pauseReason: 'wireframe' });
    expect(reopened.snapshot(project.id).sessions).toHaveLength(0);
    const resumedFake = fakeWorkflowRunner(reopened);
    const resumedWorkflows = new WorkflowEngine(reopened, resumedFake.runner);
    const resumedQueue = new ProjectQueueEngine(reopened, resumedWorkflows);
    expect(() => resumedQueue.setState({ projectId: project.id, state: 'running' })).toThrow('Wireframe');
    saveCardWireframe(reopened, { ...key, title: 'Fenster', elements: [element], expectedRevision: 0 });
    approveCardWireframe(reopened, { ...key, expectedRevision: 1 });
    expect(resumedWorkflows.setState({ id: activeId, state: 'running' }).state).toBe('running');
    expect(resumedFake.started.map((session) => session.cardId)).toEqual([card.id]);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    resumedQueue.setState({ projectId: project.id, state: 'running' });
    const completed = reopened.finishSession(resumedFake.started[0]!.id, 'exited', 0);
    resumedWorkflows.onSessionFinished(completed, DONE_MARKER);
    resumedQueue.onSessionFinished(completed);
    expect(resumedFake.started.map((session) => session.cardId)).toEqual([card.id, next.id]);
    resumedQueue.dispose(); reopened.close();
  });
});
