import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createOutputErrorCard, outputErrorCandidates, previewOutputErrors } from '../../src/main/output-errors';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* Already closed in the test. */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-output-errors-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents()[0]!;
  const sourceCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Original task' });
  return { store, file, root, project, columns, agent, sourceCard };
}

describe('explicit card from saved output error', () => {
  it('extracts only bounded recognizable lines and strips terminal control codes', () => {
    const candidates = outputErrorCandidates('\x1b[31mError: synthetic connection refused\x1b[0m\nordinary text\nFailed: synthetic test case');
    expect(candidates.map((item) => item.message)).toEqual(['Error: synthetic connection refused', 'Failed: synthetic test case']);
    expect(outputErrorCandidates('Agent prompt said: error handling matters\n[JARVIS_STEP_DONE]')).toEqual([]);
  });

  it('persists one explicitly selected agent error card with source and protects the project boundary', () => {
    const { store, file, project, columns, agent, sourceCard, root } = fixture();
    const session = store.createSession({ cardId: sourceCard.id, agentId: agent.id });
    expect(() => previewOutputErrors(store, { projectId: project.id, sourceKind: 'session', sourceId: session.id })).toThrow('Laufende');
    store.appendOutput(session.id, 'Error: synthetic connection refused\n');
    store.finishSession(session.id, 'failed', 1);
    const preview = previewOutputErrors(store, { projectId: project.id, sourceKind: 'session', sourceId: session.id });
    expect(preview.candidates).toHaveLength(1);
    const input = { projectId: project.id, sourceKind: 'session' as const, sourceId: session.id, candidateId: preview.candidates[0]!.id, columnId: columns[1]!.id, reproduction: '  Test request senden  ' };
    const created = createOutputErrorCard(store, input);
    expect(created.description).toContain('Original task');
    expect(created.description).toContain('Reproduktion: Test request senden');
    expect(created.description).not.toContain('[JARVIS_STEP_DONE]');
    expect(createOutputErrorCard(store, input).id).toBe(created.id);
    expect(store.snapshot(project.id).sessions).toHaveLength(1);
    store.close();
    const reopened = new StudioStore(file);
    stores.push(reopened);
    expect(createOutputErrorCard(reopened, input).id).toBe(created.id);
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = reopened.createProject({ name: 'Other', path: otherPath });
    expect(() => previewOutputErrors(reopened, { projectId: other.id, sourceKind: 'session', sourceId: session.id })).toThrow();
    expect(() => createOutputErrorCard(reopened, { ...input, projectId: other.id })).toThrow();
    reopened.close();
  });

  it('reads only a finished project terminal and rejects forged/stale candidates', () => {
    const { store, project, columns, root } = fixture();
    const terminal = store.createCommandTerminal({ projectId: project.id, shell: 'cmd' });
    store.appendCommandOutput(terminal.id, 'Fatal: synthetic build problem\n');
    expect(() => previewOutputErrors(store, { projectId: project.id, sourceKind: 'command', sourceId: terminal.id })).toThrow('Laufendes');
    store.finishCommandTerminal(terminal.id, 'failed', 2);
    const preview = previewOutputErrors(store, { projectId: project.id, sourceKind: 'command', sourceId: terminal.id });
    expect(preview.sourceLabel).toContain('cmd');
    const input = { projectId: project.id, sourceKind: 'command' as const, sourceId: terminal.id, candidateId: preview.candidates[0]!.id, columnId: columns[1]!.id, reproduction: '' };
    expect(() => createOutputErrorCard(store, { ...input, candidateId: 'a'.repeat(64) })).toThrow('nicht mehr vorhanden');
    const card = createOutputErrorCard(store, input);
    expect(card.description).toContain('Befehlsterminal');
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(() => previewOutputErrors(store, { projectId: other.id, sourceKind: 'command', sourceId: terminal.id })).toThrow('nicht zu diesem Projekt');
    store.close();
  });

  it('blocks a new To-Do card while the queue runs and refuses a foreign target column', () => {
    const { store, project, columns, agent, sourceCard, root } = fixture();
    const session = store.createSession({ cardId: sourceCard.id, agentId: agent.id });
    store.appendOutput(session.id, 'Error: synthetic queue failure\n');
    store.finishSession(session.id, 'failed', 1);
    const candidateId = previewOutputErrors(store, { projectId: project.id, sourceKind: 'session', sourceId: session.id }).candidates[0]!.id;
    const input = { projectId: project.id, sourceKind: 'session' as const, sourceId: session.id, candidateId, columnId: columns[0]!.id, reproduction: 'retry' };
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => createOutputErrorCard(store, input)).toThrow('Pausiere');
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(() => createOutputErrorCard(store, { ...input, columnId: store.snapshot(other.id).columns[1]!.id })).toThrow('anderen Projekt');
    expect(createOutputErrorCard(store, { ...input, columnId: columns[1]!.id }).columnId).toBe(columns[1]!.id);
    store.close();
  });
});
