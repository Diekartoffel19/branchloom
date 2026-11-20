import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import pty, { type IPty } from 'node-pty';
import type { AgentDetection, AgentPreset, Session, SessionEvent } from '../shared/types';
import { StudioStore } from './store';
import { ensureCardWorktree } from './git-worktree';

const DONE_MARKER = '[JARVIS_STEP_DONE]';
export { DONE_MARKER };

/** Search PATH, never the untrusted project working directory. */
export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isAbsolute(command)) return existsSync(command) && statSync(command).isFile() ? command : null;
  if (/[\\/]/.test(command) || !/^[\w.-]+$/.test(command)) return null;
  const suffixes = process.platform === 'win32' && !extname(command) ? ['.exe', '.com', '.cmd', '.bat', ''] : [''];
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

export interface AgentLauncher { executable: string; prefixArgs: string[] }

/**
 * A narrowly recognized npm-style CMD shim is read as data, never executed.
 * Only its final Node/JS target is used. Any arbitrary batch script is refused.
 */
export function resolveAgentLauncher(command: string, env: NodeJS.ProcessEnv = process.env): AgentLauncher | null {
  const executable = resolveExecutable(command, env);
  if (!executable) return null;
  if (/\.bat$/i.test(executable)) return null;
  if (!/\.cmd$/i.test(executable)) return { executable, prefixArgs: [] };
  let source: string;
  try { source = readFileSync(executable, 'utf8'); } catch { return null; }
  if (source.length > 32_000 || /\0/.test(source)) return null;
  const last = source.trimEnd().split(/\r?\n/).at(-1) ?? '';
  // Both npm's %~dp0 and pnpm/Yarn's %dp0% forms are common. The prefix of
  // the last line may contain cmd's endLocal boilerplate; it is never run.
  const match = last.match(/"(?:%_prog%|%NODE_EXE%|%~dp0[\\/]node\.exe)"\s+"((?:%dp0%|%~dp0)[\\/][^"%]+\.(?:js|cjs|mjs))"\s+%\*\s*$/i);
  if (!match) return null;
  const relative = match[1]!.replace(/^%(?:dp0%|~dp0)[\\/]/i, '');
  const script = resolve(dirname(executable), relative);
  if (!existsSync(script) || !statSync(script).isFile()) return null;
  const localNode = join(dirname(executable), 'node.exe');
  const node = existsSync(localNode) ? localNode : resolveExecutable('node', env);
  return node && /\.exe$/i.test(node) ? { executable: node, prefixArgs: [script] } : null;
}

export function detectAgents(env: NodeJS.ProcessEnv = process.env): AgentDetection[] {
  return (['codex', 'claude', 'gemini'] as const).map((kind) => {
    const launcher = resolveAgentLauncher(kind, env);
    let version: string | null = null;
    if (launcher) {
      const result = spawnSync(launcher.executable, [...launcher.prefixArgs, '--version'], { timeout: 3_000, encoding: 'utf8', windowsHide: true, env });
      if (!result.error && result.status === 0) version = String(result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? null;
    }
    return { kind, command: launcher ? resolveExecutable(kind, env)! : kind, available: launcher !== null, version };
  });
}

function cliArgs(agent: AgentPreset, prompt: string, mode: 'interactive' | 'one-shot', finalMessagePath?: string): string[] {
  const args = mode === 'one-shot' && agent.kind === 'codex'
    ? ['exec', '--approve-for-me', ...(finalMessagePath ? ['--output-last-message', finalMessagePath] : []), ...agent.args]
    : [...agent.args];
  if (agent.model) {
    if (agent.kind === 'codex' || agent.kind === 'gemini') args.push('-m', agent.model);
    else if (agent.kind === 'claude') args.push('--model', agent.model);
  }
  // These CLIs accept a positional or -p prompt in one-shot mode and exit when
  // the turn ends. A custom adapter can place {prompt} in one of its args.
  if (mode === 'one-shot' && (agent.kind === 'claude' || agent.kind === 'gemini') && prompt) args.push('-p', prompt);
  else if (agent.kind === 'codex' && prompt) args.push(prompt);
  else if (mode === 'one-shot' && agent.kind === 'custom') {
    const index = args.findIndex((arg) => arg.includes('{prompt}'));
    if (index >= 0) args[index] = args[index]!.replace('{prompt}', prompt);
  }
  return args;
}

/** A single explicit user-triggered agent run. No shell string or implicit restart. */
export class SessionRunner {
  private readonly processes = new Map<string, IPty>();
  private readonly pendingFirstTurn = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly finalMessageFiles = new Map<string, { directory: string; path: string }>();
  private disposed = false;
  constructor(
    private readonly store: StudioStore,
    private readonly emit: (event: SessionEvent) => void,
    private readonly onFinished: (session: Session, finalMessage: string | null) => void,
  ) {}

  start(input: { cardId: string; agentId?: string; prompt?: string; mode?: 'interactive' | 'one-shot'; useWorktree?: boolean }): Session {
    const card = this.store.card(input.cardId);
    const project = this.store.project(card.projectId);
    const column = this.store.column(card.columnId);
    const agentId = input.agentId ?? column.agentId;
    if (!agentId) throw new Error('Choose an agent for this card or column');
    const agent = this.store.agent(agentId);
    if (!agent.enabled) throw new Error(`${agent.name} is disabled`);
    if (this.store.latestSession(card.id)?.state === 'running') throw new Error('An agent is already running for this card');
    const launcher = resolveAgentLauncher(agent.command);
    if (!launcher) throw new Error(`Agent executable or supported Node shim not found: ${agent.command}`);
    const prompt = (input.prompt ?? `Work on this card in the selected project.\n\nTitle: ${card.title}\n\n${card.description}`).trim();
    if (prompt.length > 30_000) throw new Error('Agent prompt exceeds 30000 characters');
    const worktree = input.useWorktree === true ? ensureCardWorktree(this.store, card.id) : null;
    const row = this.store.createSession({ cardId: card.id, agentId, worktreePath: worktree?.path });
    let finalFile: { directory: string; path: string } | null = null;
    try {
      if (input.mode === 'one-shot' && agent.kind === 'codex') {
        const directory = mkdtempSync(join(tmpdir(), 'jarvis-studio-final-'));
        finalFile = { directory, path: join(directory, 'last-message.txt') };
      }
    } catch (error) {
      this.store.finishSession(row.id, 'failed', null);
      throw error;
    }
    if (finalFile) this.finalMessageFiles.set(row.id, finalFile);
    let child: IPty;
    try {
      child = pty.spawn(launcher.executable, [...launcher.prefixArgs, ...cliArgs(agent, prompt, input.mode ?? 'interactive', finalFile?.path)], {
        cwd: worktree?.cwd ?? project.path,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        cols: 100, rows: 30,
        name: 'xterm-256color',
      });
    } catch (error) {
      this.readAndClearFinalMessage(row.id);
      const failed = this.store.finishSession(row.id, 'failed', null);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: String(error), state: failed.state });
      throw error;
    }
    this.processes.set(row.id, child);
    this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: 'Agent started', state: 'running' });
    child.onData((data) => {
      if (this.disposed) return;
      this.store.appendOutput(row.id, data);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'output', data });
    });
    child.onExit(({ exitCode }) => {
      const pending = this.pendingFirstTurn.get(row.id);
      if (pending) clearTimeout(pending);
      this.pendingFirstTurn.delete(row.id);
      this.processes.delete(row.id);
      const finalMessage = this.readAndClearFinalMessage(row.id);
      if (this.disposed) return;
      const current = this.store.session(row.id);
      if (current.state !== 'running') return;
      const state = exitCode === 0 ? 'exited' : 'failed';
      const finished = this.store.finishSession(row.id, state, exitCode);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: `Agent exited (${exitCode})`, state });
      this.onFinished(finished, finalMessage);
    });
    if ((input.mode ?? 'interactive') === 'interactive' && agent.kind !== 'codex' && prompt) {
      // The CLI may show a login/trust prompt. Delay only the initial turn;
      // users can inspect the terminal and send it manually if it did not land.
      this.pendingFirstTurn.set(row.id, setTimeout(() => {
        if (this.processes.has(row.id)) child.write(`${prompt}\r`);
        this.pendingFirstTurn.delete(row.id);
      }, 1_500));
    }
    return row;
  }

  send(input: { sessionId: string; text: string }): void {
    const child = this.processes.get(input.sessionId);
    if (!child) throw new Error('Session is not running');
    if (!input.text.trim() || input.text.length > 10_000 || /\0/.test(input.text)) throw new Error('Message must be 1-10000 characters');
    child.write(`${input.text}\r`);
  }

  stop(sessionId: string): void {
    const child = this.processes.get(sessionId);
    if (!child) throw new Error('Session is not running');
    const session = this.store.session(sessionId);
    this.store.finishSession(sessionId, 'stopped', null);
    this.processes.delete(sessionId);
    const pending = this.pendingFirstTurn.get(sessionId);
    if (pending) clearTimeout(pending);
    this.pendingFirstTurn.delete(sessionId);
    child.kill();
    this.emit({ sessionId, cardId: session.cardId, type: 'state', data: 'Agent stopped', state: 'stopped' });
  }

  dispose(): void {
    this.disposed = true;
    for (const sessionId of [...this.processes.keys()]) this.stop(sessionId);
  }

  private readAndClearFinalMessage(sessionId: string): string | null {
    const record = this.finalMessageFiles.get(sessionId);
    if (!record) return null;
    this.finalMessageFiles.delete(sessionId);
    let message: string | null = null;
    try { message = readFileSync(record.path, 'utf8'); } catch { /* No final response was produced. */ }
    try { rmSync(record.directory, { recursive: true, force: true }); } catch { /* Locked until the child exits. */ }
    return message;
  }
}
