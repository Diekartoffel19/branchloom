import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { designStateRoute, designStateRoutes, normalizeDesignStateRoute, removeDesignStateRoute, saveDesignStateRoute } from '../../src/main/design-state-routes';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-state-routes-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const dbFile = join(root, 'studio.sqlite');
  const store = new StudioStore(dbFile);
  const project = store.createProject({ name: 'Synthetic states', path: repo });
  return { root, dbFile, store, project };
}

describe('local design state routes', () => {
  it('persists four real local routes per project across restart without opening them', () => {
    const { dbFile, store, project } = fixture();
    expect(designStateRoutes(store, project.id)).toEqual([]);
    const routes = [
      ['normal', 'http://127.0.0.1:5173/'],
      ['loading', 'http://127.0.0.1:5173/?state=loading'],
      ['empty', 'http://127.0.0.1:5173/?state=empty'],
      ['error', 'http://127.0.0.1:5173/error#preview'],
    ] as const;
    for (const [kind, url] of routes) expect(saveDesignStateRoute(store, { projectId: project.id, kind, url })).toMatchObject({ projectId: project.id, kind, url });
    expect(designStateRoutes(store, project.id).map(({ kind }) => kind)).toEqual(['normal', 'loading', 'empty', 'error']);
    store.close();
    const reopened = new StudioStore(dbFile);
    expect(designStateRoute(reopened, { projectId: project.id, kind: 'empty' }).url).toBe('http://127.0.0.1:5173/?state=empty');
    expect(designStateRoutes(reopened, project.id)).toHaveLength(4);
    reopened.close();
  });

  it('keeps projects separate and requires one local origin for each project', () => {
    const { root, store, project } = fixture();
    const otherRepo = join(root, 'other'); mkdirSync(otherRepo);
    const other = store.createProject({ name: 'Other', path: otherRepo });
    saveDesignStateRoute(store, { projectId: project.id, kind: 'normal', url: 'http://localhost:5173/' });
    saveDesignStateRoute(store, { projectId: other.id, kind: 'normal', url: 'http://127.0.0.1:8080/' });
    expect(designStateRoutes(store, other.id)).toHaveLength(1);
    expect(() => saveDesignStateRoute(store, { projectId: project.id, kind: 'loading', url: 'http://localhost:5181/loading' })).toThrow('dieselbe lokale Origin');
    expect(() => saveDesignStateRoute(store, { projectId: project.id, kind: 'loading', url: 'http://127.0.0.1:5173/loading' })).toThrow('dieselbe lokale Origin');
    expect(() => designStateRoute(store, { projectId: other.id, kind: 'loading' })).toThrow('noch keine Route');
    expect(designStateRoute(store, { projectId: project.id, kind: 'normal' }).url).toBe('http://localhost:5173/');
    store.close();
  });

  it('updates, removes and permits a new origin only after all old routes are removed', () => {
    const { store, project } = fixture();
    saveDesignStateRoute(store, { projectId: project.id, kind: 'normal', url: 'http://127.0.0.1:5173/' });
    saveDesignStateRoute(store, { projectId: project.id, kind: 'loading', url: 'http://127.0.0.1:5173/loading' });
    expect(() => saveDesignStateRoute(store, { projectId: project.id, kind: 'normal', url: 'http://127.0.0.1:5181/' })).toThrow('dieselbe lokale Origin');
    const updated = saveDesignStateRoute(store, { projectId: project.id, kind: 'normal', url: 'http://127.0.0.1:5173/home' });
    expect(updated.url).toBe('http://127.0.0.1:5173/home');
    removeDesignStateRoute(store, { projectId: project.id, kind: 'loading' });
    removeDesignStateRoute(store, { projectId: project.id, kind: 'normal' });
    expect(designStateRoutes(store, project.id)).toEqual([]);
    expect(saveDesignStateRoute(store, { projectId: project.id, kind: 'normal', url: 'http://127.0.0.1:5181/' }).url).toBe('http://127.0.0.1:5181/');
    store.close();
  });

  it('rejects external, credentialed, malformed and unknown routes without changing storage', () => {
    const { store, project } = fixture();
    for (const url of ['https://example.com/', 'https://localhost.evil.example/', 'file:///tmp/page', 'http://user:pass@localhost:5173/', 'localhost:5173/', 'http://127.0.0.1:5173/ bad', 'http://127.0.0.1:5173/' + 'x'.repeat(2100)]) {
      expect(() => saveDesignStateRoute(store, { projectId: project.id, kind: 'normal', url })).toThrow();
    }
    expect(() => saveDesignStateRoute(store, { projectId: project.id, kind: 'unknown' as 'normal', url: 'http://127.0.0.1:5173/' })).toThrow('Unbekannter');
    expect(() => designStateRoute(store, { projectId: 'other-project', kind: 'normal' })).toThrow();
    expect(() => removeDesignStateRoute(store, { projectId: project.id, kind: 'unknown' as 'normal' })).toThrow('Unbekannter');
    expect(designStateRoutes(store, project.id)).toEqual([]);
    expect(normalizeDesignStateRoute('http://[::1]:5173/path?state=empty')).toBe('http://[::1]:5173/path?state=empty');
    store.close();
  });
});
