import { useEffect, useState } from 'react';
import { ExternalLink, Paperclip, Trash2 } from 'lucide-react';
import type { Card, CardAttachment } from '../../shared/types';
import '../card-attachments.css';

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function AttachmentList({ items, archived, busy, onOpen, onRemove }: {
  items: CardAttachment[]; archived: boolean; busy: boolean;
  onOpen: (id: string) => void; onRemove: (id: string) => void;
}) {
  if (!items.length) return <p className="section-copy">Noch keine Dateien verknüpft.</p>;
  return <ul className="card-attachment-list">{items.map((item) => <li key={item.id}>
    <div className="card-attachment-name"><Paperclip size={15} aria-hidden="true" /><span>{item.name}</span><small>{new Intl.NumberFormat('de-DE').format(item.size)} Bytes</small></div>
    <div className="card-attachment-actions">
      <button type="button" className="secondary-button small" disabled={busy || !item.available || !item.canOpen} title={!item.available ? 'Verknüpfte Datei fehlt oder wurde verschoben' : !item.canOpen ? 'Dieser Dateityp wird nicht geöffnet' : undefined} onClick={() => onOpen(item.id)}><ExternalLink size={14} /> Öffnen</button>
      <button type="button" className="icon-button" disabled={busy || archived} aria-label={`Verknüpfung „${item.name}“ entfernen`} title="Nur Verknüpfung entfernen; Datei bleibt erhalten" onClick={() => onRemove(item.id)}><Trash2 size={15} /></button>
    </div>
    {!item.available ? <small className="card-attachment-warning">Datei fehlt oder Pfad geändert</small> : !item.canOpen ? <small className="card-attachment-warning">Öffnen für diesen Dateityp gesperrt</small> : null}
  </li>)}</ul>;
}

export function CardAttachments({ card }: { card: Card }) {
  const [items, setItems] = useState<CardAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setItems([]); setError('');
    void window.studio.cardAttachments(card.id).then((value) => { if (live) setItems(value); }).catch((reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, [card.id]);

  async function choose() {
    setBusy(true); setError('');
    try { const result = await window.studio.chooseCardAttachments(card.id); if (result) setItems(result); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError('');
    try { await window.studio.openCardAttachment({ cardId: card.id, attachmentId: id }); }
    catch (reason) { setError(messageOf(reason)); setItems(await window.studio.cardAttachments(card.id).catch(() => items)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError('');
    try { await window.studio.removeCardAttachment({ cardId: card.id, attachmentId: id }); setItems(await window.studio.cardAttachments(card.id)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="card-attachments" aria-label="Kartenanhänge">
    <div className="section-heading"><Paperclip size={18} /><h3>Dateien</h3></div>
    <p className="section-copy">Lokale Dateiverknüpfungen. Dateiinhalte werden nicht kopiert oder automatisch an Agenten übergeben.</p>
    <AttachmentList items={items} archived={Boolean(card.archivedAt)} busy={busy} onOpen={(id) => void open(id)} onRemove={(id) => void remove(id)} />
    {!card.archivedAt ? <button type="button" className="secondary-button" disabled={busy || items.length >= 20} onClick={() => void choose()}><Paperclip size={15} /> Datei verknüpfen</button> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
