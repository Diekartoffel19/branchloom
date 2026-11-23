import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createPlanComment, saveReviewedPlan } from '../../src/main/plan-review';
import { createReviewRuleFromComment, deleteReviewRule, listReviewRules, reviewRulePromptContext, updateReviewRule } from '../../src/main/review-rules';
import { proposeWorkflow, type PlannerInvocation } from '../../src/main/workflow-planner';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-review-rules-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic project', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const proposal = { title: 'Plan', explanation: 'Check implementation', cards: [{ title: 'Work', description: 'Do it.' }], columnIds: [column.id] };
  const plan = saveReviewedPlan(store, { projectId: project.id, request: 'Do it', proposal });
  const comment = createPlanComment(store, { planId: plan.id, fingerprint: plan.fingerprint, line: 1, body: 'Check error states before merge.' });
  return { root, file, store, project, column, plan, comment, proposal };
}

describe('explicit project review rules', () => {
  it('promotes a real plan comment only once, persists edits and can exclude it from planning', () => {
    const { store, file, project, comment } = fixture();
    expect(listReviewRules(store, project.id)).toEqual([]);
    const rule = createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: comment.id });
    expect(rule.body).toBe(comment.body);
    expect(rule.sourceLabel).toContain('Planzeile 1');
    expect(createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: comment.id }).id).toBe(rule.id);
    expect(listReviewRules(store, project.id)).toHaveLength(1);
    store.close();

    const reopened = new StudioStore(file);
    expect(listReviewRules(reopened, project.id)[0]?.id).toBe(rule.id);
    const edited = updateReviewRule(reopened, { projectId: project.id, id: rule.id, body: '  Verify loading and error states.  ', enabled: false });
    expect(edited.body).toBe('Verify loading and error states.');
    expect(edited.enabled).toBe(false);
    expect(reviewRulePromptContext(reopened, project.id)).toEqual({ text: '', included: 0, total: 0 });
    deleteReviewRule(reopened, { projectId: project.id, id: rule.id });
    expect(listReviewRules(reopened, project.id)).toEqual([]);
    reopened.close();
  });

  it('rejects forged or foreign sources and keeps other project rules isolated', () => {
    const { store, project, comment, root } = fixture();
    const otherPath = join(root, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(() => createReviewRuleFromComment(store, { projectId: other.id, sourceKind: 'plan', sourceId: comment.id })).toThrow('gehört nicht');
    expect(() => createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: 'forged' })).toThrow('gehört nicht');
    expect(listReviewRules(store, other.id)).toEqual([]);
    const rule = createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: comment.id });
    expect(() => updateReviewRule(store, { projectId: other.id, id: rule.id, body: 'Foreign edit' })).toThrow('nicht gefunden');
    expect(() => deleteReviewRule(store, { projectId: other.id, id: rule.id })).toThrow('nicht gefunden');
    expect(() => updateReviewRule(store, { projectId: project.id, id: rule.id, body: '\0bad' })).toThrow('1 bis 2000');
    expect(() => updateReviewRule(store, null as unknown as Parameters<typeof updateReviewRule>[1])).toThrow('Ungültige Projektregel');
    expect(listReviewRules(store, project.id)[0]?.body).toBe(comment.body);
    store.close();
  });

  it('can promote a diff comment with anchored file provenance', () => {
    const { store, project, column } = fixture();
    const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic card' });
    store.db.prepare('INSERT INTO review_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('review-comment-1', card.id, 'synthetic-fingerprint', 'src/main.ts', 'new', 42, 'Handle missing data.', new Date().toISOString());
    const rule = createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'diff', sourceId: 'review-comment-1' });
    expect(rule.sourceLabel).toBe('Diff src/main.ts:42');
    expect(rule.body).toBe('Handle missing data.');
    store.close();
  });

  it('includes only enabled rules in a bounded read-only planner prompt with a clear source', async () => {
    const { store, project, comment, proposal, root } = fixture();
    writeFileSync(join(root, 'README.md'), 'Synthetic README only.');
    const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: process.execPath, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: null });
    const rule = createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: comment.id });
    let invocation!: PlannerInvocation;
    await proposeWorkflow(store, { projectId: project.id, request: 'Build' }, async (call) => {
      invocation = call; writeFileSync(call.outputPath, JSON.stringify(proposal));
    });
    expect(invocation.stdin).toContain('Check error states before merge.');
    expect(invocation.stdin).toContain(`plan:${comment.id}`);
    expect(invocation.stdin).toContain('user-controlled context');
    expect(invocation.stdin).toContain('Do not inspect other project files');
    updateReviewRule(store, { projectId: project.id, id: rule.id, enabled: false });
    await proposeWorkflow(store, { projectId: project.id, request: 'Build' }, async (call) => {
      invocation = call; writeFileSync(call.outputPath, JSON.stringify(proposal));
    });
    expect(invocation.stdin).not.toContain('Check error states before merge.');
    store.close();
  });

  it('limits stored and included rules even when many approved comments exist', () => {
    const { store, project, plan, comment } = fixture();
    createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: comment.id });
    for (let i = 0; i < 11; i++) {
      const id = `synthetic-comment-${i}`;
      store.db.prepare('INSERT INTO plan_comments VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, plan.id, plan.fingerprint, 1, 'Title', `Rule ${i}: ${'x'.repeat(350)}`, new Date().toISOString());
      createReviewRuleFromComment(store, { projectId: project.id, sourceKind: 'plan', sourceId: id });
    }
    const context = reviewRulePromptContext(store, project.id);
    expect(context.total).toBe(12);
    expect(context.included).toBeLessThanOrEqual(10);
    expect(context.text.length).toBeLessThanOrEqual(4000);
    store.close();
  });
});
