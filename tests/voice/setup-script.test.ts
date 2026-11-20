import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts', 'setup-voice.ps1');
const windowsIt = process.platform === 'win32' ? it : it.skip;

function run(...args: string[]) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args,
  ], { encoding: 'utf8', timeout: 15_000 });
}

describe('Windows voice setup', () => {
  windowsIt('parses as PowerShell without syntax errors', () => {
    const code = `$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', code], {
      encoding: 'utf8', input: readFileSync(script, 'utf8'), timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
  });

  windowsIt('refuses a relative model folder before installing anything', () => {
    const result = run('-ModelDirectory', '.\\model');
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('absoluter Pfad');
  });

  windowsIt('refuses a drive-relative model folder', () => {
    const result = run('-ModelDirectory', 'C:model');
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('absoluter Pfad');
  });

  windowsIt('refuses to put a model in the public repository', () => {
    const result = run('-ModelDirectory', resolve(process.cwd(), 'data', 'voice-models'));
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('nicht im');
  });

  windowsIt('reports a missing Python without creating a virtual environment', () => {
    const result = run('-Python', resolve(tmpdir(), 'jarvis-studio-python-does-not-exist.exe'),
      '-ModelDirectory', resolve(tmpdir(), 'jarvis-studio-voice-models'));
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Python 3.13 fehlt');
  });

  it('pins the package versions and checks the model offline before downloading', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain('faster-whisper==1.2.1');
    expect(source).toContain('av==18.1.0');
    expect(source.indexOf('local_files_only=True')).toBeLessThan(source.indexOf('Whisper-base-Modell fehlt'));
  });
});
