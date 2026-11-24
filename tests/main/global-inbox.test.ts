import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { globalInboxItems } from '../../src/main/global-inbox';
import { createPlanComment, saveReviewedPlan } from '../../src/main/plan-review';
import { acknowledgeQaInboxReport, acknowledgeReviewInboxComment } from '../../src/main/review-inbox';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-global-inbox-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const otherPath = join(root, 'other'); mkdirSync(otherPath);
  const projects = [store.createProject({ name: 'Alpha', path: root }), store.createProject({ name: 'Beta', path: otherPath })];
  const cards = projects.map((project) => {
    const column = store.snapshot(project.id).columns[0]!;
    return store.createCard({ projectId: project.id, columnId: column.id, title: `Card ${project.name}` });
  });
  return { store, projects, cards };
}

describe('project-spanning decision inbox', () => {
  it('shows only unreviewed interruptions and failed QA, preserving project boundaries on acknowledgement', () => {
    const { store, projects, cards } = fixture();
    const agent = store.snapshot(projects[0]!.id).agents[0]!;
    const stamp = '2026-01-01T10:00:00.000Z';
    store.db.prepare(`INSERT INTO sessions (id,project_id,card_id,agent_id,state,started_at,ended_at,exit_code,output,interrupted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('interrupted', projects[0]!.id, cards[0]!.id, agent.id, 'failed', stamp, stamp, null, 'Synthetic output', stamp);
    store.db.prepare(`INSERT INTO card_qa_reports (id,card_id,project_id,requested_url,final_url,started_at,ended_at,status,diagnostics_json,note)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('failed-qa', cards[1]!.id, projects[1]!.id, 'http://127.0.0.1:5173/', null, stamp, stamp, 'failed',
        JSON.stringify([{ message: 'Synthetic console failure' }]), null);
    const page = globalInboxItems(store);
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'session:interrupted', projectId: projects[0]!.id, projectName: 'Alpha', sourceId: 'interrupted' }),
      expect.objectContaining({ id: 'qa:failed-qa', projectId: projects[1]!.id, projectName: 'Beta', sourceId: cards[1]!.id, detail: expect.stringContaining('Synthetic console failure') }),
    ]));
    expect(() => acknowledgeQaInboxReport(store, { projectId: projects[0]!.id, reportId: 'failed-qa' })).toThrow('aktiven Projekt');
    acknowledgeQaInboxReport(store, { projectId: projects[1]!.id, reportId: 'failed-qa' });
    store.db.prepare('UPDATE sessions SET interruption_reviewed_at = ? WHERE id = ?').run(stamp, 'interrupted');
    expect(globalInboxItems(store).items).toHaveLength(0);
    store.close();
  });

  it('names the real project and source, searches across projects, and never changes execution state', () => {
    const { store, projects, cards } = fixture();
    const column = store.snapshot(projects[0]!.id).columns[0]!;
    const workflow = store.createWorkflow({ projectId: projects[0]!.id, name: 'Needs consent', cardIds: [cards[0]!.id],
      steps: [{ id: 'step-1', columnId: column.id, agentId: null, requireApproval: true }] });
    store.setWorkflowState(workflow.id, 'paused');
    store.saveProjectQueue({ projectId: projects[1]!.id, state: 'paused', templateWorkflowId: null, activeWorkflowId: null, pauseReason: 'Review route' });
    const betaColumn = store.snapshot(projects[1]!.id).columns[0]!;
    const plan = saveReviewedPlan(store, { projectId: projects[1]!.id, request: 'Build Beta', proposal: {
      title: 'Beta plan', explanation: 'Synthetic.', cards: [{ title: 'Task', description: 'Test.' }], columnIds: [betaColumn.id],
    } });
    const comment = createPlanComment(store, { planId: plan.id, fingerprint: plan.fingerprint, line: 1, body: 'Check Beta request.' });
    const page = globalInboxItems(store);
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `workflow:${workflow.id}`, category: 'approval', projectId: projects[0]!.id, projectName: 'Alpha', sourceId: workflow.id }),
      expect.objectContaining({ id: `queue:${projects[1]!.id}`, projectName: 'Beta', sourceId: projects[1]!.id }),
      expect.objectContaining({ id: `plan:${comment.id}`, projectName: 'Beta', sourceId: plan.id }),
    ]));
    expect(globalInboxItems(store, { category: 'approval' }).items.map((item) => item.id)).toEqual([`workflow:${workflow.id}`]);
    expect(globalInboxItems(store, { query: 'beta' }).items.every((item) => item.projectName === 'Beta')).toBe(true);
    expect(store.workflow(workflow.id).state).toBe('paused');
    expect(store.snapshot(projects[0]!.id).sessions).toHaveLength(0);
    acknowledgeReviewInboxComment(store, { projectId: projects[1]!.id, kind: 'plan', commentId: comment.id });
    expect(globalInboxItems(store).items.some((item) => item.id === `plan:${comment.id}`)).toBe(false);
    store.close();
  });

  it('excludes stale sources and bounds pages and inputs', () => {
    const { store, projects, cards } = fixture();
    const stmt = store.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < 103; index++) stmt.run(`comment-${index}`, cards[index % 2]!.id, 'f'.repeat(64), 'src/test.ts', 'new', index + 1, `Review ${index}`, new Date(2026, 0, 1, 0, index).toISOString());
    const first = globalInboxItems(store);
    expect(first.items).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const second = globalInboxItems(store, { offset: 100 });
    expect(second.items).toHaveLength(3);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(103);
    store.db.prepare('UPDATE cards SET archived_at=? WHERE id=?').run(new Date().toISOString(), cards[0]!.id);
    expect(globalInboxItems(store, { query: 'Alpha' }).items).toHaveLength(0);
    expect(() => globalInboxItems(store, { offset: 1 })).toThrow('Ungültige');
    expect(() => globalInboxItems(store, { offset: 10_000 })).toThrow('Ungültige');
    expect(() => globalInboxItems(store, { query: 'x'.repeat(201) })).toThrow('Ungültige');
    expect(() => globalInboxItems(store, { category: 'invalid' as never })).toThrow('Ungültige');
    expect(store.project(projects[1]!.id).name).toBe('Beta');
    store.close();
  });
});
