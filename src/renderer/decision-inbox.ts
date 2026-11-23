import type { ProjectSnapshot, Workflow } from '../shared/types';

export interface DecisionItem {
  id: string;
  kind: 'workflow' | 'queue';
  title: string;
  reason: string;
  context: string | null;
  workflowId: string | null;
}

function workflowTitle(workflow: Workflow): string {
  if (workflow.pauseReason === 'approval') return `Schrittfreigabe: ${workflow.name}`;
  if (workflow.pauseReason === 'manual') return `Manueller Schritt: ${workflow.name}`;
  if (workflow.pauseReason === 'review') return `Prüfung nötig: ${workflow.name}`;
  return `Pausierter Workflow: ${workflow.name}`;
}

function workflowReason(workflow: Workflow): string {
  if (workflow.pauseReason === 'approval') return 'Der nächste Schritt wartet auf deine ausdrückliche Freigabe.';
  if (workflow.pauseReason === 'manual') return 'Ein Schritt ohne Agent wartet auf deine Bestätigung.';
  if (workflow.pauseReason === 'review') return 'Ein Agentenlauf muss geprüft werden. Ein erneuter Start kann Arbeit oder externe Aktionen wiederholen.';
  return 'Der Workflow ist pausiert. Prüfe den Verlauf vor dem Fortsetzen.';
}

/** Only persisted, actionable pause states enter the inbox. No model text is inferred. */
export function decisionItems(snapshot: ProjectSnapshot): DecisionItem[] {
  const workflows = snapshot.workflows
    .filter((workflow) => workflow.state === 'paused' && !workflow.queueSkip)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((workflow): DecisionItem => {
      const step = workflow.steps[workflow.currentStep];
      const column = step ? snapshot.columns.find((item) => item.id === step.columnId) : null;
      const cardNames = workflow.cardIds
        .map((id) => snapshot.cards.find((card) => card.id === id)?.title)
        .filter((name): name is string => Boolean(name));
      const parts = [step ? `Schritt ${workflow.currentStep + 1} von ${workflow.steps.length}` : null, column?.name, cardNames.length ? `Karten: ${cardNames.slice(0, 3).join(', ')}${cardNames.length > 3 ? ` und ${cardNames.length - 3} weitere` : ''}` : null];
      return {
        id: `workflow:${workflow.id}`, kind: 'workflow', title: workflowTitle(workflow),
        reason: workflowReason(workflow), context: parts.filter(Boolean).join(' · ') || null,
        workflowId: workflow.id,
      };
    });
  if (snapshot.queue.state !== 'paused') return workflows;
  const active = snapshot.workflows.find((workflow) => workflow.id === snapshot.queue.activeWorkflowId);
  return [
    {
      id: 'queue', kind: 'queue', title: 'Warteschlange pausiert',
      reason: snapshot.queue.pauseReason?.trim() || 'Die Warteschlange ist pausiert. Prüfe ihre Route und den aktiven Ablauf vor dem Fortsetzen.',
      context: active ? `Aktiver Ablauf: ${active.name}` : null,
      workflowId: active?.id ?? null,
    },
    ...workflows,
  ];
}
