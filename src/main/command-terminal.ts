import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import type { CommandShell, CommandTerminal, CommandTerminalEvent } from '../shared/types';
import { StudioStore } from './store';

/** Fixed executable and argument lists; the project path is only a cwd. */
export function commandShellPlan(shell: CommandShell, systemRoot = process.env.SystemRoot ?? 'C:\\Windows', platform = process.platform): { executable: string; args: string[] } {
  if (platform !== 'win32') throw new Error('Das Befehlsterminal unterstützt derzeit Windows.');
  if (shell !== 'powershell' && shell !== 'cmd') throw new Error('Ungültige Shell.');
  const executable = shell === 'powershell'
    ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : join(systemRoot, 'System32', 'cmd.exe');
  if (!existsSync(executable) || !statSync(executable).isFile()) throw new Error(`${shell === 'powershell' ? 'PowerShell' : 'cmd.exe'} wurde nicht gefunden.`);
  return { executable, args: shell === 'powershell' ? ['-NoLogo', '-NoProfile', '-NoExit'] : ['/Q'] };
}

export class CommandTerminalRunner {
  private readonly processes = new Map<string, IPty>();
  private disposed = false;

  constructor(
    private readonly store: StudioStore,
    private readonly emit: (event: CommandTerminalEvent) => void,
    private readonly spawnPty: typeof ptySpawn = ptySpawn,
  ) {}

  start(input: { projectId: string; shell: CommandShell }): CommandTerminal {
    if (this.disposed) throw new Error('Terminal-Laufzeit wurde beendet.');
    const project = this.store.project(input.projectId);
    if (this.store.projectQueue(project.id).state === 'running') throw new Error('Projektwarteschlange zuerst pausieren, bevor das Befehlsterminal startet.');
    const plan = commandShellPlan(input.shell);
    const row = this.store.createCommandTerminal(input);
    let child: IPty;
    try {
      child = this.spawnPty(plan.executable, plan.args, {
        cwd: project.path,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        cols: 100, rows: 30, name: 'xterm-256color',
      });
    } catch (error) {
      this.store.finishCommandTerminal(row.id, 'failed', null);
      throw error;
    }
    this.processes.set(row.id, child);
    this.emit({ terminalId: row.id, projectId: row.projectId, type: 'state', data: 'Terminal gestartet.', state: 'running' });
    child.onData((data) => {
      if (!this.processes.has(row.id) || this.disposed) return;
      this.store.appendCommandOutput(row.id, data);
      this.emit({ terminalId: row.id, projectId: row.projectId, type: 'output', data });
    });
    child.onExit(({ exitCode }) => {
      this.processes.delete(row.id);
      if (this.disposed || this.store.commandTerminal(row.id).state !== 'running') return;
      const state = exitCode === 0 ? 'exited' : 'failed';
      this.store.finishCommandTerminal(row.id, state, exitCode);
      this.emit({ terminalId: row.id, projectId: row.projectId, type: 'state', data: `Terminal beendet (${exitCode}).`, state });
    });
    return row;
  }

  write(input: { terminalId: string; data: string }): void {
    if (typeof input.data !== 'string' || !input.data || input.data.length > 4_096) throw new Error('Terminaleingabe muss zwischen 1 und 4096 Zeichen lang sein.');
    const child = this.processes.get(input.terminalId);
    if (!child || this.store.commandTerminal(input.terminalId).state !== 'running') throw new Error('Terminal läuft nicht.');
    child.write(input.data);
  }

  resize(input: { terminalId: string; cols: number; rows: number }): void {
    if (!Number.isInteger(input.cols) || !Number.isInteger(input.rows) || input.cols < 20 || input.cols > 300 || input.rows < 5 || input.rows > 100) {
      throw new Error('Terminalgröße muss zwischen 20–300 Spalten und 5–100 Zeilen liegen.');
    }
    const child = this.processes.get(input.terminalId);
    if (!child || this.store.commandTerminal(input.terminalId).state !== 'running') throw new Error('Terminal läuft nicht.');
    if (child.cols !== input.cols || child.rows !== input.rows) child.resize(input.cols, input.rows);
  }

  stop(terminalId: string): void {
    const child = this.processes.get(terminalId);
    if (!child) throw new Error('Terminal läuft nicht.');
    const row = this.store.finishCommandTerminal(terminalId, 'stopped', null);
    this.processes.delete(terminalId);
    child.kill();
    this.emit({ terminalId, projectId: row.projectId, type: 'state', data: 'Terminal gestoppt.', state: 'stopped' });
  }

  dispose(): void {
    for (const id of [...this.processes.keys()]) this.stop(id);
    this.disposed = true;
  }
}
