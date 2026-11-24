import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-capabilities-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Safe local process' });
  const agent = store.saveAgent({ name: 'Node fixture', kind: 'custom', command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], model: null, enabled: true });
  return { store, dbPath, card, agent };
}

async function until(check: () => boolean, timeoutMs = 5_000) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Local capability evidence did not arrive');
}

describe('agent capability evidence from actual local operations', () => {
  it('records PTY start, accepted terminal write and observed exit after explicit stop, then survives restart', async () => {
    const { store, dbPath, card, agent } = fixture();
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    try {
      const run = runner.start({ cardId: card.id, agentId: agent.id, prompt: '' });
      expect(store.agentCapabilityEvidence().map((item) => item.capability)).toEqual(['start']);
      expect(() => runner.writeRaw({ sessionId: run.id, data: '' })).toThrow('Terminaleingabe');
      expect(store.agentCapabilityEvidence()).toHaveLength(1);
      runner.writeRaw({ sessionId: run.id, data: 'synthetic input\r' });
      expect(store.agentCapabilityEvidence().map((item) => item.capability)).toEqual(['input', 'start']);
      runner.stop(run.id);
      await until(() => store.agentCapabilityEvidence().some((item) => item.capability === 'stop'));
      expect(store.agentCapabilityEvidence()).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentId: agent.id, capability: 'start', sessionId: run.id }),
        expect.objectContaining({ agentId: agent.id, capability: 'input', sessionId: run.id }),
        expect.objectContaining({ agentId: agent.id, capability: 'stop', sessionId: run.id }),
      ]));
      runner.dispose();
      store.close();
      const reopened = new StudioStore(dbPath);
      try { expect(reopened.agentCapabilityEvidence()).toHaveLength(3); }
      finally { reopened.close(); }
    } finally {
      runner.dispose();
      if (store.db.open) store.close();
    }
  }, 15_000);

  it('does not infer capabilities from a stored session and clears proofs when launcher settings change', () => {
    const { store, card, agent } = fixture();
    try {
      const run = store.createSession({ cardId: card.id, agentId: agent.id });
      expect(store.agentCapabilityEvidence()).toEqual([]);
      expect(() => store.recordAgentCapability(run.id, 'resume')).toThrow('nur für Codex');
      store.recordAgentCapability(run.id, 'start');
      expect(() => store.saveAgent({ ...agent, args: ['--changed'] })).toThrow('Laufendes Agentenprofil');
      store.finishSession(run.id, 'exited', 0);
      expect(() => store.recordAgentCapability(run.id, 'input')).toThrow('Sitzungszustand');
      store.saveAgent({ ...agent, name: 'Renamed' });
      expect(store.agentCapabilityEvidence()).toHaveLength(1);
      store.saveAgent({ ...agent, name: 'Renamed', args: ['--changed'] });
      expect(store.agentCapabilityEvidence()).toEqual([]);
      expect(() => store.recordAgentCapability('missing', 'input')).toThrow('nicht gefunden');
    } finally { store.close(); }
  });
});
