import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExecutable } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { discussIdea, listIdeas } from '../../src/main/ideas';

const liveIt = process.env.JARVIS_STUDIO_LIVE_CODEX === '1' ? it : it.skip;

liveIt('brainstorms with real Codex using only a synthetic README and creates no idea or card', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-live-ideas-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  try {
    const readme = 'This synthetic project calls its planning board ORCHARD-68.\n';
    writeFileSync(join(root, 'README.md'), readme);
    writeFileSync(join(root, '.env'), 'PRIVATE_SYNTHETIC_MARKER=DO_NOT_DISCLOSE');
    const project = store.createProject({ name: 'Synthetic planning project', path: root });
    const executable = resolveExecutable('codex');
    if (!executable) throw new Error('Codex CLI unavailable');
    const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: executable, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'low' });
    const answer = await discussIdea(store, {
      projectId: project.id, title: '', body: '', category: 'idea',
      turns: [{ role: 'user', text: 'Brainstorm one use for the planning board named in the README. Include its exact name in your answer. Do not edit files.' }],
    });
    expect(answer.reply + answer.suggestedTitle + answer.suggestedBody).toContain('ORCHARD-68');
    expect(answer.reply + answer.suggestedTitle + answer.suggestedBody).not.toContain('DO_NOT_DISCLOSE');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme);
    expect(listIdeas(store, project.id)).toEqual([]);
    expect(store.snapshot(project.id).cards).toEqual([]);
  } finally {
    store.close();
    for (let retry = 0; retry < 30; retry += 1) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) { if (retry === 29) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  }
}, 120_000);
