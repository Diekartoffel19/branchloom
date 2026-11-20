import { useEffect, useMemo, useRef, useState } from 'react';
import { FileJson2, LoaderCircle, Upload, X } from 'lucide-react';
import type { Column, TrelloImportCard, TrelloImportPreview, TrelloImportResult } from '../../shared/types';
import type { Mutate } from './shared';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DISPLAY_LIMIT = 100;

export function defaultTrelloSelection(preview: TrelloImportPreview): string[] {
  return preview.cards.filter((card) => card.eligible && !card.archived && !card.importedCardId).map((card) => card.sourceId);
}

export function importable(card: TrelloImportCard): boolean {
  return card.eligible && !card.importedCardId;
}

export function trelloCardStatus(card: TrelloImportCard): string {
  if (card.importedCardId) return 'Bereits importiert';
  if (card.reason) return `Fehler: ${card.reason}`;
  return card.archived ? 'Archiviert' : 'Bereit';
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

export function TrelloImportPanel({ projectId, columns, mutate, onClose }: {
  projectId: string; columns: Column[]; mutate: Mutate; onClose: () => void;
}) {
  const fileRequestId = useRef(0);
  const [fileName, setFileName] = useState('');
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState<TrelloImportPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [columnId, setColumnId] = useState(columns.find((column) => column.name.toLowerCase() === 'to do')?.id ?? columns[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<'read' | 'preview' | 'accept' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TrelloImportResult | null>(null);
  const matching = useMemo(() => preview?.cards.filter((card) => `${card.title} ${card.listName ?? ''}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())) ?? [], [preview, filter]);
  const shown = matching.slice(0, DISPLAY_LIMIT);
  const matchingCount = matching.length;

  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && busy === null) onClose(); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const requestId = ++fileRequestId.current;
    setFileName(file?.name ?? ''); setJson(''); setPreview(null); setSelectedIds([]); setResult(null); setError(''); setBusy(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError('Die Trello-Datei darf höchstens 8 MiB groß sein.'); return; }
    setBusy('read');
    try { const content = await file.text(); if (fileRequestId.current === requestId) { setJson(content); if (!content.trim()) setError('Die ausgewählte Datei ist leer.'); } }
    catch (reason) { if (fileRequestId.current === requestId) setError(`Datei konnte nicht gelesen werden: ${messageOf(reason)}`); }
    finally { if (fileRequestId.current === requestId) setBusy(null); }
  }

  async function inspect() {
    if (!json) return;
    setBusy('preview'); setError(''); setPreview(null); setResult(null);
    try {
      const next = await window.studio.previewTrelloImport({ projectId, json });
      setPreview(next); setSelectedIds(defaultTrelloSelection(next));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function accept() {
    if (!preview || !json || !columnId || selectedIds.length === 0) return;
    setBusy('accept'); setError(''); setResult(null);
    try {
      const accepted = await window.studio.acceptTrelloImport({ projectId, columnId, json, fingerprint: preview.fingerprint, sourceIds: selectedIds });
      setResult(accepted); setSelectedIds([]);
      await mutate(async () => accepted);
      setPreview(await window.studio.previewTrelloImport({ projectId, json }));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  function toggle(sourceId: string) {
    setSelectedIds((old) => old.includes(sourceId) ? old.filter((id) => id !== sourceId) : [...old, sourceId]);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && busy === null) onClose(); }}>
    <section className="dialog wide trello-import-dialog" role="dialog" aria-modal="true" aria-labelledby="trello-import-title">
      <div className="dialog-heading"><div><small>LOKALER BOARD-IMPORT</small><h2 id="trello-import-title">Trello-JSON importieren</h2></div><button className="icon-button" type="button" aria-label="Schließen" disabled={busy !== null} onClick={onClose}><X size={18} /></button></div>
      <p className="field-help">Wähle einen einzelnen Trello-Board-Export als JSON. Die Datei wird nur im Arbeitsspeicher gelesen. Anhänge, Kommentare und Mitglieder werden nicht importiert.</p>
      <label className="trello-file-label"><FileJson2 size={19} /> JSON-Datei auswählen<input autoFocus type="file" accept=".json,application/json" onChange={(event) => void readFile(event)} disabled={busy === 'preview' || busy === 'accept'} /></label>
      {fileName ? <p className="trello-file-name">{fileName} · maximal 8 MiB und 5.000 Karten</p> : null}
      <button className="secondary-button" type="button" disabled={!json || busy !== null} onClick={() => void inspect()}>{busy === 'preview' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />} Datei prüfen</button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {preview ? <div className="trello-preview">
        <div className="trello-preview-head"><div><h3>{preview.boardName ?? 'Trello-Board'}</h3><p>{preview.total} Karten · {preview.eligible} importierbar · {preview.duplicates} bereits importiert</p></div><span className="state-badge">Vorschau</span></div>
        <label>Zielspalte<select value={columnId} onChange={(event) => setColumnId(event.target.value)} disabled={busy !== null}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
        <p className="field-help">Alle gewählten Karten kommen in diese Spalte. Archivierte Karten sind zunächst abgewählt; du kannst sie einzeln auswählen. Ein Import startet keine Agenten automatisch.</p>
        <div className="trello-selection-row"><span>{selectedIds.length} ausgewählt</span><button className="text-button" type="button" onClick={() => setSelectedIds([])} disabled={busy !== null || selectedIds.length === 0}>Auswahl leeren</button><button className="text-button" type="button" onClick={() => setSelectedIds((old) => [...new Set([...old, ...shown.filter(importable).map((card) => card.sourceId)])])} disabled={busy !== null || shown.length === 0}>Angezeigte auswählen</button></div>
        <label className="sr-only" htmlFor="trello-filter">Karten filtern</label><input id="trello-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Karten oder Trello-Liste filtern…" />
        <div className="trello-card-list" aria-label="Trello-Karten in der Vorschau">{shown.map((card) => <label className={importable(card) ? 'trello-card-row' : 'trello-card-row unavailable'} key={card.sourceId}><input type="checkbox" checked={selectedIds.includes(card.sourceId)} disabled={!importable(card) || busy !== null} onChange={() => toggle(card.sourceId)} /><span><strong>{card.title || '(Ohne Titel)'}</strong><small>{card.listName ?? 'Ohne Liste'} · {trelloCardStatus(card)}</small>{card.description ? <em>{card.description.slice(0, 140)}</em> : null}</span></label>)}{matchingCount === 0 ? <p className="list-empty">Keine Karten für diesen Filter.</p> : null}</div>
        {matchingCount > shown.length ? <p className="field-help">{matchingCount - shown.length} weitere Karten. Filtere nach Titel oder Liste, um sie einzeln zu prüfen.</p> : null}
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busy !== null} onClick={onClose}>Abbrechen</button><button className="primary-button" type="button" disabled={busy !== null || !columnId || selectedIds.length === 0} onClick={() => void accept()}>{busy === 'accept' ? <LoaderCircle size={15} className="spin" /> : null} {selectedIds.length} Karten importieren</button></div>
      </div> : null}
      {result ? <p className="trello-import-result" role="status">{result.created.length} Karten importiert. {result.skippedDuplicateIds.length} inzwischen vorhandene Duplikate übersprungen.</p> : null}
    </section>
  </div>;
}
