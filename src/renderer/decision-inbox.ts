import type { ProjectSnapshot, Workflow } from '../shared/types';

export interface DecisionItem {
  id: string;
  kind: 'workflow' | 'queue' | 'session';
  category: 'approval' | 'manual' | 'review' | 'paused';
  title: string;
  reason: string;
  context: string | null;
  nextAction: string;
  updatedAt: string | null;
  workflowId: string | null;
  sessionId: string | null;
  cardId: string | null;
}

export type DecisionFilter = 'all' | DecisionItem['category'];

export function filterDecisionItems(items: DecisionItem[], category: DecisionFilter, query: string): DecisionItem[] {
  const search = query.trim().toLocaleLowerCase('de');
  return items.filter((item) =>
    (category === 'all' || item.category === category)
    && (!search || [item.title, item.reason, item.context, item.nextAction].some((value) => value?.toLocaleLowerCase('de').includes(search))),
  );
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

function workflowNextAction(workflow: Workflow): string {
  if (workflow.pauseReason === 'approval') return 'Prüfe den nächsten Schritt im Workflow und gib ihn dort ausdrücklich frei.';
  if (workflow.pauseReason === 'manual') return 'Erledige oder prüfe die Handarbeit; bestätige den Schritt erst danach im Workflow.';
  if (workflow.pauseReason === 'review') return 'Prüfe das Agentenergebnis und den Verlauf, bevor du den Schritt erneut startest.';
  return 'Prüfe den bisherigen Verlauf, bevor du den Workflow fortsetzt.';
}

/** Only persisted, actionable pause states enter the inbox. No model text is inferred. */
export function decisionItems(snapshot: ProjectSnapshot): DecisionItem[] {
  const columns = new Map(snapshot.columns.map((column) => [column.id, column]));
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const workflows = snapshot.workflows
    .filter((workflow) => workflow.state === 'paused' && !workflow.queueSkip)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((workflow): DecisionItem => {
      const step = workflow.steps[workflow.currentStep];
      const column = step ? columns.get(step.columnId) : null;
      const cardNames = workflow.cardIds
        .map((id) => cards.get(id)?.title)
        .filter((name): name is string => Boolean(name));
      const agent = step?.agentId ? agents.get(step.agentId) : null;
      const parts = [step ? `Schritt ${workflow.currentStep + 1} von ${workflow.steps.length}` : null, column?.name, step ? (agent?.name ?? (step.agentId ? 'Agent nicht mehr vorhanden' : 'Ohne Agent')) : null, cardNames.length ? `Karten: ${cardNames.slice(0, 3).join(', ')}${cardNames.length > 3 ? ` und ${cardNames.length - 3} weitere` : ''}` : null];
      return {
        id: `workflow:${workflow.id}`, kind: 'workflow', category: workflow.pauseReason === 'approval' || workflow.pauseReason === 'manual' || workflow.pauseReason === 'review' ? workflow.pauseReason : 'paused', title: workflowTitle(workflow),
        reason: workflowReason(workflow), context: parts.filter(Boolean).join(' · ') || null,
        nextAction: workflowNextAction(workflow), updatedAt: workflow.updatedAt,
        workflowId: workflow.id,
        sessionId: null, cardId: null,
      };
    });
  const interruptions: DecisionItem[] = (snapshot.interruptedSessions ?? []).map((item) => ({
    id: `session:${item.sessionId}`, kind: 'session', category: 'review',
    title: `Unterbrochener Agentenlauf: ${item.cardTitle}`,
    reason: 'Branchloom wurde während dieses Laufs beendet. Ob eine Datei oder externe Aktion bereits geändert wurde, ist nicht sicher. Der Auftrag wird nicht automatisch wiederholt.',
    context: `${item.agentName} · Karte: ${item.cardTitle}${item.worktreePath ? ' · Git-Worktree vorhanden' : ''}`,
    nextAction: 'Prüfe den gespeicherten Verlauf und die Projektdateien. Öffne bei Codex bei Bedarf bewusst den Gesprächs-Picker. Quittiere die Unterbrechung erst danach.',
    updatedAt: item.interruptedAt, workflowId: null, sessionId: item.sessionId, cardId: item.cardId,
  }));
  if (snapshot.queue.state !== 'paused') return [...interruptions, ...workflows];
  const active = snapshot.workflows.find((workflow) => workflow.id === snapshot.queue.activeWorkflowId);
  return [
    {
      id: 'queue', kind: 'queue', title: 'Warteschlange pausiert',
      category: 'paused',
      reason: snapshot.queue.pauseReason?.trim() || 'Die Warteschlange ist pausiert. Prüfe ihre Route und den aktiven Ablauf vor dem Fortsetzen.',
      context: active ? `Aktiver Ablauf: ${active.name}` : null,
      nextAction: active?.state === 'paused' && !active.queueSkip
        ? 'Prüfe zuerst den aktiven Workflow. Die Warteschlange bleibt bis zu deiner Entscheidung angehalten.'
        : 'Prüfe den Queue-Status und die nächste Karte vor dem Fortsetzen.',
      updatedAt: snapshot.queue.updatedAt,
      workflowId: active?.id ?? null,
      sessionId: null, cardId: null,
    },
    ...interruptions,
    ...workflows,
  ];
}
