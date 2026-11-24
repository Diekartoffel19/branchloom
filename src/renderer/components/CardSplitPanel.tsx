import { useEffect, useRef, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { Card, Column, ProjectQueue } from '../../shared/types';
import type { CardSplitDraftItem, CardSplitLinks, CardSplitPreview, CardSplitResult } from '../../shared/card-split';
import type { Mutate } from './shared';
import './card-split.css';

const blank = (): CardSplitDraftItem => ({ title: '', description: '', dependsOnIndex: null });
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function CardSplitPanel({ card, columns, queue, mutate, onOpenCard }: {
  card: Card; columns: Column[]; queue?: ProjectQueue; mutate: Mutate; onOpenCard: (id: string) => void;
}) {
  const [links, setLinks] = useState<CardSplitLinks | null>(null);
  const [editing, setEditing] = useState(false);
  const [columnId, setColumnId] = useState('');
  const [items, setItems] = useState<CardSplitDraftItem[]>([blank(), blank()]);
  const [preview, setPreview] = useState<CardSplitPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const safeColumns = columns.filter((column) => !column.autoStart && !(column.name.trim().toLocaleLowerCase('de-DE') === 'to do' && (queue?.state ?? 'off') !== 'off'));

  useEffect(() => {
    let active = true;
    request.current += 1;
    setLinks(null); setEditing(false); setColumnId(''); setItems([blank(), blank()]); setPreview(null); setError('');
    void window.studio.cardSplitLinks(card.id).then((value) => { if (active) setLinks(value); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; request.current += 1; };
  }, [card.id]);

  function changeItem(index: number, change: Partial<CardSplitDraftItem>) {
    request.current += 1; setPreview(null); setError('');
    setItems((old) => old.map((item, at) => at === index ? { ...item, ...change } : item));
  }

  function removeItem(index: number) {
    if (items.length <= 2) return;
    request.current += 1; setPreview(null); setError('');
    setItems((old) => old.filter((_, at) => at !== index).map((item) => ({
      ...item, dependsOnIndex: item.dependsOnIndex === index ? null : item.dependsOnIndex !== null && item.dependsOnIndex > index ? item.dependsOnIndex - 1 : item.dependsOnIndex,
    })));
  }

  async function checkPreview() {
    const current = ++request.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await window.studio.previewCardSplit({ cardId: card.id, columnId, items });
      if (current === request.current) setPreview(result);
    } catch (reason) { if (current === request.current) setError(messageOf(reason)); }
    finally { if (current === request.current) setBusy(false); }
  }

  async function confirm() {
    if (!preview || busy) return;
    const current = ++request.current;
    setBusy(true); setError('');
    const operation: { created: CardSplitResult | null } = { created: null };
    await mutate(async () => { operation.created = await window.studio.createCardSplit({ cardId: card.id, columnId, items, token: preview.token, confirm: true }); return operation.created; });
    if (current !== request.current) return;
    setBusy(false);
    if (!operation.created) { setPreview(null); setError('Übernahme fehlgeschlagen. Prüfe die Meldung oben und erstelle eine neue Vorschau.'); return; }
    setLinks(operation.created.links); setItems([blank(), blank()]); setPreview(null); setEditing(false);
  }

  return <section className="card-split" aria-label="Teilkarten">
    <div className="section-heading"><ListTree size={19} aria-hidden="true" /><h3>Teilkarten</h3></div>
    <p className="section-copy">Plane mehrere Aufgaben und ihre Reihenfolge. Erst die bestätigte Vorschau legt Karten an. Abhängigkeiten bleiben als Planung sichtbar; die Warteschlange prüft sie noch nicht.</p>
    {links?.parent ? <div className="card-split-parent"><span>Teil von</span><button className="text-button" type="button" onClick={() => onOpenCard(links.parent!.cardId)}>{links.parent.title}</button>{links.parent.dependsOnCardId ? <><span>nach</span><button className="text-button" type="button" onClick={() => onOpenCard(links.parent!.dependsOnCardId!)}>{links.parent.dependsOnTitle}</button></> : null}</div> : null}
    {links?.children.length ? <ol className="card-split-children">{links.children.map((child) => <li key={child.cardId}>
      <span className="card-split-order">{child.position + 1}</span>
      <div><button type="button" className="text-button" onClick={() => onOpenCard(child.cardId)}>{child.title}</button>
        <small>{child.dependsOnTitle ? `Nach „${child.dependsOnTitle}“` : 'Ohne Vorgänger'}{child.archivedAt ? ' · archiviert' : ''}</small></div>
    </li>)}</ol> : null}
    {!links && !error ? <p className="section-copy" role="status">Teilkarten werden geladen…</p> : null}
    {card.archivedAt ? <p className="inline-note">Archivierte Karten bleiben lesbar; stelle sie zum Aufteilen wieder her.</p> : null}
    {!card.archivedAt && !editing ? <button type="button" className="secondary-button" onClick={() => { setEditing(true); setColumnId(safeColumns.find((column) => column.name === 'Planning')?.id ?? safeColumns[0]?.id ?? ''); }}>Teilkarten planen</button> : null}
    {!card.archivedAt && editing ? <div className="card-split-editor">
      <label>Zielspalte<select value={columnId} disabled={busy} onChange={(event) => { request.current += 1; setColumnId(event.target.value); setPreview(null); setError(''); }}><option value="">Spalte wählen</option>{safeColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
      {!safeColumns.length ? <p className="inline-note">Keine manuelle Zielspalte verfügbar. Lege eine manuelle Spalte an oder schalte automatische Starts aus.</p> : null}
      <ol className="card-split-drafts">{items.map((item, index) => <li key={index}>
        <div className="card-split-draft-title"><strong>{index + 1}. Teilkarte</strong>{items.length > 2 ? <button className="text-button" type="button" disabled={busy} onClick={() => removeItem(index)}>Entfernen</button> : null}</div>
        <label>Titel<input value={item.title} maxLength={160} disabled={busy} onChange={(event) => changeItem(index, { title: event.target.value })} placeholder="Konkretes Ergebnis" /></label>
        <label>Beschreibung<textarea rows={2} value={item.description} maxLength={3000} disabled={busy} onChange={(event) => changeItem(index, { description: event.target.value })} placeholder="Was gehört dazu?" /></label>
        <label>Vorgänger<select value={item.dependsOnIndex ?? ''} disabled={busy || index === 0} onChange={(event) => changeItem(index, { dependsOnIndex: event.target.value === '' ? null : Number(event.target.value) })}><option value="">Kein Vorgänger</option>{items.slice(0, index).map((earlier, at) => <option key={at} value={at}>{at + 1}. {earlier.title.trim() || 'Ohne Titel'}</option>)}</select></label>
      </li>)}</ol>
      <div className="card-split-actions"><button type="button" className="text-button" disabled={busy || items.length >= 8} onClick={() => { request.current += 1; setItems((old) => [...old, blank()]); setPreview(null); }}>Teilkarte hinzufügen</button>
        <button type="button" className="secondary-button" disabled={busy || !columnId || items.some((item) => !item.title.trim())} onClick={() => void checkPreview()}>{busy ? 'Prüfe…' : 'Vorschau prüfen'}</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => { request.current += 1; setEditing(false); setPreview(null); setError(''); }}>Abbrechen</button></div>
      {preview ? <div className="card-split-preview" aria-label="Teilkarten-Vorschau"><strong>{preview.items.length} Karten in „{preview.destination.name}“ für „{preview.parent.title}“</strong>
        <ol>{preview.items.map((item, index) => <li key={index}><div><span>{item.title}</span>{item.description ? <p>{item.description}</p> : null}</div>{item.dependsOnIndex !== null ? <small>nach „{preview.items[item.dependsOnIndex]!.title}“</small> : <small>ohne Vorgänger</small>}</li>)}</ol>
        <p>Erst der nächste Klick speichert alle Karten gemeinsam. Es startet kein Agent.</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void confirm()}>Diese {preview.items.length} Teilkarten anlegen</button>
      </div> : null}
    </div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
