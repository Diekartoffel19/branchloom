import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { SessionRunner } from '../../src/main/cli';
import { discussTaskDraft } from '../../src/main/task-draft';
import { discussIdea } from '../../src/main/ideas';
import { proposeWorkflow } from '../../src/main/workflow-planner';
import { proposeCardWireframe } from '../../src/main/wireframe-proposal';
import { assertSafeModelContext, scanModelContext } from '../../src/main/sensitive-content';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-sensitive-test-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'store.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Ordinary task' });
  const agent = store.saveAgent({ name: 'Codex fixture', kind: 'codex', command: process.execPath, args: [], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: null });
  return { root, store, project, card, agent };
}

describe('model handoff guard', () => {
  it('names field, line and category without returning detected values', () => {
    const token = 'sk-' + 'q'.repeat(24);
    const fields = [{ field: 'Beschreibung', text: `First line\nuse ${token}` }];
    expect(scanModelContext(fields)).toEqual([{ field: 'Beschreibung', line: 2, category: 'API-Schlüssel' }]);
    try { assertSafeModelContext(fields); throw new Error('Expected rejection'); }
    catch (error) {
      const message = String(error);
      expect(message).toContain('Beschreibung, Zeile 2 (API-Schlüssel)');
      expect(message).not.toContain(token);
    }
  });

  it('allows normal code, package names and relative paths', () => {
    expect(scanModelContext([{ field: 'code', text: 'Use process.env.OPENAI_API_KEY in src/config.ts.\nDocument .env.example with a placeholder.\nWork in packages/ui.' }])).toEqual([]);
  });

  it('recognizes a concrete home path and named key assignment without echoing them', () => {
    const key = 'OPENROUTER_API_KEY=' + 'k'.repeat(20);
    const home = ['C:', 'Users', 'example', 'Documents'].join('\\');
    const findings = scanModelContext([{ field: 'Kontext', text: `${key}\n${home}` }]);
    expect(findings).toEqual([
      { field: 'Kontext', line: 1, category: 'API-Schlüssel-Zuweisung' },
      { field: 'Kontext', line: 2, category: 'privater Benutzerpfad' },
    ]);
    expect(() => assertSafeModelContext([{ field: 'Kontext', text: `${key}\n${home}` }])).toThrow('Modellübergabe gesperrt');
  });

  it('blocks a card CLI start before creating a session or worktree', () => {
    const { store, card, agent } = fixture();
    const token = 'ghp_' + 'a'.repeat(25);
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    try {
      expect(() => runner.start({ cardId: card.id, agentId: agent.id, prompt: `Start\n${token}`, useWorktree: true })).toThrow('Agentenauftrag, Zeile 2');
      expect(store.snapshot(card.projectId).sessions).toHaveLength(0);
      expect(store.cardWorktree(card.id)).toBeNull();
    } finally { runner.dispose(); store.close(); }
  });

  it('rejects read-only discussions and planning before calling the executor', async () => {
    const { root, store, project, card } = fixture();
    const token = 'sk-' + 'r'.repeat(24);
    let calls = 0;
    const execute = async () => { calls++; };
    try {
      await expect(discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'user', text: `Discuss\n${token}` }] }, execute)).rejects.toThrow('Gesprächsbeitrag 1 (user), Zeile 2');
      await expect(discussIdea(store, { projectId: project.id, title: 'Idea', body: `Notes\n${token}`, category: 'idea', turns: [{ role: 'user', text: 'Discuss' }] }, execute)).rejects.toThrow('Ideennotizen, Zeile 2');
      await expect(proposeWorkflow(store, { projectId: project.id, request: `Plan\n${token}` }, execute)).rejects.toThrow('Planungswunsch, Zeile 2');
      writeFileSync(join(root, 'README.md'), `Project notes\n${token}`);
      await expect(proposeCardWireframe(store, { projectId: project.id, cardId: card.id }, execute)).rejects.toThrow('Projekt-README');
      expect(calls).toBe(0);
    } finally { store.close(); }
  });
});
