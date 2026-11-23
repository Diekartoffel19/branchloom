import type { WhiteboardImpact } from '../../shared/whiteboard-impact';

export function WhiteboardImpactResult({ impact }: { impact: WhiteboardImpact }) {
  return <div className="wb-impact-result" role="status"><strong>{impact.importers.length} direkte Importstelle{impact.importers.length === 1 ? '' : 'n'} gefunden</strong>
    <small>{impact.scannedFiles} Dateien geprüft · {impact.partial ? 'Unvollständige Prüfung' : 'Prüfung innerhalb der Grenzen abgeschlossen'}</small>
    {impact.importers.length ? <ol>{impact.importers.map((item, index) => <li key={`${item.path}-${item.line}-${index}`}><code>{item.path}:{item.line}</code><span>→ {item.targetPath}</span></li>)}</ol> : <p>Keine direkte relative Importstelle im untersuchten Teil gefunden.</p>}
    {impact.notes.map((note) => <p className="wb-impact-note" key={note}>{note}</p>)}
  </div>;
}
