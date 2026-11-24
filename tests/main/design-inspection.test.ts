import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ WebContentsView: class {} }));

import { StudioStore } from '../../src/main/store';
import { designSelections, normalizeDesignSelection, normalizeDesignUrl, saveDesignSelection } from '../../src/main/design-inspection';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-design-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic design', path: repo });
  return { file, store, project };
}

const raw = { selector: 'html > body > button#save', tag: 'BUTTON', text: ' Save\n draft ', styles: { color: 'rgb(33, 44, 55)', padding: '8px', unknown: 'ignored' }, tokens: [{ name: '--ink', value: ' #223344 ' }] };

describe('local design inspection evidence', () => {
  it('allows only explicit loopback URLs and sanitizes selected data', () => {
    expect(normalizeDesignUrl('http://127.0.0.1:5173/page?token=local')).toBe('http://127.0.0.1:5173/page?token=local');
    for (const url of ['https://example.com/', 'https://localhost.evil.test/', 'file:///etc/passwd', 'http://user:pass@localhost:5173/']) expect(() => normalizeDesignUrl(url)).toThrow();
    expect(normalizeDesignSelection(raw)).toEqual({ selector: raw.selector, tag: 'button', text: 'Save draft', styles: { color: 'rgb(33, 44, 55)', padding: '8px' }, tokens: [{ name: '--ink', value: '#223344' }] });
    expect(() => normalizeDesignSelection({ selector: '', tag: 'button' })).toThrow();
    expect(() => normalizeDesignSelection({ selector: 'x', tag: '<script>' })).toThrow();
  });

  it('stores bounded project-local evidence across restart without query values', () => {
    const { file, store, project } = fixture();
    const otherRepo = join(roots.at(-1)!, 'other-repo'); mkdirSync(otherRepo);
    const other = store.createProject({ name: 'Other project', path: otherRepo });
    const first = saveDesignSelection(store, project.id, 'http://127.0.0.1:5173/page?token=secret#frag', raw);
    expect(first).toMatchObject({ sourceUrl: 'http://127.0.0.1:5173/page', tag: 'button', text: 'Save draft' });
    expect(designSelections(store, other.id)).toEqual([]);
    for (let index = 0; index < 22; index++) saveDesignSelection(store, project.id, 'http://127.0.0.1:5173/', { ...raw, selector: `button:nth-of-type(${index + 1})` });
    expect(designSelections(store, project.id)).toHaveLength(20);
    expect(designSelections(store, project.id).some((item) => item.id === first.id)).toBe(false);
    store.close();
    const reopened = new StudioStore(file);
    expect(designSelections(reopened, project.id)).toHaveLength(20);
    expect(JSON.stringify(designSelections(reopened, project.id))).not.toContain('token=secret');
    expect(() => saveDesignSelection(reopened, other.id, 'https://example.com/', raw)).toThrow();
    reopened.close();
  });
});
