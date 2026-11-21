import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-card-metadata-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  return { root, dbPath, store, project, column };
}

describe('card priorities and labels', () => {
  it('persists create and update through a database restart', () => {
    const { dbPath, store, project, column } = fixture();
    const created = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic task', priority: 'high', labels: ['Bug', 'bug', 'Heute'] });
    expect(created).toMatchObject({ priority: 'high', labels: ['Bug', 'Heute'] });
    const updated = store.updateCard({ id: created.id, priority: 'urgent', labels: ['Rückfrage'] });
    expect(updated).toMatchObject({ priority: 'urgent', labels: ['Rückfrage'] });
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.snapshot(project.id).cards[0]).toMatchObject({ id: created.id, priority: 'urgent', labels: ['Rückfrage'] });
    reopened.close();
  });

  it('rejects invalid metadata without overwriting a saved card', () => {
    const { store, project, column } = fixture();
    const created = store.createCard({ projectId: project.id, columnId: column.id, title: 'Keep me' });
    expect(() => store.updateCard({ id: created.id, priority: 'immediate' as never })).toThrow('Kartenpriorität');
    expect(() => store.updateCard({ id: created.id, labels: ['ok', 'bad\nlabel'] })).toThrow('Labels');
    expect(() => store.updateCard({ id: created.id, labels: Array.from({ length: 13 }, (_, index) => `Label ${index}`) })).toThrow('12 Labels');
    expect(store.card(created.id)).toMatchObject({ title: 'Keep me', priority: 'none', labels: [] });
    store.close();
  });

  it('migrates pre-metadata cards with safe defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-legacy-metadata-'));
    roots.push(root);
    const path = join(root, 'legacy.sqlite');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE columns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, agent_id TEXT);
      CREATE TABLE cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, column_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
    `);
    const stamp = '2026-01-01T00:00:00.000Z';
    legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run('p', 'Legacy', root, stamp);
    legacy.prepare('INSERT INTO columns VALUES (?, ?, ?, ?, ?, ?)').run('todo', 'p', 'To Do', 0, 0, null);
    legacy.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('old', 'p', 'todo', 'Original title', 'Keep this text', 2, stamp, stamp, null);
    legacy.close();
    const store = new StudioStore(path);
    expect(store.card('old')).toMatchObject({ title: 'Original title', description: 'Keep this text', position: 2, priority: 'none', labels: [] });
    expect(store.updateCard({ id: 'old', labels: ['Migrated'] }).labels).toEqual(['Migrated']);
    store.close();
  });
});
