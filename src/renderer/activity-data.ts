import type { Card, ProjectSnapshot, Session, Workflow } from '../shared/types';

export type ActivityKind = 'session' | 'workflow' | 'card';
export type ActivityStatus = 'running' | 'attention' | 'finished' | 'stopped' | 'paused' | 'idle';
export type ActivityKindFilter = 'all' | ActivityKind;
export type ActivityStatusFilter = 'all' | ActivityStatus;

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  targetId: string;
  title: string;
  subtitle: string;
  status: ActivityStatus;
  statusLabel: string;
  timestamp: string;
  durationMs: number | null;
  exitCode: number | null;
  detail: string;
}

export function sessionDuration(session: Session, now: number): number | null {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : session.state === 'running' ? now : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function sessionStatus(session: Session): { status: ActivityStatus; label: string } {
  if (session.state === 'running') return { status: 'running', label: 'Läuft' };
  if (session.state === 'failed' || (session.state === 'exited' && session.exitCode !== null && session.exitCode !== 0)) return { status: 'attention', label: 'Fehlgeschlagen' };
  if (session.state === 'stopped') return { status: 'stopped', label: 'Gestoppt' };
  return { status: 'finished', label: 'Beendet' };
}

function workflowStatus(workflow: Workflow): { status: ActivityStatus; label: string; detail: string } {
  if (workflow.state === 'running') return { status: 'running', label: 'Läuft', detail: `Schritt ${Math.min(workflow.currentStep + 1, workflow.steps.length)} von ${workflow.steps.length}` };
  if (workflow.state === 'done') return { status: 'finished', label: 'Fertig', detail: `${workflow.steps.length} Schritte abgeschlossen` };
  if (workflow.state === 'draft') return { status: 'idle', label: 'Entwurf', detail: 'Noch nicht gestartet' };
  if (workflow.pauseReason === 'user') return { status: 'paused', label: 'Pausiert', detail: 'Vom Nutzer pausiert' };
  if (workflow.pauseReason === 'review') return { status: 'attention', label: 'Prüfung nötig', detail: 'Agentenlauf prüfen' };
  if (workflow.pauseReason === 'manual') return { status: 'attention', label: 'Bestätigung nötig', detail: 'Manuellen Schritt abschließen' };
  if (workflow.pauseReason === 'approval') return { status: 'attention', label: 'Freigabe nötig', detail: 'Nächsten Schritt freigeben' };
  return { status: 'paused', label: 'Pausiert', detail: 'Pausengrund nicht erfasst' };
}

function sessionItem(session: Session, cards: Map<string, Card>, agents: Map<string, string>, now: number, kind: 'session' | 'card'): ActivityItem {
  const card = cards.get(session.cardId);
  const agentName = agents.get(session.agentId);
  const state = sessionStatus(session);
  return {
    kind, id: kind === 'card' ? session.cardId : session.id, targetId: session.cardId,
    title: card?.title ?? 'Entfernte Karte',
    subtitle: `${kind === 'card' ? 'Karte' : 'Agentenlauf'} · ${agentName ?? 'Entfernter Agent'}`,
    status: state.status, statusLabel: state.label, timestamp: session.startedAt,
    durationMs: sessionDuration(session, now), exitCode: session.exitCode,
    detail: kind === 'card' ? 'Letzter Agentenlauf dieser Karte' : 'Agentenlauf',
  };
}

export function activityItems(snapshot: ProjectSnapshot, now: number, kind: ActivityKindFilter = 'all'): ActivityItem[] {
  const cardById = new Map(snapshot.cards.map((card) => [card.id, card]));
  const agentById = new Map(snapshot.agents.map((agent) => [agent.id, agent.name]));
  const latestByCard = new Map<string, Session>();
  for (const session of snapshot.sessions) {
    const previous = latestByCard.get(session.cardId);
    if (!previous || session.startedAt > previous.startedAt) latestByCard.set(session.cardId, session);
  }
  const sessions = snapshot.sessions.map((session) => sessionItem(session, cardById, agentById, now, 'session'));
  const workflows = snapshot.workflows.map((workflow): ActivityItem => {
    const state = workflowStatus(workflow);
    return { kind: 'workflow', id: workflow.id, targetId: workflow.id, title: workflow.name, subtitle: `Workflow · ${workflow.cardIds.length} Karten`, status: state.status, statusLabel: state.label, timestamp: workflow.updatedAt, durationMs: null, exitCode: null, detail: state.detail };
  });
  const cards = snapshot.cards.map((card: Card): ActivityItem => {
    const latest = latestByCard.get(card.id);
    return latest ? sessionItem(latest, cardById, agentById, now, 'card') : { kind: 'card', id: card.id, targetId: card.id, title: card.title, subtitle: 'Karte', status: 'idle', statusLabel: 'Noch kein Lauf', timestamp: card.updatedAt, durationMs: null, exitCode: null, detail: 'Letzter Lauf: nicht erfasst' };
  });
  const result = kind === 'session' ? sessions : kind === 'workflow' ? workflows : kind === 'card' ? cards : [...sessions, ...workflows, ...cards.filter((card) => card.status === 'idle')];
  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function formatDuration(value: number | null): string {
  if (value === null) return 'nicht erfasst';
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
