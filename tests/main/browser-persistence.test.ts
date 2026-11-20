import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserSessionPersistence, MAX_BROWSER_TABS } from '../../src/main/browser-persistence';

const directories: string[] = [];
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'studio-browser-test-'));
  directories.push(path);
  return path;
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('BrowserSessionPersistence', () => {
  it('saves web URLs and blank tabs only in a fixed versioned userData file', () => {
    const path = directory();
    const store = new BrowserSessionPersistence(path);
    store.save({ urls: ['https://example.test/path', null, 'http://localhost:3000/'], activeIndex: 2 });
    expect(store.load()).toEqual({ urls: ['https://example.test/path', null, 'http://localhost:3000/'], activeIndex: 2 });
    expect(JSON.parse(readFileSync(join(path, 'browser-session.json'), 'utf8'))).toMatchObject({ version: 1, activeIndex: 2 });
  });

  it('rejects unsafe URLs and invalid active indices before writing', () => {
    const store = new BrowserSessionPersistence(directory());
    expect(() => store.save({ urls: ['file:///C:/private.txt'], activeIndex: 0 })).toThrow('Ungültiger Browser-Snapshot');
    expect(() => store.save({ urls: ['javascript:alert(1)'], activeIndex: 0 })).toThrow('Ungültiger Browser-Snapshot');
    expect(() => store.save({ urls: [null], activeIndex: -1 })).toThrow('Ungültiger aktiver');
    expect(() => store.save({ urls: Array(MAX_BROWSER_TABS + 1).fill(null), activeIndex: 0 })).toThrow('Ungültiger Browser-Snapshot');
  });

  it('filters tampered data and never restores file URLs', () => {
    const path = directory();
    const store = new BrowserSessionPersistence(path);
    writeFileSync(join(path, 'browser-session.json'), JSON.stringify({ version: 1, urls: ['file:///C:/private.txt', 'https://safe.test/', null], activeIndex: 1 }));
    expect(store.load()).toEqual({ urls: ['https://safe.test/', null], activeIndex: 0 });
    writeFileSync(join(path, 'browser-session.json'), '{broken');
    expect(store.load()).toEqual({ urls: [], activeIndex: -1 });
    writeFileSync(join(path, 'browser-session.json'), 'x'.repeat(70_000));
    expect(store.load()).toEqual({ urls: [], activeIndex: -1 });
  });
});
