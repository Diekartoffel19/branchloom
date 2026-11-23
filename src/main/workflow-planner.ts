import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowProposal } from '../shared/types';
import { resolveAgentLauncher } from './cli';
import { StudioStore } from './store';
import { validateWorkflowProposal } from './workflow-proposal';

const PLANNER_TIMEOUT_MS = 90_000;
const MAX_PLANNER_OUTPUT = 200_000;

export interface PlannerInvocation { executable: string; args: string[]; cwd: string; outputPath: string }
export type PlannerExecutor = (invocation: PlannerInvocation) => Promise<void>;

/** No shell, no inherited project MCP configuration, and a hard timeout. */
export const executePlanner: PlannerExecutor = (invocation) => new Promise<void>((resolve, reject) => {
  const child = execFile(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    timeout: PLANNER_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  }, (error) => {
    if (error) reject(new Error(`Workflow agent failed or timed out (${String((error as NodeJS.ErrnoException).code ?? 'unknown')}). Review its CLI login and model settings.`));
    else resolve();
  });
  // Codex exec sees piped stdin as additional prompt input. An open pipe makes
  // it wait forever after its positional prompt; close it immediately.
  child.stdin?.end();
});

function outputSchema(columnIds: string[]): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['title', 'explanation', 'cards', 'columnIds'],
    properties: {
      title: { type: 'string' },
      explanation: { type: 'string' },
      cards: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['title', 'description'],
        properties: { title: { type: 'string' }, description: { type: 'string' } },
      } },
      columnIds: { type: 'array', items: { type: 'string', enum: columnIds } },
    },
  };
}

export async function proposeWorkflow(
  store: StudioStore,
  input: { projectId: string; request: string },
  execute: PlannerExecutor = executePlanner,
): Promise<WorkflowProposal> {
  if (typeof input.request !== 'string' || !input.request.trim() || input.request.length > 8_000 || /\0/.test(input.request)) throw new Error('Workflow request must be 1-8000 characters');
  const snapshot = store.snapshot(input.projectId);
  const settings = store.workflowAgentSettings();
  if (!settings.agentId) throw new Error('Choose a global workflow agent in Settings first');
  const preset = store.agent(settings.agentId);
  if (!preset.enabled) throw new Error('The selected workflow agent is disabled');
  // Until verified read-only flags exist for each adapter, do not silently
  // run a shell-capable planner with an unbounded project write permission.
  if (preset.kind !== 'codex') throw new Error('Read-only workflow planning currently supports Codex CLI. Other agents need a verified safe adapter.');
  const launcher = resolveAgentLauncher(preset.command);
  if (!launcher) throw new Error(`Workflow agent CLI is unavailable: ${preset.command}`);
  if (snapshot.columns.length === 0) throw new Error('Create a board column before planning');
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-studio-plan-'));
  const schemaPath = join(directory, 'proposal.schema.json');
  const outputPath = join(directory, 'proposal.json');
  try {
    writeFileSync(schemaPath, JSON.stringify(outputSchema(snapshot.columns.map((column) => column.id))));
    const available = snapshot.columns.map((column) => ({ id: column.id, name: column.name, autoStart: column.autoStart, agent: column.agentId ? store.agent(column.agentId).name : null }));
    const prompt = [
      'You are the read-only workflow planning agent for Branchloom.',
      'Inspect this project when useful, but do not modify files or run external actions.',
      'Produce only a JSON object matching the output schema. The proposal is reviewed before anything is created.',
      'Split the request into concrete, reviewable cards. Choose a sensible route from the existing column IDs.',
      `Project: ${snapshot.project.name}`,
      `Available columns: ${JSON.stringify(available)}`,
      `User request: ${input.request.trim()}`,
    ].join('\n\n');
    const model = settings.model ?? preset.model;
    const args = [...launcher.prefixArgs, 'exec', '--ignore-user-config', '--sandbox', 'read-only', '--skip-git-repo-check', '--output-schema', schemaPath, '--output-last-message', outputPath];
    if (model) args.push('--model', model);
    if (settings.effort) args.push('--config', `model_reasoning_effort="${settings.effort}"`);
    // Preset CLI flags may contain permission overrides. The planner uses a
    // fixed read-only invocation; only its executable and explicit model/effort
    // are inherited from settings.
    args.push(prompt);
    await execute({ executable: launcher.executable, args, cwd: snapshot.project.path, outputPath });
    const output = readFileSync(outputPath, 'utf8');
    if (!output || output.length > MAX_PLANNER_OUTPUT) throw new Error('Workflow agent returned no valid proposal');
    let parsed: unknown;
    try { parsed = JSON.parse(output); } catch { throw new Error('Workflow agent returned invalid JSON'); }
    return validateWorkflowProposal(parsed, snapshot.columns);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
