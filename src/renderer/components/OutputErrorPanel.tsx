import { useEffect, useState } from 'react';
import type { Card, Column } from '../../shared/types';
import type { OutputErrorPreview, OutputErrorSourceKind } from '../../shared/output-errors';
import './output-errors.css';

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function OutputErrorPanel({ projectId, sourceKind, sourceId, columns, onCreated }: {
  projectId: string; sourceKind: OutputErrorSourceKind; sourceId: string; columns: Column[]; onCreated?: (card: Card) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<OutputErrorPreview | null>(null);
  const [candidateId, setCandidateId] = useState('');
  const [columnId, setColumnId] = useState('');
  const [reproduction, setReproduction] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    setPreview(null); setCandidateId(''); setReproduction(''); setError(''); setNotice(''); setLoading(true);
    setColumnId(columns[0]?.id ?? '');
    void window.studio.previewOutputErrors({ projectId, sourceKind, sourceId }).then((result) => {
      if (!alive) return;
      setPreview(result); setCandidateId(result.candidates[0]?.id ?? ''); setLoading(false);
    }).catch((reason: unknown) => { if (alive) { setError(message(reason)); setLoading(false); } });
    return () => { alive = false; };
  }, [projectId, sourceKind, sourceId]);

  const selected = preview?.candidates.find((item) => item.id === candidateId);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selected || !columnId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const card = await window.studio.createOutputErrorCard({ projectId, sourceKind, sourceId, candidateId: selected.id, columnId, reproduction });
      setNotice('Fehlerkarte gespeichert. Ein Agent wurde nicht gestartet.');
      await onCreated?.(card);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  return <section className="output-errors" aria-label="Fehler aus gespeicherter Ausgabe">
    <h3>Fehler aus Ausgabe übernehmen</h3>
    <p>Wähle eine konkrete Zeile der beendeten Sitzung. Die Ausgabe bleibt lokal; nur diese Zeile und deine Reproduktionsnotiz kommen in die neue Karte.</p>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
    {loading ? <p role="status">Gespeicherte Ausgabe wird geprüft…</p> : !preview ? null : preview.candidates.length === 0
      ? <p>Keine eindeutig erkennbare Fehlerzeile im begrenzten Ausgabeauszug. Du kannst im Board eine Karte manuell anlegen.</p>
      : <form onSubmit={(event) => void create(event)}>
        <label>Fehlerzeile<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={busy}>{preview.candidates.map((item) => <option key={item.id} value={item.id}>Zeile {item.line}: {item.message.slice(0, 100)}</option>)}</select></label>
        {selected ? <p className="output-error-selected"><strong>Ausgewählt:</strong> {selected.message}</p> : null}
        <p className="output-error-source">{preview.sourceLabel} · Beendet {new Date(preview.endedAt).toLocaleString('de-DE')}</p>
        <label>Reproduktionsschritte<textarea rows={2} maxLength={2_000} value={reproduction} disabled={busy} onChange={(event) => setReproduction(event.target.value)} placeholder="Was führte zu diesem Fehler?" /></label>
        <div className="output-error-action"><label>Spalte<select value={columnId} disabled={busy} onChange={(event) => setColumnId(event.target.value)}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="submit" disabled={busy || !columnId}>{busy ? 'Speichere…' : 'Als Karte anlegen'}</button></div>
        <small>Die Karte bleibt lokal in diesem Projekt. Eine laufende To-do-Warteschlange kann die Anlage in To Do sperren.</small>
      </form>}
  </section>;
}
