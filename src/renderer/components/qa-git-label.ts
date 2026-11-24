import type { CardQaReport } from '../../shared/types';

export function qaGitLabel(report: CardQaReport): string {
  const evidence = report.gitEvidence;
  if (!evidence) return 'Git-Stand: bei diesem älteren Bericht nicht erfasst';
  const scope = evidence.scope === 'card-worktree' ? 'Karten-Worktree' : 'Projektordner';
  const start = evidence.startHead?.slice(0, 12) ?? 'HEAD unbekannt';
  const end = evidence.endHead?.slice(0, 12) ?? 'HEAD unbekannt';
  const head = start === end ? start : `${start} → ${end}`;
  const state = evidence.state === 'clean' ? 'keine Git-sichtbaren Änderungen beim Start und Ende'
    : evidence.state === 'dirty' ? 'nicht committete Dateien beim Start oder Ende'
      : evidence.state === 'changed' ? 'Stand während der Prüfung geändert' : 'Git-Prüfung unvollständig';
  return `Git im ${scope}: ${head} · ${state}`;
}

export function qaGitComparisonNote(left: CardQaReport, right: CardQaReport): string {
  const a = left.gitEvidence;
  const b = right.gitEvidence;
  if (!a || !b || a.state === 'unavailable' || b.state === 'unavailable') return 'Für mindestens eine Aufnahme fehlt ein belastbarer Git-Stand.';
  if (a.scope !== b.scope) return 'Die Aufnahmen wurden mit unterschiedlichen zugeordneten Checkouts erfasst.';
  if (a.state === 'changed' || b.state === 'changed') return 'Ein zugeordneter Checkout änderte sich während einer Prüfung.';
  if (a.state === 'dirty' || b.state === 'dirty') return 'Mindestens ein zugeordneter Checkout hatte nicht committete Dateien.';
  if (a.startHead !== b.startHead) return 'Die zugeordneten Checkouts hatten unterschiedliche Git-HEADs.';
  return 'Beide zugeordneten Checkouts hatten denselben Git-HEAD ohne Git-sichtbare Änderungen.';
}
