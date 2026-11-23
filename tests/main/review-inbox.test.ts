import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createPlanComment, saveReviewedPlan } from '../../src/main/plan-review';
import { acknowledgeReviewInboxComment, reviewInboxItems } from '../../src/main/review-inbox';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-review-inbox-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Review card' });
  const plan = saveReviewedPlan(store, { projectId: project.id, request: 'Build a safe test', proposal: {
    title: 'Review plan', explanation: 'Test first.', cards: [{ title: 'Work', description: 'Do work.' }], columnIds: [column.id],
  } });
  const planComment = createPlanComment(store, { planId: plan.id, fingerprint: plan.fingerprint, line: 1, body: 'Check failure case.' });
  const diffId = 'synthetic-diff-comment';
  store.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(diffId, card.id, 'f'.repeat(64), 'src/test.ts', 'new', 12, 'Check branch.', new Date().toISOString());
  return { root, file, store, project, card, plan, planComment, diffId };
}

describe('review comments in decision inbox', () => {
  it('lists bounded real sources and keeps acknowledgements after restart without approving work', () => {
    const { file, store, project, card, plan, planComment, diffId } = fixture();
    const first = reviewInboxItems(store, project.id);
    expect(first.items).toHaveLength(2);
    expect(first.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: planComment.id, kind: 'plan', sourceId: plan.id, location: expect.stringContaining('Planzeile 1') }),
      expect.objectContaining({ id: diffId, kind: 'diff', sourceId: card.id, location: 'Diff src/test.ts:12' }),
    ]));
    acknowledgeReviewInboxComment(store, { projectId: project.id, kind: 'plan', commentId: planComment.id });
    acknowledgeReviewInboxComment(store, { projectId: project.id, kind: 'plan', commentId: planComment.id });
    expect(reviewInboxItems(store, project.id).items.map((item) => item.id)).toEqual([diffId]);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    expect(store.snapshot(project.id).workflows).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(file);
    expect(reviewInboxItems(reopened, project.id).items.map((item) => item.id)).toEqual([diffId]);
    reopened.close();
  });

  it('rejects cross-project acknowledgements and hides replaced plans or archived cards', () => {
    const { root, store, project, card, plan, planComment, diffId } = fixture();
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(reviewInboxItems(store, other.id).items).toEqual([]);
    expect(() => acknowledgeReviewInboxComment(store, { projectId: other.id, kind: 'plan', commentId: planComment.id })).toThrow('aktiven Projekt');
    expect(() => acknowledgeReviewInboxComment(store, { projectId: other.id, kind: 'diff', commentId: diffId })).toThrow('aktiven Projekt');
    expect(() => acknowledgeReviewInboxComment(store, { projectId: project.id, kind: 'diff', commentId: planComment.id })).toThrow();
    store.db.prepare("UPDATE reviewed_plans SET state='superseded' WHERE id=?").run(plan.id);
    store.db.prepare('UPDATE cards SET archived_at=? WHERE id=?').run(new Date().toISOString(), card.id);
    expect(reviewInboxItems(store, project.id).items).toEqual([]);
    store.close();
  });

  it('shows newest 100 entries and reports that older source comments remain', () => {
    const { store, project, card } = fixture();
    const stmt = store.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < 102; index++) stmt.run(`id-${index}`, card.id, 'f'.repeat(64), 'src/test.ts', 'new', index + 1, `Comment ${index}`, new Date(2026, 0, 1, 0, index).toISOString());
    const page = reviewInboxItems(store, project.id);
    expect(page.items).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    store.close();
  });
});
