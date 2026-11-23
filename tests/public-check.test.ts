import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const guard = resolve('scripts/check-public.mjs');
const temporary: string[] = [];

function checkedFile(name: string, content: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-studio-public-'));
  temporary.push(dir);
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(init.stderr);
  writeFileSync(join(dir, name), content);
  const add = spawnSync('git', ['add', '--', name], { cwd: dir, encoding: 'utf8' });
  if (add.status !== 0) throw new Error(add.stderr);
  const result = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('public repository guard', () => {
  it('allows ordinary source', () => {
    expect(checkedFile('readme.md', '# Jarvis Studio\n').status).toBe(0);
  });

  it('rejects a staged token without printing it', () => {
    const token = 'sk-' + 'x'.repeat(24);
    const result = checkedFile('config.ts', `export const example = '${token}';\n`);
    expect(result.status).toBe(1);
    expect(result.output).toContain('sensitive content pattern');
    expect(result.output).not.toContain(token);
  });

  it('checks the staged blob even when the working tree has been cleaned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'branchloom-index-'));
    temporary.push(dir);
    const token = 'sk-' + 'i'.repeat(24);
    const file = join(dir, 'config.ts');
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git('init', '-q');
    writeFileSync(file, `export default '${token}';\n`);
    git('add', 'config.ts');
    writeFileSync(file, 'export default "safe";\n');
    const result = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sensitive content pattern');
    expect(result.stderr).not.toContain(token);
  });

  it('rejects a tracked credential file by path', () => {
    expect(checkedFile('.env', 'PLACEHOLDER=yes\n').status).toBe(1);
  });

  it('rejects a secret that was committed and then deleted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-studio-history-'));
    temporary.push(dir);
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git('init', '-q');
    git('config', 'user.name', 'Synthetic Test');
    git('config', 'user.email', 'synthetic@example.invalid');
    const token = 'sk-' + 'z'.repeat(24);
    writeFileSync(join(dir, 'old-config.ts'), `export default '${token}';\n`);
    git('add', 'old-config.ts');
    git('commit', '-qm', 'synthetic first commit');
    rmSync(join(dir, 'old-config.ts'));
    writeFileSync(join(dir, 'readme.md'), '# Clean current tree\n');
    git('add', '-A');
    git('commit', '-qm', 'remove synthetic secret');
    const result = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sensitive content pattern');
    expect(result.stderr).not.toContain(token);
  });
});
