import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { applyThemeTokenEdit, previewThemeTokenEdit } from '../../src/main/theme-token-edit';
import { scanThemeTokens } from '../../src/main/theme-tokens';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-token-edit-')); roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const file = join(repo, 'theme.css');
  const source = ':root {\r\n  --ink: #eee;\r\n  --radius: 4px;\r\n}\r\n';
  writeFileSync(file, source);
  execFileSync('git', ['-C', repo, 'add', '--', 'theme.css']);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: repo });
  return { root, repo, file, source, store, project };
}

describe('explicit theme token source edit', () => {
  it('shows the exact declaration diff, changes only the selected value and allows a scoped reverse edit', async () => {
    const { file, source, store, project } = fixture();
    const token = (await scanThemeTokens(store, project.id)).definitions[0]!;
    const input = { projectId: project.id, token, value: '#abc' };
    const preview = await previewThemeTokenEdit(store, input);
    expect(preview).toMatchObject({ before: '--ink: #eee;', after: '--ink: #abc;' });
    expect(readFileSync(file, 'utf8')).toBe(source);
    await expect(applyThemeTokenEdit(store, { ...input, reviewToken: preview.reviewToken, confirm: false })).rejects.toThrow('Bestätige');
    const result = await applyThemeTokenEdit(store, { ...input, reviewToken: preview.reviewToken, confirm: true });
    expect(readFileSync(file, 'utf8')).toBe(source.replace('#eee', '#abc'));
    expect(result.token).toMatchObject({ value: '#abc', sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const reverse = { projectId: project.id, token: result.token, value: result.previousValue };
    const reversePreview = await previewThemeTokenEdit(store, reverse);
    await applyThemeTokenEdit(store, { ...reverse, reviewToken: reversePreview.reviewToken, confirm: true });
    expect(readFileSync(file, 'utf8')).toBe(source);
    store.close();
  });

  it('refuses external edits before confirm and before a reverse action without overwriting them', async () => {
    const { file, store, project } = fixture();
    const token = (await scanThemeTokens(store, project.id)).definitions[0]!;
    const input = { projectId: project.id, token, value: '#abc' };
    const preview = await previewThemeTokenEdit(store, input);
    writeFileSync(file, ':root { --ink: #123; }\n');
    await expect(applyThemeTokenEdit(store, { ...input, reviewToken: preview.reviewToken, confirm: true })).rejects.toThrow('veraltet');
    expect(readFileSync(file, 'utf8')).toContain('#123');
    const current = (await scanThemeTokens(store, project.id)).definitions[0]!;
    const updated = { projectId: project.id, token: current, value: '#abc' };
    const currentPreview = await previewThemeTokenEdit(store, updated);
    const applied = await applyThemeTokenEdit(store, { ...updated, reviewToken: currentPreview.reviewToken, confirm: true });
    writeFileSync(file, ':root { --ink: #abc; --extra: 8px; }\n');
    await expect(previewThemeTokenEdit(store, { projectId: project.id, token: applied.token, value: applied.previousValue })).rejects.toThrow('veraltet');
    expect(readFileSync(file, 'utf8')).toContain('--extra: 8px');
    store.close();
  });

  it('rejects wrong project, unsupported values, ambiguous declarations and missing review proof', async () => {
    const { file, store, project } = fixture();
    const token = (await scanThemeTokens(store, project.id)).definitions[0]!;
    const input = { projectId: project.id, token, value: '#abc' };
    await expect(previewThemeTokenEdit(store, { ...input, projectId: 'foreign' })).rejects.toThrow();
    await expect(previewThemeTokenEdit(store, { ...input, value: 'url(https://example.com)' })).rejects.toThrow('Hex');
    await expect(previewThemeTokenEdit(store, { ...input, value: '12px' })).rejects.toThrow('Farbe');
    await expect(applyThemeTokenEdit(store, { ...input, reviewToken: '0'.repeat(64), confirm: true })).rejects.toThrow('veraltet');
    writeFileSync(file, ':root { --ink: #eee; --ink: #eee; }');
    const current = (await scanThemeTokens(store, project.id)).definitions[0]!;
    await expect(previewThemeTokenEdit(store, { projectId: project.id, token: current, value: '#abc' })).rejects.toThrow('nicht eindeutig');
    store.close();
  });

  it('leaves invalid UTF-8 untouched', async () => {
    const { file, store, project } = fixture();
    const invalid = Buffer.concat([Buffer.from(':root { --ink: #eee; }\n'), Buffer.from([0xff])]);
    writeFileSync(file, invalid);
    const token = (await scanThemeTokens(store, project.id)).definitions[0]!;
    await expect(previewThemeTokenEdit(store, { projectId: project.id, token, value: '#abc' })).rejects.toThrow('UTF-8');
    expect(readFileSync(file).equals(invalid)).toBe(true);
    store.close();
  });
});
