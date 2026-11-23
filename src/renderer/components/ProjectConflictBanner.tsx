import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ProjectConflictRadarResult } from '../../shared/conflict-radar';
import './project-conflict-banner.css';

interface Props {
  result: ProjectConflictRadarResult;
  busy: boolean;
  onRefresh: () => void;
  onOpenCard: (cardId: string) => void;
}

/** A warning across every view. The full per-card evidence stays in the drawer. */
export function ProjectConflictBanner({ result, busy, onRefresh, onOpenCard }: Props) {
  if (result.state === 'idle' || result.state === 'clear') return null;
  const overlap = result.state === 'overlap';
  return <section className={`project-conflict-banner ${overlap ? 'has-overlap' : 'incomplete'}`} aria-label="Projektweites Konflikt-Radar" role="status">
    <div className="project-conflict-heading">
      <AlertTriangle size={18} aria-hidden="true" />
      <div><strong>{overlap ? `${result.pairCount} ${result.pairCount === 1 ? 'Überschneidung' : 'Überschneidungen'} in laufenden Worktrees` : 'Konfliktprüfung unvollständig'}</strong>
        <small>{result.runningCount === null ? 'Anzahl laufender Sitzungen unbekannt' : `${result.runningCount} laufende Sitzungen`} · Momentaufnahme {new Date(result.checkedAt).toLocaleTimeString('de-DE')}</small></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /> {busy ? 'Prüfe…' : 'Erneut prüfen'}</button>
    </div>
    {result.reason ? <p className="project-conflict-reason">{result.reason}</p> : null}
    {result.pairs.slice(0, 3).map((pair) => <div className="project-conflict-pair" key={`${pair.leftCardId}:${pair.rightCardId}`}>
      <button type="button" onClick={() => onOpenCard(pair.leftCardId)}>{pair.leftCardTitle}</button><span>und</span>
      <button type="button" onClick={() => onOpenCard(pair.rightCardId)}>{pair.rightCardTitle}</button>
      <span>· {pair.commonCount} {pair.commonCount === 1 ? 'gemeinsamer Git-Pfad' : 'gemeinsame Git-Pfade'}</span>
      {pair.commonPaths.length ? <code title={pair.commonPaths.join(', ')}>{pair.commonPaths[0]}{pair.commonCount > 1 ? ` +${pair.commonCount - 1}` : ''}</code> : null}
    </div>)}
    {result.pairCount > 3 ? <p className="project-conflict-reason">Weitere {result.pairCount - 3} Kartenpaare: Öffne eine betroffene Karte für die vollständige Prüfung.</p> : null}
    {result.issues.length ? <div className="project-conflict-issues"><strong>Unvollständig geprüft</strong>
      {result.issues.slice(0, 3).map((issue, index) => <p key={`${issue.cardId}:${index}`}><button type="button" onClick={() => onOpenCard(issue.cardId)}>{issue.cardTitle}</button> · {issue.reason}</p>)}
      {result.issues.length > 3 ? <small>Und {result.issues.length - 3} weitere Prüfhindernisse.</small> : null}
    </div> : null}
    <small className="project-conflict-footnote">Nur beobachtete Git-Pfade; ignorierte Dateien, spätere Änderungen und Abhängigkeiten zwischen verschiedenen Dateien sind nicht erfasst.</small>
  </section>;
}
