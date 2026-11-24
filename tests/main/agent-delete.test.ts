import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

describe('agent removal', () => {
  it('hides the agent across restart, keeps session history and clears column defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-agent-delete-'));
    roots.push(root);
    const path = join(root, 'studio.sqlite');
    let store = new StudioStore(path);
    const project = store.createProject({ name: 'Synthetic', path: root });
    const codex = store.agents().find((item) => item.kind === 'codex')!;
    const column = store.snapshot(project.id).columns[0]!;
    store.updateColumn({ id: column.id, agentId: codex.id, autoStart: true });
    const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic card' });
    const running = store.createSession({ cardId: card.id, agentId: codex.id });
    expect(() => store.deleteAgent(codex.id)).toThrow('stoppen');
    store.finishSession(running.id, 'exited', 0);
    store.deleteAgent(codex.id);
    store.close();

    store = new StudioStore(path);
    expect(store.agents().some((item) => item.id === codex.id)).toBe(false);
    expect(store.agents().length).toBeGreaterThan(0);
    expect(store.session(running.id).agentId).toBe(codex.id);
    expect(store.snapshot(project.id).columns[0]).toMatchObject({ agentId: null, autoStart: false });
    store.close();
  });
});
