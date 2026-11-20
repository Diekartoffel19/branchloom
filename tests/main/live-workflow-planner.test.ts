import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExecutable } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { proposeWorkflow } from '../../src/main/workflow-planner';

const liveIt = process.env.JARVIS_STUDIO_LIVE_CODEX === '1' ? it : it.skip;

liveIt('gets a read-only structured plan from installed Codex without creating cards', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-live-plan-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  try {
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    writeFileSync(join(root, 'README.md'), 'This synthetic project has a single README.\n');
    const project = store.createProject({ name: 'Synthetic project', path: root });
    const executable = resolveExecutable('codex');
    if (!executable) throw new Error('Codex CLI unavailable');
    const agent = store.saveAgent({ name: 'Codex planner', kind: 'codex', command: executable, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'low' });
    const proposal = await proposeWorkflow(store, { projectId: project.id, request: 'Plan one card to improve the synthetic README wording, then one card to review it. Do not change any file.' });
    expect(proposal.cards.length).toBeGreaterThanOrEqual(1);
    expect(proposal.columnIds.length).toBeGreaterThanOrEqual(1);
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('This synthetic project has a single README.\n');
  } finally {
    store.close();
    for (let retry = 0; retry < 30; retry += 1) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) {
        if (retry === 29) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}, 120_000);
