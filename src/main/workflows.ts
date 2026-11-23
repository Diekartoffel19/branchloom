import type { Session, Workflow, WorkflowState } from '../shared/types';
import { DONE_MARKER, SessionRunner } from './cli';
import { StudioStore } from './store';

/** Last-line gate: the marker in the initial instruction or an earlier echo is not completion. */
export function hasCompletionMarker(output: string): boolean {
  const clean = output.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
  return clean.trimEnd().split('\n').at(-1)?.trim() === DONE_MARKER;
}

/** Durable per-card route. Only a live agent's final gated result advances automatically. */
export class WorkflowEngine {
  private readonly pumping = new Set<string>();
  constructor(private readonly store: StudioStore, private readonly runner: SessionRunner) {}

  setState(input: { id: string; state: WorkflowState }): Workflow {
    const old = this.store.workflow(input.id);
    if (old.queueSkip && input.state !== 'paused') throw new Error('Dieser Queue-Workflow wurde übersprungen und kann nicht erneut gestartet werden. Sein Verlauf bleibt erhalten.');
    if (old.state === 'done' && input.state !== 'done') throw new Error('Completed workflows cannot be restarted');
    if (input.state === 'running') {
      if (old.cardIds.some((cardId) => this.store.card(cardId).archivedAt)) throw new Error('Archivierte Workflow-Karte zuerst wiederherstellen.');
      const overlapping = this.store.snapshot(old.projectId).workflows.find((other) =>
        other.id !== old.id && other.state === 'running' && other.cardIds.some((cardId) => old.cardIds.includes(cardId)));
      if (overlapping) throw new Error(`Card is already running in workflow ${overlapping.name}`);
      if (old.currentStep >= old.steps.length) return this.store.setWorkflowState(input.id, 'done');
      const progress = this.store.workflowProgress(old.id, old.currentStep);
      const step = old.steps[old.currentStep];
      if (old.state === 'paused' && step?.requireApproval && !this.store.isStepApproved(old.id, old.currentStep)) {
        this.store.approveStep(old.id, old.currentStep);
      } else if (old.state === 'paused' && progress.some((row) => row.state === 'manual_wait')) {
        this.store.confirmManualWait(old.id, old.currentStep);
      } else if (old.state === 'paused') {
        // A manual Resume is the only path that re-runs a failed or interrupted
        // card. This can repeat an external action, so the UI must show history.
        this.store.resetWorkflowReview(old.id, old.currentStep);
      }
      const current = this.store.workflow(input.id);
      if (current.currentStep >= current.steps.length) return this.store.setWorkflowState(input.id, 'done');
      this.store.setWorkflowState(input.id, 'running');
      this.pump(input.id);
      return this.store.workflow(input.id);
    }
    if (old.state === 'running') {
      const progress = this.store.workflowProgress(old.id, old.currentStep);
      for (const row of progress) {
        if (row.state === 'running' && row.sessionId) {
          this.store.finishWorkflowCard(row.sessionId, false);
          try { this.runner.stop(row.sessionId); } catch { /* PTY may already have ended. */ }
        }
      }
    }
    return this.store.setWorkflowState(input.id, input.state);
  }

  onSessionFinished(session: Session, finalMessage: string | null = null): void {
    const linked = this.store.workflowForSession(session.id);
    if (!linked) return;
    const current = this.store.workflow(linked.id);
    const agent = this.store.agent(session.agentId);
    // Codex exec writes its actual final message to a separate file. Its PTY
    // scrollback may echo the prompt and redraw lines, so never treat that as
    // evidence of completion. Other one-shot CLIs use their final output.
    const evidence = agent.kind === 'codex' ? finalMessage ?? '' : session.output;
    const completed = session.state === 'exited' && session.exitCode === 0 && hasCompletionMarker(evidence);
    this.store.finishWorkflowCard(session.id, completed);
    if (current.state !== 'running' || current.currentStep !== linked.stepIndex) return;
    if (completed) this.pump(current.id);
    else this.store.setWorkflowState(current.id, 'paused');
  }

  private pump(id: string): void {
    if (this.pumping.has(id)) return;
    this.pumping.add(id);
    try {
      // No-agent route steps can complete immediately. The cap prevents an
      // accidental cyclic state from spinning the main process forever.
      for (let pass = 0; pass < 100; pass += 1) {
        const workflow = this.store.workflow(id);
        if (workflow.state !== 'running') return;
        const step = workflow.steps[workflow.currentStep];
        if (!step) { this.store.setWorkflowState(id, 'done'); return; }
        if (step.requireApproval && !this.store.isStepApproved(id, workflow.currentStep)) {
          this.store.setWorkflowState(id, 'paused');
          return;
        }
        this.store.ensureWorkflowProgress(id, workflow.currentStep, workflow.cardIds);
        const progress = this.store.workflowProgress(id, workflow.currentStep);
        if (progress.some((row) => row.state === 'running')) return;
        if (progress.some((row) => row.state === 'needs_review' || row.state === 'manual_wait')) {
          this.store.setWorkflowState(id, 'paused');
          return;
        }
        const next = progress.find((row) => row.state === 'pending');
        if (!next) {
          this.store.advanceWorkflow(id);
          continue;
        }
        const card = this.store.card(next.cardId);
        if (card.columnId !== step.columnId) this.store.moveCard({ id: card.id, columnId: step.columnId });
        const agentId = step.agentId;
        if (!agentId) {
          this.store.markManualWait(id, workflow.currentStep, card.id);
          this.store.setWorkflowState(id, 'paused');
          return;
        }
        try {
          const prompt = `Work on the following card in the selected project.\n\nTitle: ${card.title}\n\n${card.description}\n\nWhen you have finished this step and checked your work, make ${DONE_MARKER} the exact final line of your response. If blocked or incomplete, explain why and omit the marker.`;
          const session = this.runner.start({ cardId: card.id, agentId, prompt, mode: 'one-shot', overrides: { model: step.model ?? null, effort: step.effort ?? null } });
          this.store.beginWorkflowCard(id, workflow.currentStep, card.id, session.id);
        } catch (error) {
          this.store.setWorkflowState(id, 'paused');
          throw error;
        }
        return;
      }
      throw new Error('Workflow exceeded its immediate transition limit');
    } finally {
      this.pumping.delete(id);
    }
  }
}
