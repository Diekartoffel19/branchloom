import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflowRunEvidence } from '../../src/main/workflow-evidence';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-workflow-evidence-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[2]!;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'First synthetic card' });
  const flow = store.createWorkflow({ projectId: project.id, name: 'Synthetic route', cardIds: [card.id], steps: [
    { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false },
    { id: 'review', columnId: column.id, agentId: null, requireApproval: false },
  ] });
  return { root, dbPath, store, project, column, agent, card, flow };
}

describe('read-only workflow run evidence', () => {
  it('shows only persisted progress and matching session metadata after restart, without transcript content', () => {
    const { dbPath, store, project, card, agent, flow } = fixture();
    expect(workflowRunEvidence(store, { projectId: project.id, workflowId: flow.id }).rows).toEqual([]);
    store.ensureWorkflowProgress(flow.id, 0, [card.id]);
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    store.beginWorkflowCard(flow.id, 0, card.id, session.id);
    store.appendOutput(session.id, 'SYNTHETIC_TRANSCRIPT_NOT_FOR_SUMMARY');
    store.finishSession(session.id, 'exited', 0);
    store.finishWorkflowCard(session.id, false); // Exit 0 alone does not prove the workflow gate.
    store.ensureWorkflowProgress(flow.id, 1, [card.id]);
    store.markManualWait(flow.id, 1, card.id);
    const before = workflowRunEvidence(store, { projectId: project.id, workflowId: flow.id });
    expect(before.rows).toMatchObject([
      { stepIndex: 0, cardId: card.id, cardTitle: card.title, state: 'needs_review', session: { id: session.id, state: 'exited', exitCode: 0 }, missingSession: false },
      { stepIndex: 1, cardId: card.id, state: 'manual_wait', session: null, missingSession: false },
    ]);
    expect(JSON.stringify(before)).not.toContain('SYNTHETIC_TRANSCRIPT_NOT_FOR_SUMMARY');
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(workflowRunEvidence(reopened, { projectId: project.id, workflowId: flow.id })).toEqual(before);
    reopened.close();
  });

  it('rejects a different project and does not expose a foreign linked session', () => {
    const { root, store, project, card, agent, flow } = fixture();
    const otherPath = join(root, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    const otherCard = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Private other card' });
    const foreignSession = store.createSession({ cardId: otherCard.id, agentId: agent.id });
    expect(() => workflowRunEvidence(store, { projectId: other.id, workflowId: flow.id })).toThrow('anderen Projekt');
    expect(() => workflowRunEvidence(store, { projectId: project.id, workflowId: '' })).toThrow('Ungültige');
    store.ensureWorkflowProgress(flow.id, 0, [card.id]);
    store.beginWorkflowCard(flow.id, 0, card.id, foreignSession.id);
    const row = workflowRunEvidence(store, { projectId: project.id, workflowId: flow.id }).rows[0]!;
    expect(row).toMatchObject({ cardId: card.id, session: null, missingSession: true });
    expect(JSON.stringify(row)).not.toContain('Private other card');
    expect(JSON.stringify(row)).not.toContain(foreignSession.id);
    store.ensureWorkflowProgress(flow.id, 1, [otherCard.id]);
    const foreignCardRow = workflowRunEvidence(store, { projectId: project.id, workflowId: flow.id }).rows[1]!;
    expect(foreignCardRow).toMatchObject({ cardId: otherCard.id, cardTitle: null, session: null });
    expect(JSON.stringify(foreignCardRow)).not.toContain('Private other card');
    store.close();
  });

  it('limits large persisted routes without inventing later rows', () => {
    const { store, project, column, agent } = fixture();
    const cards = Array.from({ length: 201 }, (_, index) => store.createCard({ projectId: project.id, columnId: column.id, title: `Synthetic ${index}` }));
    const flow = store.createWorkflow({ projectId: project.id, name: 'Large route', cardIds: cards.map((card) => card.id), steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false },
    ] });
    store.ensureWorkflowProgress(flow.id, 0, flow.cardIds);
    const evidence = workflowRunEvidence(store, { projectId: project.id, workflowId: flow.id });
    expect(evidence.rows).toHaveLength(200);
    expect(evidence.moreAvailable).toBe(true);
    expect(evidence.rows[0]?.cardId).toBe(cards[0]?.id);
    expect(evidence.rows.at(-1)?.cardId).toBe(cards[199]?.id);
    store.close();
  });
});
