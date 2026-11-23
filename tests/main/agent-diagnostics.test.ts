import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { detectAgents, readVersion, resolveAgentLauncher, resolveExecutable } from '../../src/main/cli';
import type { AgentPreset } from '../../src/shared/types';

describe('local agent diagnostics', () => {
  it('reads a real local version without a shell', async () => {
    const result = await readVersion({ executable: process.execPath, prefixArgs: [] }, 10_000, process.env);
    expect(result).toMatchObject({ status: 'ready' });
    expect(result.version).toMatch(/^v\d/);
  });

  it('reports a hung and a failing process distinctly', async () => {
    const hung = await readVersion({ executable: process.execPath, prefixArgs: [] }, 150, process.env, ['-e', 'setTimeout(() => {}, 10000)']);
    const failed = await readVersion({ executable: process.execPath, prefixArgs: [] }, 10_000, process.env, ['-e', 'process.exit(2)']);
    expect(hung).toEqual({ status: 'timeout', version: null });
    expect(failed).toEqual({ status: 'error', version: null });
  });

  it('checks saved custom commands by path without running them', async () => {
    const profile: AgentPreset = { id: 'custom-id', name: 'Fixture', kind: 'custom', command: process.execPath, args: ['-e', 'process.exit(42)'], model: null, enabled: true };
    const env = { ...process.env, PATH: '', Path: '', LOCALAPPDATA: '', HOME: '' };
    const results = await detectAgents([profile], env);
    expect(results).toHaveLength(5);
    expect(results.slice(0, 4).map((item) => item.status)).toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(results[4]).toMatchObject({ profileId: 'custom-id', status: 'found', available: true, version: null });
    const renamed = await detectAgents([{ ...profile, id: 'renamed', kind: 'codex' }], env);
    expect(renamed[4]).toMatchObject({ profileId: 'renamed', status: 'found', available: true, version: null });
  });

  it.skipIf(process.platform !== 'win32')('detects an agy-shaped Node shim and probes its version without a model call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-agy-fixture-'));
    try {
      writeFileSync(join(root, 'agy.cjs'), 'if (process.argv[2] === "--version") console.log("agy-fixture 1.0.0"); else process.exit(7);');
      writeFileSync(join(root, 'agy.cmd'), '@echo off\r\n"%~dp0\\node.exe" "%~dp0\\agy.cjs" %*\r\n');
      const env = { ...process.env, PATH: `${root}${delimiter}${dirname(process.execPath)}`, Path: '', LOCALAPPDATA: '' };
      const results = await detectAgents([], env);
      expect(results[3]).toMatchObject({ kind: 'antigravity', command: 'agy', status: 'ready', available: true, version: 'agy-fixture 1.0.0' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('finds the official Windows install path when PATH has not refreshed', () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-agy-install-'));
    try {
      const binary = join(root, 'agy', 'bin', 'agy.exe');
      mkdirSync(join(root, 'agy', 'bin'), { recursive: true });
      writeFileSync(binary, 'synthetic binary placeholder');
      expect(resolveExecutable('agy', { PATH: '', Path: '', LOCALAPPDATA: root })).toBe(binary);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('unwraps only the official Codex WinGet shim into its native executable', () => {
    const localAppData = mkdtempSync(join(tmpdir(), 'branchloom-codex-shim-'));
    try {
      const shimDirectory = join(localAppData, 'CodexCLI', 'bin');
      const packageDirectory = join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'OpenAI.Codex_Microsoft.Winget.Source_fixture');
      const target = join(packageDirectory, 'codex-x86_64-pc-windows-msvc.exe');
      mkdirSync(shimDirectory, { recursive: true });
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(target, 'synthetic executable placeholder');
      const shim = join(shimDirectory, 'codex.cmd');
      const env = { ...process.env, LOCALAPPDATA: localAppData };
      const officialWrapper = `@echo off\r\n"${target}" %*\r\n`;
      writeFileSync(shim, officialWrapper);
      expect(resolveAgentLauncher(shim, env)).toEqual({ executable: target, prefixArgs: [] });

      writeFileSync(shim, `${officialWrapper}echo SHOULD_NOT_RUN\r\n`);
      expect(resolveAgentLauncher(shim, env)).toBeNull();
      writeFileSync(shim, `@echo off\r\n"${process.execPath}" %*\r\n`);
      expect(resolveAgentLauncher(shim, env)).toBeNull();
      writeFileSync(shim, officialWrapper);
      rmSync(target);
      expect(resolveAgentLauncher(shim, env)).toBeNull();
    } finally {
      rmSync(localAppData, { recursive: true, force: true });
    }
  });
});
