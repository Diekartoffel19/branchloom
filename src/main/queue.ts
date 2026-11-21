import type { ProjectQueue, QueueState, Session, Workflow } from '../shared/types';
import { StudioStore } from './store';
import { WorkflowEngine } from './workflows';

function pauseMessage(workflow: Workflow): string {
  if (workflow.pauseReason === 'approval') return 'Workflow wartet auf eine ausdrückliche Schrittfreigabe.';
  if (workflow.pauseReason === 'manual') return 'Workflow wartet auf Bestätigung eines manuellen Schritts.';
  if (workflow.pauseReason === 'review') return 'Agentenlauf prüfen; ein erneuter Start kann eine Aktion wiederholen.';
  return 'Aktiven Workflow prüfen und ausdrücklich fortsetzen.';
}

/** Explicit project queue. Restart and any uncertain outcome leave it paused. */
export class ProjectQueueEngine {
  private readonly pumping = new Set<string>();
  constructor(private readonly store: StudioStore, private readonly workflows: WorkflowEngine) {}

  setState(input: { projectId: string; state: QueueState; templateWorkflowId?: string }): ProjectQueue {
    const current = this.store.projectQueue(input.projectId);
    const templateWorkflowId = input.templateWorkflowId ?? current.templateWorkflowId;
    if (input.state === 'running') {
      if (!templateWorkflowId) throw new Error('Zuerst eine Workflow-Route als Vorlage wählen.');
      this.store.queueCandidates(input.projectId, 1); // Validate To Do before persisting a running queue.
      const template = this.store.workflow(templateWorkflowId);
      if (template.projectId !== input.projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
      if (current.activeWorkflowId) {
        const active = this.store.workflow(current.activeWorkflowId);
        if (active.state !== 'done' && active.state !== 'running') throw new Error(`${pauseMessage(active)} Die Queue setzt diesen Schritt nicht selbst erneut in Gang.`);
        if (active.state === 'done' && active.currentStep < active.steps.length) throw new Error('Aktiver Workflow wurde vorzeitig als erledigt markiert; bitte prüfen.');
      }
      this.store.saveProjectQueue({ projectId: input.projectId, state: 'running', templateWorkflowId, activeWorkflowId: current.activeWorkflowId, pauseReason: null });
      this.pump(input.projectId);
      return this.store.projectQueue(input.projectId);
    }
    if (input.state !== 'paused' && input.state !== 'off') throw new Error('Ungültiger Warteschlangen-Status.');
    if (current.activeWorkflowId) {
      const active = this.store.workflow(current.activeWorkflowId);
      if (active.state === 'running') this.workflows.setState({ id: active.id, state: 'paused' });
    }
    return this.store.saveProjectQueue({ projectId: input.projectId, state: input.state, templateWorkflowId, activeWorkflowId: current.activeWorkflowId, pauseReason: input.state === 'paused' ? 'Vom Nutzer pausiert; aktiven Workflow vor Fortsetzung prüfen.' : null });
  }

  onSessionFinished(session: Session): void { this.pump(session.projectId); }
  onBoardChanged(projectId: string): void { this.pump(projectId); }

  private pause(projectId: string, message: string): void {
    const queue = this.store.projectQueue(projectId);
    this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: queue.activeWorkflowId, pauseReason: message });
  }

  private pump(projectId: string): void {
    if (this.pumping.has(projectId) || this.store.projectQueue(projectId).state !== 'running') return;
    this.pumping.add(projectId);
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        const queue = this.store.projectQueue(projectId);
        if (queue.state !== 'running' || !queue.templateWorkflowId) return;
        if (queue.activeWorkflowId) {
          const active = this.store.workflow(queue.activeWorkflowId);
          if (active.state === 'running') return;
          if (active.state === 'paused' || active.state === 'draft') { this.pause(projectId, pauseMessage(active)); return; }
          if (active.currentStep < active.steps.length) { this.pause(projectId, 'Aktiver Workflow wurde vorzeitig als erledigt markiert; bitte prüfen.'); return; }
          this.store.saveProjectQueue({ projectId, state: 'running', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: null, pauseReason: null });
        }
        if (this.store.activeSessionForProject(projectId)) return;
        const next = this.store.nextQueueCard(projectId);
        if (!next) return; // Running but idle: newly created To-Do cards can be picked up.
        const flow = this.store.claimQueueCard(projectId, next.id, queue.templateWorkflowId);
        try { this.workflows.setState({ id: flow.id, state: 'running' }); }
        catch (error) { this.pause(projectId, `Workflow-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`); return; }
        const started = this.store.workflow(flow.id);
        if (started.state === 'paused') { this.pause(projectId, pauseMessage(started)); return; }
        if (started.state === 'running') return;
        // A route can finish synchronously only when it has no agent work.
      }
    } catch (error) {
      this.pause(projectId, `Warteschlange angehalten: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pumping.delete(projectId);
    }
  }
}
