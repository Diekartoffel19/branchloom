import { useState } from 'react';
import type { Card, CardQaReport, Column } from '../../shared/types';
import type { QaFixCardPreview } from '../../shared/qa-fix-card';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

/** A report remains the source; opening this editor neither creates a card nor starts an agent. */
export function CardQaFixCard({ sourceCard, report }: { sourceCard: Card; report: CardQaReport }) {
  const [draft, setDraft] = useState<QaFixCardPreview | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [columnId, setColumnId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Card | null>(null);

  if (report.status === 'passed') return null;

  async function prepare() {
    if (busy) return;
    if (draft) { setDraft(null); setError(''); return; }
    setBusy(true); setError('');
    try {
      const [preview, snapshot] = await Promise.all([
        window.studio.previewQaFixCard({ projectId: sourceCard.projectId, sourceCardId: sourceCard.id, reportId: report.id }),
        window.studio.snapshot(sourceCard.projectId),
      ]);
      const safeColumns = snapshot.columns.filter((item) => !item.autoStart && !(item.name.trim().toLocaleLowerCase('de-DE') === 'to do' && snapshot.queue.state === 'running'));
      if (!safeColumns.length) throw new Error('Keine manuelle Zielspalte verfügbar. Pausiere die Queue oder deaktiviere den Spalten-Autostart.');
      setColumns(safeColumns); setColumnId(safeColumns[0]!.id);
      setTitle(preview.title); setDescription(preview.description); setDraft(preview);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || !columnId || !title.trim() || sourceCard.archivedAt) return;
    setBusy(true); setError('');
    try {
      const card = await window.studio.createQaFixCard({ projectId: sourceCard.projectId, sourceCardId: sourceCard.id, reportId: report.id,
        token: draft.token, columnId, title, description });
      setCreated(card); setDraft(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <div className="card-qa-fix-card">
    {created ? <p className="inline-note" role="status">Fixkarte „{created.title}“ im Board gespeichert. Der QA-Bericht bleibt auf dieser Karte.</p>
      : <button className="secondary-button small" type="button" disabled={busy || Boolean(sourceCard.archivedAt)} onClick={() => void prepare()}>{busy && !draft ? 'Bereitet vor…' : draft ? 'Entwurf schließen' : 'Fixkarte vorbereiten'}</button>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {draft && !created ? <form onSubmit={(event) => void create(event)}>
      <p className="card-qa-fix-source">Quelle: QA-Bericht {report.id}. Titel und Beschreibung sind vor dem Speichern editierbar; die Quellenzeile wird beim Erstellen ergänzt.</p>
      <label>Titel<input value={title} maxLength={200} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Beschreibung<textarea value={description} maxLength={5000} rows={6} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Zielspalte<select value={columnId} disabled={busy} onChange={(event) => setColumnId(event.target.value)}>{columns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <button className="secondary-button small" type="submit" disabled={busy || !title.trim() || !columnId}>{busy ? 'Speichert…' : 'Fixkarte erstellen'}</button>
    </form> : null}
  </div>;
}
