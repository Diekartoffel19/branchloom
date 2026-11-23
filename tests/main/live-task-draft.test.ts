import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExecutable } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { discussTaskDraft } from '../../src/main/task-draft';

const liveIt = process.env.JARVIS_STUDIO_LIVE_CODEX === '1' ? it : it.skip;

liveIt('discusses a synthetic task using the installed Codex CLI without changing the repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-live-task-draft-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  try {
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    writeFileSync(join(root, 'README.md'), 'This synthetic project uses the accent token CUPRITE-47 for its UI.\n');
    const project = store.createProject({ name: 'Synthetic design project', path: root });
    const executable = resolveExecutable('codex');
    if (!executable) throw new Error('Codex CLI unavailable');
    const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: executable, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'low' });
    const answer = await discussTaskDraft(store, { projectId: project.id, turns: [{ role: 'user', text: 'Propose one small task to clarify the UI color in the README. Include the exact existing accent token in the acceptance check. Do not edit files.' }] });
    expect(answer.reply.length).toBeGreaterThan(0);
    expect(answer.ready).toBe(true);
    expect(answer.specTitle.length).toBeGreaterThan(0);
    expect(answer.specDescription).toContain('CUPRITE-47');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('This synthetic project uses the accent token CUPRITE-47 for its UI.\n');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
  } finally {
    store.close();
    for (let retry = 0; retry < 30; retry += 1) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) { if (retry === 29) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  }
}, 120_000);
