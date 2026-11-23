import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExecutable, SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const liveIt = process.env.JARVIS_STUDIO_LIVE_CODEX === '1' ? it : it.skip;

liveIt('finishes one real Codex workflow step and persists the gated result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-live-workflow-'));
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  let runner: SessionRunner | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    const readme = 'The synthetic workflow verification marker is PINE-982.\n';
    writeFileSync(join(root, 'README.md'), readme);
    const project = store.createProject({ name: 'Synthetic workflow QA', path: root });
    const columns = store.snapshot(project.id).columns;
    const card = store.createCard({
      projectId: project.id, columnId: columns[0]!.id, title: 'Report the README marker',
      description: 'Read README.md and report its exact verification marker. Do not change any file.',
    });
    const executable = resolveExecutable('codex');
    if (!executable) throw new Error('Codex CLI unavailable');
    const agent = store.saveAgent({ name: 'Codex workflow QA', kind: 'codex', command: executable,
      args: ['--ignore-user-config'], model: null, enabled: true });
    const flow = store.createWorkflow({ projectId: project.id, name: 'One verified step', cardIds: [card.id],
      steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });

    let finish!: (state: string) => void;
    const ended = new Promise<string>((resolve) => { finish = resolve; });
    let engine!: WorkflowEngine;
    runner = new SessionRunner(store, () => undefined, (session, finalMessage) => {
      engine.onSessionFinished(session, finalMessage);
      finish(store.workflow(flow.id).state);
    });
    engine = new WorkflowEngine(store, runner);
    engine.setState({ id: flow.id, state: 'running' });
    expect(store.card(card.id).columnId).toBe(columns[2]!.id);
    const timed = new Promise<string>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Workflow timed out: ${store.snapshot(project.id).sessions.at(-1)?.output.slice(-1200) ?? 'no session'}`)), 90_000);
    });
    expect(await Promise.race([ended, timed])).toBe('done');
    expect(store.workflow(flow.id).state).toBe('done');
    const sessions = store.snapshot(project.id).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.state).toBe('exited');
    expect(sessions[0]?.exitCode).toBe(0);
    expect(sessions[0]?.output).toContain('PINE-982');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme);
    runner.dispose(); runner = null;
    store.close();
    const reopened = new StudioStore(dbPath);
    try {
      expect(reopened.workflow(flow.id).state).toBe('done');
      expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    } finally { reopened.close(); }
  } finally {
    if (timeout) clearTimeout(timeout);
    runner?.dispose();
    try { store.close(); } catch { /* Already closed after success. */ }
    for (let retry = 0; retry < 30; retry += 1) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) { if (retry === 29) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  }
}, 105_000);
