import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { checkPackagedApp } from '../../scripts/check-package.mjs';

const roots: string[] = [];
afterEach(() => {
  const tempRoot = resolve(tmpdir()) + sep;
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(tempRoot)) throw new Error('Testordner liegt nicht im Temp-Verzeichnis.');
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-package-check-'));
  roots.push(root);
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'app.js'), 'console.log("ok")');
  return root;
}

describe('packaged app public data gate', () => {
  it('accepts a built app and ignores vendor examples', () => {
    const root = fixture();
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', '.env.example'), 'vendor example');
    expect(checkPackagedApp(root)).toBe(1);
  });

  it('rejects local data and source directories without printing their names', () => {
    const root = fixture();
    writeFileSync(join(root, '.env.production'), 'SHOULD_NEVER_APPEAR_IN_ERROR');
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests', 'private.txt'), 'fixture');
    expect(() => checkPackagedApp(root)).toThrow('Paketprüfung fehlgeschlagen');
    try { checkPackagedApp(root); } catch (error) { expect(String(error)).not.toContain('SHOULD_NEVER_APPEAR_IN_ERROR'); }
  });

  it('checks vendor directories for actual secrets while allowing documentation examples', () => {
    const root = fixture();
    mkdirSync(join(root, 'node_modules', 'vendor', 'tests'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'vendor', 'tests', '.env.example'), 'example');
    expect(checkPackagedApp(root)).toBe(1);
    writeFileSync(join(root, 'node_modules', 'vendor', '.npmrc'), 'fixture');
    expect(() => checkPackagedApp(root)).toThrow('local configuration or database files');
  });
});
