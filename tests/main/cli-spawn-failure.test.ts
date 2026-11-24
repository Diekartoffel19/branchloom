import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSpawnError, SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

vi.mock('node-pty', () => ({ spawn: () => { throw new Error('synthetic OS spawn failure'); } }));

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

describe('agent spawn failure boundary', () => {
  it('marks a synchronous PTY spawn exception as safe to retry only after the session is failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-spawn-failure-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'store.sqlite'));
    try {
      const project = store.createProject({ name: 'Synthetic', path: root });
      const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Spawn test' });
      const agent = store.saveAgent({ name: 'Node synthetic', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
      const runner = new SessionRunner(store, () => undefined, () => undefined);
      expect(() => runner.start({ cardId: card.id, agentId: agent.id, prompt: 'Synthetic task' })).toThrow(AgentSpawnError);
      const sessions = store.snapshot(project.id).sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.state).toBe('failed');
      expect(store.activeSessionForProject(project.id)).toBeNull();
      runner.dispose();
    } finally { store.close(); }
  });

  it('keeps a missing executable outside the retry classification', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-missing-cli-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'store.sqlite'));
    try {
      const project = store.createProject({ name: 'Synthetic', path: root });
      const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Missing CLI' });
      const agent = store.saveAgent({ name: 'Missing synthetic', kind: 'custom', command: 'missing-branchloom-cli-that-does-not-exist', args: [], model: null, enabled: true });
      const runner = new SessionRunner(store, () => undefined, () => undefined);
      let error: unknown;
      try { runner.start({ cardId: card.id, agentId: agent.id, prompt: 'Synthetic task' }); } catch (value) { error = value; }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AgentSpawnError);
      expect(store.snapshot(project.id).sessions).toHaveLength(0);
      runner.dispose();
    } finally { store.close(); }
  });
});
