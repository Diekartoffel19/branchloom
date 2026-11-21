import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '../../src/shared/types';
import { resolveAgentLauncher, SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      // ConPTY can briefly retain handles after child.kill() on Windows.
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-pty-'));
  roots.push(root);
  const dbPath = join(root, 'store.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'PTY fixture', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Run a real process' });
  return { store, card, dbPath };
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

  it('runs a synthetic Antigravity-shaped CLI through the real PTY with column flags', async () => {
    const { store, card } = fixture();
    const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-agy-'));
    roots.push(root);
    const script = join(root, 'agy-fixture.cjs');
    writeFileSync(script, 'console.log("AGY_ARGS=" + JSON.stringify(process.argv.slice(2)))');
    const agent = store.saveAgent({ name: 'Antigravity fixture', kind: 'antigravity', command: process.execPath, args: [script], model: null, enabled: true });
    store.updateColumn({ id: card.columnId, agentId: agent.id, model: 'synthetic-model', effort: 'high' });
    let finish!: (id: string) => void;
    const ended = new Promise<string>((resolve) => { finish = resolve; });
    const runner = new SessionRunner(store, () => undefined, (session) => finish(session.id));
    try {
      const session = runner.start({ cardId: card.id, mode: 'one-shot', prompt: 'Synthetic task' });
      await Promise.race([ended, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Fake agy did not exit')), 10_000))]);
      const saved = store.session(session.id);
      expect(saved.state).toBe('exited');
      expect(saved.output).toContain('AGY_ARGS=');
      expect(saved.output).toContain('"--model","synthetic-model","--effort","high","-p","Synthetic task"');
    } finally {
      runner.dispose();
      store.close();
    }
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

  it('allows parallel manual cards while the project queue is off', () => {
    const { store, card } = fixture();
    const second = store.createCard({ projectId: card.projectId, columnId: card.columnId, title: 'Another manual task' });
    const agent = store.saveAgent({ name: 'Waiting fixture', kind: 'custom', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const firstRun = runner.start({ cardId: card.id, agentId: agent.id, prompt: '' });
    const secondRun = runner.start({ cardId: second.id, agentId: agent.id, prompt: '' });
    expect(store.session(firstRun.id).state).toBe('running');
    expect(store.session(secondRun.id).state).toBe('running');
    runner.stop(firstRun.id);
    runner.stop(secondRun.id);
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

  it('validates and applies a bounded terminal resize only while running', async () => {
    const { store, card } = fixture();
    const agent = store.saveAgent({ name: 'Resize fixture', kind: 'custom', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const session = runner.start({ cardId: card.id, agentId: agent.id, prompt: '' });
    expect(() => runner.resize({ sessionId: session.id, cols: 80, rows: 25 })).not.toThrow();
    expect(() => runner.resize({ sessionId: session.id, cols: 100, rows: 40 })).not.toThrow();
    expect(() => runner.resize({ sessionId: session.id, cols: 0, rows: 40 })).toThrow('Terminalgröße');
    expect(() => runner.resize({ sessionId: session.id, cols: 100.5, rows: 40 })).toThrow('Terminalgröße');
    runner.stop(session.id);
    expect(() => runner.resize({ sessionId: session.id, cols: 100, rows: 40 })).toThrow('läuft nicht');
    runner.dispose();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    store.close();
  }, 15_000);

  it('recovers an interrupted session as failed without replaying it', () => {
    const { store, card, dbPath } = fixture();
    const agent = store.agents()[0]!;
    const original = store.createSession({ cardId: card.id, agentId: agent.id });
    store.appendOutput(original.id, 'Synthetic output before interruption.');
    store.close();
    const reopened = new StudioStore(dbPath);
    const recovered = reopened.session(original.id);
    expect(recovered.state).toBe('failed');
    expect(recovered.endedAt).not.toBeNull();
    expect(recovered.output).toContain('Synthetic output before interruption.');
    expect(recovered.output).toContain('restarted');
    const events: SessionEvent[] = [];
    const runner = new SessionRunner(reopened, (event) => events.push(event), () => undefined);
    expect(events).toHaveLength(0);
    expect(() => runner.send({ sessionId: original.id, text: 'retry' })).toThrow('not running');
    expect(() => runner.stop(original.id)).toThrow('not running');
    expect(reopened.snapshot(card.projectId).sessions).toHaveLength(1);
    runner.dispose();
    reopened.close();
    const secondOpen = new StudioStore(dbPath);
    expect(secondOpen.session(original.id).output).toBe(recovered.output);
    secondOpen.close();
  });
});
