import type { ConflictRadarResult } from '../../shared/conflict-radar';
import './conflict-radar.css';

export function ConflictRadarNotice({ result }: { result: ConflictRadarResult }) {
  const allWorktrees = result.scope === 'all-worktrees';
  const summary = result.state === 'overlap'
    ? allWorktrees ? 'In mehreren Karten-Worktrees sind dieselben Git-Pfade geändert. Prüfe die betroffenen Karten vor dem Zusammenführen.' : 'Gleiche Dateien werden in mehreren laufenden Worktrees geändert. Prüfe die betroffenen Karten vor dem Zusammenführen.'
    : result.state === 'unknown'
      ? 'Eine vollständige Prüfung war nicht möglich. Es kann trotzdem Überschneidungen geben.'
      : result.state === 'idle'
        ? allWorktrees ? 'Für diese Karte gibt es noch keinen Git-Worktree.' : 'Für diese Karte läuft gerade kein Agent.'
        : result.peers.length === 0
          ? allWorktrees ? 'Keine weitere Karte hat einen gespeicherten Git-Worktree.' : 'Keine weitere Karte hat gerade einen laufenden Agenten.'
          : 'In dieser Momentaufnahme wurden keine gemeinsamen geänderten Git-Dateien gefunden.';
  return <section className={`conflict-radar conflict-radar-${result.state}`} aria-label="Konflikt-Radar" role={result.state === 'overlap' || result.state === 'unknown' ? 'alert' : 'status'}>
    <h4>{allWorktrees ? 'Karten-Worktrees vergleichen' : 'Parallele Änderungen'}</h4>
    <p>{summary}</p>
    {result.reason && (result.state === 'unknown' || result.state === 'overlap') ? <p>{result.reason}</p> : null}
    {result.peers.length ? <ul>{result.peers.map((peer) => <li key={peer.cardId}>
      <strong>{peer.cardTitle}</strong>
      {peer.state === 'overlap' ? <span>{peer.commonCount} gemeinsame {peer.commonCount === 1 ? 'Datei' : 'Dateien'}</span> : null}
      {peer.state === 'clear' ? <span>Keine gleiche Datei im aktuellen Git-Stand.</span> : null}
      {peer.state === 'unknown' ? <span>Unvollständig: {peer.reason ?? 'Git-Prüfung fehlgeschlagen.'}</span> : null}
      {peer.commonPaths.length ? <div className="conflict-radar-paths">{peer.commonPaths.map((path) => <code key={path}>{path}</code>)}{peer.commonCount > peer.commonPaths.length ? <span>und {peer.commonCount - peer.commonPaths.length} weitere</span> : null}</div> : null}
    </li>)}</ul> : null}
    {result.peers.length ? <small>Momentaufnahme: {new Date(result.checkedAt).toLocaleTimeString('de-DE')}. Ignorierte Dateien und spätere Änderungen werden nicht erfasst.</small> : null}
  </section>;
}
