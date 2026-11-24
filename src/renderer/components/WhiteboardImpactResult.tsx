import type { WhiteboardDirectImporter, WhiteboardImpact } from '../../shared/whiteboard-impact';

export function WhiteboardImpactResult({ impact, onDraft }: { impact: WhiteboardImpact; onDraft?: (site: WhiteboardDirectImporter, button: HTMLButtonElement) => void }) {
  return <div className="wb-impact-result"><strong role="status">{impact.importers.length} direkte Importstelle{impact.importers.length === 1 ? '' : 'n'} gefunden</strong>
    <small>Bezug: {impact.referenceKind === 'file' ? 'Datei' : 'Ordner'} <code>{impact.referencePath}</code></small>
    <small>{impact.scannedFiles} Dateien geprüft · {impact.partial ? 'Unvollständige Prüfung' : 'Prüfung innerhalb der Grenzen abgeschlossen'}</small>
    {impact.importers.length ? <ol>{impact.importers.map((item, index) => <li key={`${item.path}-${item.line}-${index}`}><code>{item.path}:{item.line}</code><span>→ {item.targetPath}</span>{onDraft ? <button className="secondary-button" type="button" aria-label={`Kartenentwurf aus Import ${item.path} Zeile ${item.line}`} onClick={(event) => onDraft(item, event.currentTarget)}>Kartenentwurf</button> : null}</li>)}</ol> : <p>Keine direkte relative Importstelle im untersuchten Teil gefunden.</p>}
    {impact.notes.map((note) => <p className="wb-impact-note" key={note}>{note}</p>)}
  </div>;
}
