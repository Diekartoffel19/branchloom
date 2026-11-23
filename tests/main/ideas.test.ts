import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { convertIdeaToCard, discussIdea, listIdeas, saveIdea, validateIdeaReply } from '../../src/main/ideas';
import type { PlannerInvocation } from '../../src/main/workflow-planner';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-ideas-test-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic project', path: root });
  const otherRoot = mkdtempSync(join(tmpdir(), 'branchloom-ideas-other-'));
  roots.push(otherRoot);
  const other = store.createProject({ name: 'Other project', path: otherRoot });
  const columns = store.snapshot(project.id).columns;
  const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: process.execPath, args: ['--unsafe-untrusted-flag'], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: 'test-model', effort: 'medium' });
  return { root, file, store, project, other, columns };
}

const create = (store: StudioStore, projectId: string) => saveIdea(store, {
  projectId, title: 'Review ideas', body: 'Compare code and screenshots.', category: 'idea',
  turns: [{ role: 'user', text: 'Could reviews be clearer?' }, { role: 'assistant', text: 'Yes, show a comparison.' }],
});

describe('ideas room', () => {
  it('migrates existing databases, saves edits and conversation locally, and separates projects', () => {
    const { file, store, project, other } = fixture();
    const saved = create(store, project.id);
    const edited = saveIdea(store, { projectId: project.id, id: saved.id, title: 'Better reviews', body: 'Visual and code diff.', category: 'roadmap', turns: saved.turns });
    expect(edited.id).toBe(saved.id);
    expect(edited.category).toBe('roadmap');
    expect(listIdeas(store, other.id)).toEqual([]);
    expect(() => saveIdea(store, { projectId: other.id, id: saved.id, title: 'Wrong project', body: '', category: 'idea', turns: [] })).toThrow('not found');
    store.close();
    const reopened = new StudioStore(file);
    expect(listIdeas(reopened, project.id)[0]).toMatchObject({ title: 'Better reviews', body: 'Visual and code diff.', category: 'roadmap', turns: saved.turns });
    reopened.close();
  });

  it('requires explicit conversion, creates one card, and rejects a foreign destination', () => {
    const { store, project, other, columns } = fixture();
    const saved = create(store, project.id);
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    const foreignColumn = store.snapshot(other.id).columns[0]!;
    expect(() => convertIdeaToCard(store, { projectId: project.id, ideaId: saved.id, columnId: foreignColumn.id })).toThrow('another project');
    const card = convertIdeaToCard(store, { projectId: project.id, ideaId: saved.id, columnId: columns[0]!.id });
    expect(card).toMatchObject({ title: saved.title, description: saved.body, columnId: columns[0]!.id });
    expect(convertIdeaToCard(store, { projectId: project.id, ideaId: saved.id, columnId: columns[1]!.id }).id).toBe(card.id);
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    expect(listIdeas(store, project.id)[0]?.cardId).toBe(card.id);
    expect(() => convertIdeaToCard(store, { projectId: other.id, ideaId: saved.id, columnId: foreignColumn.id })).toThrow('not found');
    store.close();
  });

  it('does not place a new card into a running To-do queue', () => {
    const { store, project, columns } = fixture();
    const saved = create(store, project.id);
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => convertIdeaToCard(store, { projectId: project.id, ideaId: saved.id, columnId: columns[0]!.id })).toThrow('Warteschlange');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    const card = convertIdeaToCard(store, { projectId: project.id, ideaId: saved.id, columnId: columns[1]!.id });
    expect(card.columnId).toBe(columns[1]!.id);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
  });

  it('runs a bounded read-only Codex discussion only when called, without saving or creating a card', async () => {
    const { root, store, project } = fixture();
    writeFileSync(join(root, '.env'), 'PRIVATE_MARKER_DO_NOT_SEND');
    writeFileSync(join(root, 'README.md'), 'Public synthetic context: MAPLE-86');
    let invocation!: PlannerInvocation;
    const answer = await discussIdea(store, {
      projectId: project.id, title: 'Review idea', body: 'Compare changes.', category: 'backlog',
      turns: [{ role: 'user', text: 'Could we see screenshots?' }],
    }, async (call) => {
      invocation = call;
      writeFileSync(call.outputPath, JSON.stringify({ reply: 'Yes. Which screen?', suggestedTitle: 'Visual review', suggestedBody: 'Compare desktop screenshots.', suggestedCategory: 'idea' }));
    });
    expect(answer.suggestedTitle).toBe('Visual review');
    expect(invocation.cwd).not.toBe(root);
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).toContain('--ignore-user-config');
    expect(invocation.args).toContain('--ephemeral');
    expect(invocation.args).toContain('test-model');
    expect(invocation.args).not.toContain('--unsafe-untrusted-flag');
    expect(invocation.args.at(-1)).toBe('-');
    expect(invocation.stdin).toContain('MAPLE-86');
    expect(invocation.stdin).toContain('Compare changes.');
    expect(invocation.stdin).not.toContain('PRIVATE_MARKER_DO_NOT_SEND');
    expect(listIdeas(store, project.id)).toHaveLength(0);
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();
  });

  it('rejects malformed ideas, agent replies, unsupported agents, and invalid conversation bounds', async () => {
    const { store, project } = fixture();
    expect(() => saveIdea(store, { projectId: project.id, title: ' ', body: '', category: 'idea', turns: [] })).toThrow('required');
    expect(() => saveIdea(store, { projectId: project.id, title: 'Valid', body: '', category: 'unknown' as 'idea', turns: [] })).toThrow('category');
    expect(() => validateIdeaReply({ reply: 'Hi', suggestedTitle: '', suggestedBody: '', suggestedCategory: 'urgent' })).toThrow('category');
    await expect(discussIdea(store, { projectId: project.id, title: '', body: '', category: 'idea', turns: [{ role: 'assistant', text: 'Hi' }] }, async () => undefined)).rejects.toThrow('last idea turn');
    await expect(discussIdea(store, { projectId: project.id, title: '', body: '', category: 'idea', turns: Array.from({ length: 13 }, () => ({ role: 'user', text: 'x' })) }, async () => undefined)).rejects.toThrow('1-12 turns');
    const otherAgent = store.saveAgent({ name: 'Other', kind: 'claude', command: process.execPath, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: otherAgent.id, model: null, effort: null });
    await expect(discussIdea(store, { projectId: project.id, title: '', body: '', category: 'idea', turns: [{ role: 'user', text: 'Hi' }] }, async () => undefined)).rejects.toThrow('nur Codex CLI');
    store.close();
  });
});
