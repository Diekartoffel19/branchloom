import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { discussTaskDraft, taskDraftProjectContext, validateDraftTurns, validateTaskDraftReply } from '../../src/main/task-draft';
import type { PlannerInvocation } from '../../src/main/workflow-planner';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-task-draft-test-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic project', path: root });
  store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Existing card' });
  const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: process.execPath, args: ['--dangerously-bypass-approvals-and-sandbox'], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: 'test-model', effort: 'low' });
  return { root, store, project, agent };
}

describe('task discussion', () => {
  it('uses project context and a fixed read-only CLI call without creating cards', async () => {
    const { root, store, project } = fixture();
    writeFileSync(join(root, 'README.md'), 'Synthetic marker: CEDAR-47.\n');
    let invocation!: PlannerInvocation;
    const answer = await discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'user', text: 'How should we improve the review?' }] }, async (call) => {
      invocation = call;
      writeFileSync(call.outputPath, JSON.stringify({ reply: 'Add a diff preview.', ready: true, specTitle: 'Review preview', specDescription: 'Goal: show a diff. Check: compare before and after.' }));
    });
    expect(answer.ready).toBe(true);
    expect(answer.specTitle).toBe('Review preview');
    expect(invocation.cwd).not.toBe(root);
    expect(invocation.cwd).toContain('branchloom-task-draft-');
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).toContain('--ignore-user-config');
    expect(invocation.args).toContain('--ephemeral');
    expect(invocation.args).toContain('test-model');
    expect(invocation.args).toContain('model_reasoning_effort="low"');
    expect(invocation.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(invocation.args.at(-1)).toBe('-');
    expect(invocation.stdin).toContain('Existing card');
    expect(invocation.stdin).toContain('CEDAR-47');
    expect(invocation.stdin).toContain('Use only the supplied project context');
    expect(store.snapshot(project.id).cards.map((card) => card.title)).toEqual(['Existing card']);
    store.close();
  });

  it('limits local project context to a regular small README', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-task-context-test-'));
    roots.push(root);
    expect(taskDraftProjectContext(root)).toContain('unavailable');
    writeFileSync(join(root, '.env'), 'NOT_FOR_MODEL=private');
    writeFileSync(join(root, 'README.md'), 'Project context marker: OAK-73.');
    expect(taskDraftProjectContext(root)).toContain('OAK-73');
    expect(taskDraftProjectContext(root)).not.toContain('NOT_FOR_MODEL');
    writeFileSync(join(root, 'README.md'), 'x'.repeat(12_000));
    expect(taskDraftProjectContext(root)).toContain('12000 bytes');
    writeFileSync(join(root, 'README.md'), 'x'.repeat(12_001));
    expect(taskDraftProjectContext(root)).toContain('above the 12 KB limit');
    rmSync(join(root, 'README.md'));
    try {
      symlinkSync(join(root, '.env'), join(root, 'README.md'), 'file');
      expect(taskDraftProjectContext(root)).toContain('unavailable');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });

  it('asks for missing details without a creatable spec and rejects malformed output', async () => {
    const { store, project } = fixture();
    const answer = await discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'user', text: 'Something with reviews' }] }, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ reply: 'Which review step?', ready: false, specTitle: '', specDescription: '' }));
    });
    expect(answer.ready).toBe(false);
    await expect(discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'user', text: 'Build' }] }, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ reply: 'Fine', ready: true, specTitle: '', specDescription: '' }));
    })).rejects.toThrow('incomplete draft');
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    store.close();
  });

  it('validates conversation bounds and the configured agent', async () => {
    expect(() => validateDraftTurns([{ role: 'assistant', text: '' }])).toThrow();
    expect(() => validateDraftTurns(Array.from({ length: 13 }, () => ({ role: 'user', text: 'hi' })))).toThrow();
    expect(() => validateTaskDraftReply({ reply: 'x', ready: true, specTitle: 'x', specDescription: '' })).toThrow();
    const { store, project } = fixture();
    await expect(discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'assistant', text: 'hello' }] }, async () => undefined)).rejects.toThrow('last task turn');
    const claude = store.saveAgent({ name: 'Claude', kind: 'claude', command: process.execPath, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: claude.id, model: null, effort: null });
    await expect(discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'user', text: 'hello' }] }, async () => undefined)).rejects.toThrow('nur Codex CLI');
    store.close();
  });
});
