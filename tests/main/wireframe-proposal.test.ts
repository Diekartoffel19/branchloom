import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cardWireframe } from '../../src/main/card-wireframe';
import { StudioStore } from '../../src/main/store';
import { proposeCardWireframe } from '../../src/main/wireframe-proposal';
import type { PlannerInvocation } from '../../src/main/workflow-planner';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-wireframe-agent-test-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic project', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Build a desktop window', description: 'Show a navigation panel and a search field.' });
  const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: process.execPath, args: ['--dangerously-bypass-approvals-and-sandbox'], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: 'synthetic-model', effort: 'low' });
  return { root, store, project, card, key: { projectId: project.id, cardId: card.id } };
}

const output = { title: 'Desktop-Fenster', elements: [
  { id: 'search', kind: 'field', x: 35, y: 40, width: 300, height: 44, text: 'Suchen', tone: 'plain' },
] };

describe('read-only wireframe proposal', () => {
  it('uses only bounded card and README context, and leaves persistence and sessions untouched', async () => {
    const { root, store, project, key } = fixture();
    writeFileSync(join(root, 'README.md'), 'Synthetic project context: CEDAR-46.');
    writeFileSync(join(root, '.env'), 'PRIVATE_NOT_FOR_CONTEXT=secret');
    let invocation!: PlannerInvocation;
    const proposal = await proposeCardWireframe(store, key, async (call) => {
      invocation = call;
      writeFileSync(call.outputPath, JSON.stringify(output));
    });
    expect(proposal).toMatchObject(output);
    expect(proposal.sourceCardUpdatedAt).toBeTruthy();
    expect(invocation.cwd).not.toBe(root);
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).toContain('--ignore-user-config');
    expect(invocation.args).toContain('--ephemeral');
    expect(invocation.args).toContain('synthetic-model');
    expect(invocation.args).toContain('model_reasoning_effort="low"');
    expect(invocation.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(invocation.args.at(-1)).toBe('-');
    expect(invocation.stdin).toContain('CEDAR-46');
    expect(invocation.stdin).toContain('navigation panel and a search field');
    expect(invocation.stdin).not.toContain('PRIVATE_NOT_FOR_CONTEXT');
    expect(cardWireframe(store, key)).toBeNull();
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
  });

  it('rejects malformed proposal geometry or JSON and stale card content without saving', async () => {
    const { store, card, key } = fixture();
    await expect(proposeCardWireframe(store, key, async (call) => writeFileSync(call.outputPath, JSON.stringify({ ...output, elements: [{ ...output.elements[0], x: 940 }] })))).rejects.toThrow('außerhalb');
    await expect(proposeCardWireframe(store, key, async (call) => writeFileSync(call.outputPath, 'not-json'))).rejects.toThrow('JSON');
    await expect(proposeCardWireframe(store, key, async () => undefined)).rejects.toThrow('keinen Entwurf');
    await expect(proposeCardWireframe(store, key, async (call) => {
      store.updateCard({ id: card.id, description: 'Changed while agent was working.' });
      writeFileSync(call.outputPath, JSON.stringify(output));
    })).rejects.toThrow('während des Entwurfs geändert');
    expect(cardWireframe(store, key)).toBeNull();
    store.close();
  });

  it('enforces the project boundary and supported CLI adapter before execution', async () => {
    const { root, store, key } = fixture();
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    let calls = 0;
    await expect(proposeCardWireframe(store, { projectId: other.id, cardId: key.cardId }, async () => { calls++; })).rejects.toThrow('gehört nicht');
    const claude = store.saveAgent({ name: 'Claude', kind: 'claude', command: process.execPath, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: claude.id, model: null, effort: null });
    await expect(proposeCardWireframe(store, key, async () => { calls++; })).rejects.toThrow('nur Codex CLI');
    expect(calls).toBe(0);
    store.close();
  });
});
