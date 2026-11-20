import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DONE_MARKER, resolveExecutable, SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const liveIt = process.env.JARVIS_STUDIO_LIVE_CODEX === '1' ? it : it.skip;

liveIt('runs the installed Codex CLI through the real PTY without modifying a synthetic project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-live-codex-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const executable = resolveExecutable('codex');
  if (!executable) throw new Error('Codex CLI is unavailable');
  let runner: SessionRunner | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    writeFileSync(join(root, 'README.md'), 'The synthetic answer is cobalt blue.\n');
    const project = store.createProject({ name: 'Codex smoke', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Read a fixture' });
    const preset = store.saveAgent({ name: 'Codex smoke', kind: 'codex', command: executable, args: ['--ignore-user-config'], model: null, enabled: true });
    let finish!: (value: { id: string; finalMessage: string | null }) => void;
    const ended = new Promise<{ id: string; finalMessage: string | null }>((resolve) => { finish = resolve; });
    runner = new SessionRunner(store, () => undefined, (session, finalMessage) => finish({ id: session.id, finalMessage }));
    const launched = runner.start({ cardId: card.id, agentId: preset.id, mode: 'one-shot', prompt: `Read README.md and report its color. Do not edit files. End with ${DONE_MARKER} as the exact final line.` });
    const timer = new Promise<{ id: string; finalMessage: string | null }>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Codex smoke timed out. Last output: ${store.session(launched.id).output.slice(-1200)}`)), 90_000); });
    const result = await Promise.race([ended, timer]);
    expect(result.id).toBe(launched.id);
    expect(store.session(result.id).exitCode, store.session(result.id).output.slice(-2000)).toBe(0);
    expect(result.finalMessage?.toLowerCase()).toContain('cobalt blue');
    expect(result.finalMessage?.trimEnd().split('\n').at(-1)).toBe(DONE_MARKER);
  } finally {
    if (timeout) clearTimeout(timeout);
    runner?.dispose();
    store.close();
    for (let retry = 0; retry < 30; retry += 1) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) {
        if (retry === 29) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}, 105_000);
