import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pty from 'node-pty';
import { CommandTerminalRunner, commandShellPlan } from '../../src/main/command-terminal';
import { StudioStore } from '../../src/main/store';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { SessionRunner } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-command-terminal-'));
  roots.push(root);
  const database = join(root, 'studio.sqlite');
  const store = new StudioStore(database);
  const project = store.createProject({ name: 'Synthetic', path: root });
  return { root, database, store, project };
}

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}

function gitFixture() {
  const value = fixture();
  const repository = join(value.root, 'repository');
  mkdirSync(repository);
  git(repository, ['init', '-q']);
  writeFileSync(join(repository, 'tracked.txt'), 'synthetic');
  git(repository, ['add', 'tracked.txt']);
  git(repository, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Synthetic']);
  const project = value.store.createProject({ name: 'Git project', path: repository });
  const card = value.store.createCard({ projectId: project.id, columnId: value.store.snapshot(project.id).columns[0]!.id, title: 'Card checkout' });
  return { ...value, project, repository, card };
}

describe('project command terminal', () => {
  it('persists bounded output and marks interrupted terminals failed on restart', () => {
    const { database, store, project } = fixture();
    const terminal = store.createCommandTerminal({ projectId: project.id, shell: 'powershell' });
    store.appendCommandOutput(terminal.id, 'A'.repeat(120_000));
    expect(store.commandTerminal(terminal.id).output.length).toBe(100_000);
    expect(() => store.createCommandTerminal({ projectId: project.id, shell: 'cmd' })).toThrow('bereits');
    expect(() => store.createCommandTerminal({ projectId: project.id, shell: 'bash' as never })).toThrow('Shell');
    store.close();
    const reopened = new StudioStore(database);
    expect(reopened.commandTerminals(project.id)[0]).toMatchObject({ id: terminal.id, state: 'failed', shell: 'powershell' });
    expect(reopened.commandTerminal(terminal.id).output).toContain('not replayed');
    const next = reopened.createCommandTerminal({ projectId: project.id, shell: 'cmd' });
    expect(reopened.commandTerminals(project.id)[0]?.id).toBe(next.id);
    reopened.close();
  });

  it.skipIf(process.platform !== 'win32')('starts a fixed shell in the project folder and handles input, resize, output, exit and stop', () => {
    const { root, store, project } = fixture();
    let onData: ((text: string) => void) | null = null;
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | null = null;
    const child = { cols: 100, rows: 30, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn((callback) => { onData = callback; }), onExit: vi.fn((callback) => { onExit = callback; }) };
    const spawn = vi.fn(() => child) as unknown as typeof pty.spawn;
    const events: string[] = [];
    const runner = new CommandTerminalRunner(store, (event) => events.push(`${event.type}:${event.state ?? event.data}`), spawn);
    const row = runner.start({ projectId: project.id, shell: 'powershell' });
    expect(spawn).toHaveBeenCalledWith(commandShellPlan('powershell').executable, ['-NoLogo', '-NoProfile', '-NoExit'], expect.objectContaining({ cwd: root }));
    expect(() => runner.start({ projectId: project.id, shell: 'cmd' })).toThrow('bereits');
    runner.write({ terminalId: row.id, data: 'Get-Location\r' });
    expect(child.write).toHaveBeenCalledWith('Get-Location\r');
    expect(() => runner.write({ terminalId: row.id, data: 'a'.repeat(4097) })).toThrow('4096');
    runner.resize({ terminalId: row.id, cols: 120, rows: 40 });
    expect(child.resize).toHaveBeenCalledWith(120, 40);
    expect(() => runner.resize({ terminalId: row.id, cols: 1, rows: 40 })).toThrow('Terminalgröße');
    onData!('prompt> ');
    expect(store.commandTerminal(row.id).output).toBe('prompt> ');
    onExit!({ exitCode: 0 });
    expect(store.commandTerminal(row.id).state).toBe('exited');
    expect(events).toContain('state:exited');
    const next = runner.start({ projectId: project.id, shell: 'cmd' });
    runner.stop(next.id);
    expect(child.kill).toHaveBeenCalled();
    expect(store.commandTerminal(next.id).state).toBe('stopped');
    expect(() => runner.write({ terminalId: next.id, data: 'echo x' })).toThrow('läuft nicht');
    runner.dispose();
    store.close();
  });

  it.skipIf(process.platform !== 'win32')('records a failed launch without leaving a terminal running', () => {
    const { store, project } = fixture();
    const spawn = vi.fn(() => { throw new Error('PTY unavailable'); }) as unknown as typeof pty.spawn;
    const runner = new CommandTerminalRunner(store, () => undefined, spawn);
    expect(() => runner.start({ projectId: project.id, shell: 'cmd' })).toThrow('PTY unavailable');
    expect(store.commandTerminals(project.id)[0]?.state).toBe('failed');
    const queue = store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(queue.state).toBe('running');
    expect(() => runner.start({ projectId: project.id, shell: 'cmd' })).toThrow('pausieren');
    expect(spawn).toHaveBeenCalledTimes(1);
    store.close();
  });

  it.skipIf(process.platform !== 'win32')('opens only a saved, verified card worktree and records its scope after restart', () => {
    const { database, store, project, repository, card } = gitFixture();
    const worktree = ensureCardWorktree(store, card.id);
    const child = { cols: 100, rows: 30, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn(), onExit: vi.fn() };
    const spawn = vi.fn(() => child) as unknown as typeof pty.spawn;
    const runner = new CommandTerminalRunner(store, () => undefined, spawn);
    const terminal = runner.start({ projectId: project.id, shell: 'cmd', cardId: card.id });
    expect(spawn).toHaveBeenCalledWith(commandShellPlan('cmd').executable, ['/Q'], expect.objectContaining({ cwd: worktree.cwd }));
    expect(terminal).toMatchObject({ cardId: card.id, worktreePath: worktree.path });
    runner.stop(terminal.id);
    const plain = runner.start({ projectId: project.id, shell: 'cmd' });
    expect(spawn).toHaveBeenLastCalledWith(commandShellPlan('cmd').executable, ['/Q'], expect.objectContaining({ cwd: repository }));
    expect(plain).toMatchObject({ cardId: null, worktreePath: null });
    runner.stop(plain.id);
    store.close();
    const reopened = new StudioStore(database);
    expect(reopened.commandTerminal(terminal.id)).toMatchObject({ cardId: card.id, worktreePath: worktree.path, state: 'stopped' });
    reopened.close();
  });

  it.skipIf(process.platform !== 'win32')('refuses absent, foreign, changed and currently active card worktrees before PTY launch', () => {
    const { store, project, card } = gitFixture();
    const spawn = vi.fn() as unknown as typeof pty.spawn;
    const runner = new CommandTerminalRunner(store, () => undefined, spawn);
    expect(() => runner.start({ projectId: project.id, shell: 'cmd', cardId: card.id })).toThrow('kein Worktree');
    const worktree = ensureCardWorktree(store, card.id);
    const other = store.projects().find((item) => item.id !== project.id)!;
    expect(() => runner.start({ projectId: other.id, shell: 'cmd', cardId: card.id })).toThrow('anderen Projekt');
    const agent = store.agents()[0]!;
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    expect(() => runner.start({ projectId: project.id, shell: 'cmd', cardId: card.id })).toThrow('Agent');
    store.finishSession(session.id, 'exited', 0);
    git(worktree.path, ['checkout', '--detach']);
    expect(() => runner.start({ projectId: project.id, shell: 'cmd', cardId: card.id })).toThrow('Karten-Branch');
    expect(spawn).not.toHaveBeenCalled();
    expect(store.commandTerminals(project.id)).toHaveLength(0);
    store.close();
  });

  it('blocks a worktree agent while its command terminal is running', () => {
    const { store, project, card } = gitFixture();
    const worktree = ensureCardWorktree(store, card.id);
    const terminal = store.createCommandTerminal({ projectId: project.id, shell: 'cmd', cardId: card.id, worktreePath: worktree.path });
    const agent = store.saveAgent({ name: 'Synthetic', kind: 'custom', command: process.execPath, args: ['-e', 'console.log("ok")'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    expect(() => runner.start({ cardId: card.id, agentId: agent.id, useWorktree: true })).toThrow('Befehlsterminal');
    expect(store.latestSession(card.id)).toBeNull();
    store.finishCommandTerminal(terminal.id, 'stopped', null);
    runner.dispose();
    store.close();
  });

  it.skipIf(process.platform !== 'win32')('rejects a nested project cwd redirected outside its verified Git worktree', () => {
    const { root, repository, store } = gitFixture();
    const nested = join(repository, 'nested');
    mkdirSync(join(nested, 'child'), { recursive: true });
    writeFileSync(join(nested, 'tracked.txt'), 'nested project');
    git(repository, ['add', 'nested/tracked.txt']);
    git(repository, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Nested']);
    const project = store.createProject({ name: 'Nested project', path: join(nested, 'child') });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Nested card' });
    expect(() => ensureCardWorktree(store, card.id)).toThrow('Unterverzeichnis fehlt');
    const binding = store.cardWorktree(card.id)!;
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(binding.path, 'nested', 'child'), 'junction');
    const spawn = vi.fn() as unknown as typeof pty.spawn;
    const runner = new CommandTerminalRunner(store, () => undefined, spawn);
    expect(() => runner.start({ projectId: project.id, shell: 'cmd', cardId: card.id })).toThrow('verweist aus dem Worktree hinaus');
    expect(spawn).not.toHaveBeenCalled();
    expect(store.commandTerminals(project.id)).toHaveLength(0);
    expect(existsSync(outside)).toBe(true);
    runner.dispose();
    store.close();
  });
});
