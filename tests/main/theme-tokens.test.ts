import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { cssTokenDefinitions, scanThemeTokens } from '../../src/main/theme-tokens';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-theme-tokens-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const file = (path: string, content: string, tracked = true) => {
    const full = join(repo, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    if (tracked) execFileSync('git', ['-C', repo, 'add', '--', path]);
  };
  return { root, repo, store, project, file };
}

describe('project theme token inventory', () => {
  it('extracts source-backed custom properties while ignoring comments, strings, selectors and @property names', () => {
    const source = [
      '/* :root { --comment: red; } */',
      ':root {',
      '  content: "--string: yellow;";',
      '  --surface: #eee;',
      '  --font: "A; B";',
      '  --radius:',
      '    calc(4px + 2px);',
      '}',
      '@property --registered { syntax: "<color>"; }',
      '@theme { --color-accent: rgb(12, 34, 56); }',
      '.--selector:hover { color: red; }',
      ':root { --empty: ; }',
      ':root { --url: url(data:image/svg+xml;--fake:red); --after: green; }',
    ].join('\n');
    expect(cssTokenDefinitions(source)).toEqual([
      { name: '--surface', value: '#eee', valueTruncated: false, line: 4 },
      { name: '--font', value: '"A; B"', valueTruncated: false, line: 5 },
      { name: '--radius', value: 'calc(4px + 2px)', valueTruncated: false, line: 6 },
      { name: '--color-accent', value: 'rgb(12, 34, 56)', valueTruncated: false, line: 10 },
      { name: '--url', value: 'url(data:image/svg+xml;--fake:red)', valueTruncated: false, line: 13 },
      { name: '--after', value: 'green', valueTruncated: false, line: 13 },
    ]);
  });

  it('returns only tracked CSS from the requested project and detects changed local source', async () => {
    const { store, project, file } = fixture();
    file('src/theme.css', ':root { --surface: #eee; --radius: 4px; }');
    file('src/untracked.css', ':root { --secret: red; }', false);
    file('src/example.tsx', 'const copy = "--fake: red";');
    const first = await scanThemeTokens(store, project.id);
    expect(first).toMatchObject({ projectId: project.id, scannedFiles: 1, partial: false });
    expect(first.definitions.map((item) => [item.name, item.value, item.path, item.line])).toEqual([
      ['--surface', '#eee', 'src/theme.css', 1], ['--radius', '4px', 'src/theme.css', 1],
    ]);
    expect(first.definitions[0]?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    file('src/theme.css', ':root { --surface: #ddd; }');
    const next = await scanThemeTokens(store, project.id);
    expect(next.definitions).toHaveLength(1);
    expect(next.definitions[0]?.value).toBe('#ddd');
    expect(next.definitions[0]?.sourceFingerprint).not.toBe(first.definitions[0]?.sourceFingerprint);
    store.close();
  });

  it('marks oversized and symlinked tracked files incomplete without reading their targets', async () => {
    const { root, repo, store, project, file } = fixture();
    file('src/large.css', ':root { --large: red; }' + ' '.repeat(129 * 1024));
    const outside = join(root, 'outside.css');
    writeFileSync(outside, ':root { --outside: secret; }');
    const link = join(repo, 'src', 'linked.css');
    let linked = false;
    try { symlinkSync(outside, link, 'file'); execFileSync('git', ['-C', repo, 'add', '--', 'src/linked.css']); linked = true; }
    catch { /* Symlink creation may require Windows developer mode. */ }
    const result = await scanThemeTokens(store, project.id);
    expect(result.partial).toBe(true);
    expect(result.definitions).toEqual([]);
    expect(result.notes.join(' ')).toContain('128 KiB');
    if (linked) expect(result.notes.join(' ')).toContain('verlinkte');
    store.close();
  });

  it('rejects foreign IDs and project paths below the Git root', async () => {
    const { repo, store, project } = fixture();
    await expect(scanThemeTokens(store, 'foreign')).rejects.toThrow();
    const subdir = join(repo, 'src'); mkdirSync(subdir);
    const nested = store.createProject({ name: 'Nested', path: subdir });
    await expect(scanThemeTokens(store, nested.id)).rejects.toThrow('Git-Wurzelordner');
    expect((await scanThemeTokens(store, project.id)).definitions).toEqual([]);
    store.close();
  });

  it('caps displayed values and evidence and labels the result incomplete', async () => {
    const { store, project, file } = fixture();
    file('tokens.css', ':root {\n' + Array.from({ length: 301 }, (_, index) => `--token-${index}: ${'x'.repeat(170)};`).join('\n') + '\n}');
    const result = await scanThemeTokens(store, project.id);
    expect(result.definitions).toHaveLength(300);
    expect(result.definitions[0]).toMatchObject({ valueTruncated: true, line: 2 });
    expect(result.definitions[0]?.value).toHaveLength(160);
    expect(result.partial).toBe(true);
    store.close();
  });
});
