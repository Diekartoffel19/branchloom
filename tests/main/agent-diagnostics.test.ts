import { describe, expect, it } from 'vitest';
import { detectAgents, readVersion } from '../../src/main/cli';
import type { AgentPreset } from '../../src/shared/types';

describe('local agent diagnostics', () => {
  it('reads a real local version without a shell', async () => {
    const result = await readVersion({ executable: process.execPath, prefixArgs: [] }, 2_000, process.env);
    expect(result).toMatchObject({ status: 'ready' });
    expect(result.version).toMatch(/^v\d/);
  });

  it('reports a hung and a failing process distinctly', async () => {
    const hung = await readVersion({ executable: process.execPath, prefixArgs: [] }, 150, process.env, ['-e', 'setTimeout(() => {}, 10000)']);
    const failed = await readVersion({ executable: process.execPath, prefixArgs: [] }, 2_000, process.env, ['-e', 'process.exit(2)']);
    expect(hung).toEqual({ status: 'timeout', version: null });
    expect(failed).toEqual({ status: 'error', version: null });
  });

  it('checks saved custom commands by path without running them', async () => {
    const profile: AgentPreset = { id: 'custom-id', name: 'Fixture', kind: 'custom', command: process.execPath, args: ['-e', 'process.exit(42)'], model: null, enabled: true };
    const results = await detectAgents([profile], { ...process.env, PATH: '', Path: '' });
    expect(results).toHaveLength(4);
    expect(results.slice(0, 3).map((item) => item.status)).toEqual(['missing', 'missing', 'missing']);
    expect(results[3]).toMatchObject({ profileId: 'custom-id', status: 'found', available: true, version: null });
    const renamed = await detectAgents([{ ...profile, id: 'renamed', kind: 'codex' }], { ...process.env, PATH: '', Path: '' });
    expect(renamed[3]).toMatchObject({ profileId: 'renamed', status: 'found', available: true, version: null });
  });
});
