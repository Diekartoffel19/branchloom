import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildAntigravityArgs } from '../../src/main/antigravity';
import { columnSettings } from '../../src/shared/column-settings';

describe('Antigravity CLI argument contract', () => {
  it('passes an interactive first prompt as one argument after model and effort', () => {
    const prompt = 'Review this code.\nExplain the result.';
    expect(buildAntigravityArgs(['--agent', 'reviewer'], prompt, 'interactive', 'synthetic-model', 'high')).toEqual([
      '--agent', 'reviewer', '--model', 'synthetic-model', '--effort', 'high', '-i', prompt,
    ]);
  });

  it('passes a headless workflow prompt to a fake executable without a shell', () => {
    const prompt = 'Synthetic task; $(do-not-run)';
    const args = buildAntigravityArgs([], prompt, 'one-shot', 'synthetic-model', 'medium');
    const fake = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args], { shell: false, encoding: 'utf8' });
    expect(fake.status).toBe(0);
    expect(JSON.parse(fake.stdout)).toEqual(args);
  });

  it('rejects the unattended permission bypass and unsupported effort', () => {
    expect(() => buildAntigravityArgs(['--dangerously-skip-permissions'], 'Task', 'one-shot', null, null)).toThrow('Permission-Bypass');
    expect(() => buildAntigravityArgs([], '', 'one-shot', null, null)).toThrow('Prompt');
    expect(() => buildAntigravityArgs([], 'Task', 'one-shot', null, 'ultra')).toThrow('max');
    expect(columnSettings('antigravity', 'synthetic-model', 'max')).toEqual({ model: 'synthetic-model', effort: 'max' });
    expect(() => columnSettings('antigravity', null, 'ultra')).toThrow('max');
  });
});
