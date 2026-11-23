import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const doctor = resolve('scripts/doctor.mjs');

describe.skipIf(process.platform !== 'win32')('doctor CLI path check', () => {
  it('recognizes the verified Codex WinGet shim even with a stale PATH', () => {
    const localData = mkdtempSync(join(tmpdir(), 'branchloom-doctor-'));
    try {
      const shimDir = join(localData, 'CodexCLI', 'bin');
      const packageDir = join(localData, 'Microsoft', 'WinGet', 'Packages', 'OpenAI.Codex_Microsoft.WinGet.Source_fixture');
      const target = join(packageDir, 'codex-x86_64-pc-windows-msvc.exe');
      mkdirSync(shimDir, { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(target, 'synthetic executable placeholder');
      const shim = join(shimDir, 'codex.cmd');
      writeFileSync(shim, `@echo off\r\n"${target}" %*\r\n`);
      const run = () => spawnSync(process.execPath, [doctor], {
        cwd: resolve('.'), encoding: 'utf8',
        env: { ...process.env, LOCALAPPDATA: localData, PATH: '', Path: '' },
      });
      expect(run().stdout).toContain('OK  codex CLI-Pfad (kein Login-Test)');
      writeFileSync(shim, `@echo off\r\n"${target}" %*\r\necho extra\r\n`);
      expect(run().stdout).toContain('optional  codex CLI-Pfad (kein Login-Test)');
    } finally {
      rmSync(localData, { recursive: true, force: true });
    }
  });
});
