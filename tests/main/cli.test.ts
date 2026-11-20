import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '../../src/shared/types';
import { resolveAgentLauncher, SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-pty-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'store.sqlite'));
  const project = store.createProject({ name: 'PTY fixture', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Run a real process' });
  return { store, card };
}

describe('real CLI PTY', () => {
  it('streams output, persists it, and records a successful exit', async () => {
    const { store, card } = fixture();
    const agent = store.saveAgent({ name: 'Node fixture', kind: 'custom', command: process.execPath, args: ['-e', 'console.log("REAL_PTY_OK")'], model: null, enabled: true });
    const events: SessionEvent[] = [];
    let finish!: (value: string) => void;
    const ended = new Promise<string>((resolve) => { finish = resolve; });
    const runner = new SessionRunner(store, (event) => events.push(event), (session) => finish(session.id));
    const session = runner.start({ cardId: card.id, agentId: agent.id, prompt: '' });
    const finishedId = await Promise.race([ended, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('PTY did not exit')), 10_000))]);
    expect(finishedId).toBe(session.id);
    expect(store.session(session.id).state).toBe('exited');
    expect(store.session(session.id).output).toContain('REAL_PTY_OK');
    expect(events.some((event) => event.type === 'output' && event.data.includes('REAL_PTY_OK'))).toBe(true);
    runner.dispose();
    store.close();
  }, 15_000);

  it('stops an explicitly launched long-running process', async () => {
    const { store, card } = fixture();
    const agent = store.saveAgent({ name: 'Waiting fixture', kind: 'custom', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const session = runner.start({ cardId: card.id, agentId: agent.id, prompt: '' });
    runner.stop(session.id);
    expect(store.session(session.id).state).toBe('stopped');
    runner.dispose();
    store.close();
  });

  it('unwraps a simple npm CMD shim to Node without running the batch file', async () => {
    const { store, card } = fixture();
    const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-shim-'));
    roots.push(root);
    const script = join(root, 'agent.js');
    const shim = join(root, 'agent.cmd');
    writeFileSync(script, 'console.log("SHIM_OK")');
    writeFileSync(shim, '@ECHO off\r\nECHO THIS_BATCH_MUST_NOT_RUN\r\n"%_prog%" "%dp0%\\agent.js" %*\r\n');
    const launcher = resolveAgentLauncher(shim);
    expect(launcher?.prefixArgs).toEqual([script]);
    const agent = store.saveAgent({ name: 'Shim fixture', kind: 'custom', command: shim, args: [], model: null, enabled: true });
    let finish!: (id: string) => void;
    const ended = new Promise<string>((resolve) => { finish = resolve; });
    const runner = new SessionRunner(store, () => undefined, (session) => finish(session.id));
    const session = runner.start({ cardId: card.id, agentId: agent.id, prompt: '' });
    await Promise.race([ended, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Shim did not exit')), 10_000))]);
    expect(store.session(session.id).output).toContain('SHIM_OK');
    expect(store.session(session.id).output).not.toContain('THIS_BATCH_MUST_NOT_RUN');
    runner.dispose();
    store.close();
  }, 15_000);
});
