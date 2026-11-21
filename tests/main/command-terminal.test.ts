import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pty from 'node-pty';
import { CommandTerminalRunner, commandShellPlan } from '../../src/main/command-terminal';
import { StudioStore } from '../../src/main/store';

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
});
