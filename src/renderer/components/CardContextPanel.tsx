import { useEffect, useRef, useState } from 'react';
import { FileText, Link2, Trash2 } from 'lucide-react';
import type { Card, CardContextPreview, CardContextReference } from '../../shared/types';
import { CARD_ATTACHMENT_DRAG_TYPE } from '../attachment-drag';
import { WHITEBOARD_CONTEXT_DRAG_TYPE } from '../whiteboard-context-drag';
import { WhiteboardContextSources } from './WhiteboardContextSources';
import './card-context.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function CardContextPanel({ card, attachmentRequest }: { card: Card; attachmentRequest?: { cardId: string; attachmentId: string; token: number } | null }) {
  const [items, setItems] = useState<CardContextReference[]>([]);
  const [kind, setKind] = useState<'file' | 'url'>('file');
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<CardContextPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState('');
  const [preparedWhiteboard, setPreparedWhiteboard] = useState<{ nodeId: string; target: string } | null>(null);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const targetInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setItems([]); setPreview(null); setTarget(''); setError(''); setPrepared(''); setPreparedWhiteboard(null); setWhiteboardOpen(false); setLoading(true);
    void window.studio.cardContextReferences(card.id).then((refs) => { if (live) { setItems(refs); setLoading(false); } })
      .catch((reason: unknown) => { if (live) { setError(messageOf(reason)); setLoading(false); } });
    return () => { live = false; };
  }, [card.id]);

  useEffect(() => {
    if (attachmentRequest?.cardId === card.id) void prepareAttachment(attachmentRequest.attachmentId);
  }, [card.id, attachmentRequest?.token]);

  async function prepareAttachment(attachmentId: string) {
    if (preparing || busy || card.archivedAt) return;
    setPreparing(true); setPrepared(''); setPreparedWhiteboard(null); setError('');
    try {
      const path = await window.studio.cardContextCandidateFromAttachment({ cardId: card.id, attachmentId });
      setKind('file'); setTarget(path);
      setPrepared(`Projektdatei „${path}“ vorbereitet. Prüfe den Pfad und klicke „Bezug hinzufügen“.`);
      requestAnimationFrame(() => targetInput.current?.focus());
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPreparing(false); }
  }

  async function prepareWhiteboard(nodeId: string) {
    if (preparing || busy || card.archivedAt) return;
    setPreparing(true); setPrepared(''); setPreparedWhiteboard(null); setError('');
    try {
      const path = await window.studio.cardContextCandidateFromWhiteboardNode({ cardId: card.id, nodeId });
      setKind('file'); setTarget(path); setPreparedWhiteboard({ nodeId, target: path });
      setPrepared(`Whiteboard-Datei „${path}“ vorbereitet. Prüfe den Pfad und klicke „Bezug hinzufügen“.`);
      requestAnimationFrame(() => targetInput.current?.focus());
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPreparing(false); }
  }

  function onDrop(event: React.DragEvent<HTMLElement>) {
    if (card.archivedAt) return;
    const whiteboard = event.dataTransfer.types.includes(WHITEBOARD_CONTEXT_DRAG_TYPE);
    if (!whiteboard && !event.dataTransfer.types.includes(CARD_ATTACHMENT_DRAG_TYPE)) return;
    event.preventDefault(); setDragActive(false);
    if (whiteboard) {
      const nodeId = event.dataTransfer.getData(WHITEBOARD_CONTEXT_DRAG_TYPE);
      if (nodeId) void prepareWhiteboard(nodeId);
    } else {
      const attachmentId = event.dataTransfer.getData(CARD_ATTACHMENT_DRAG_TYPE);
      if (attachmentId) void prepareAttachment(attachmentId);
    }
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || card.archivedAt) return;
    setBusy(true); setError('');
    try {
      setItems(preparedWhiteboard && kind === 'file' && preparedWhiteboard.target === target
        ? await window.studio.addCardContextReferenceFromWhiteboardNode({ cardId: card.id, nodeId: preparedWhiteboard.nodeId, expectedTarget: target })
        : await window.studio.addCardContextReference({ cardId: card.id, kind, target }));
      setTarget(''); setPrepared(''); setPreparedWhiteboard(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function show(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { setPreview(await window.studio.previewCardContextReference({ cardId: card.id, referenceId: id })); }
    catch (reason) { setPreview(null); setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (busy || card.archivedAt) return;
    setBusy(true); setError('');
    try {
      setItems(await window.studio.removeCardContextReference({ cardId: card.id, referenceId: id }));
      if (preview?.id === id) setPreview(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className={dragActive ? 'card-context card-context-drop-active' : 'card-context'} aria-label="Kartenkontext"
    onDragOver={(event) => { if ((event.dataTransfer.types.includes(CARD_ATTACHMENT_DRAG_TYPE) || event.dataTransfer.types.includes(WHITEBOARD_CONTEXT_DRAG_TYPE)) && !card.archivedAt) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragActive(true); } }}
    onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }}
    onDrop={onDrop}>
    <div className="section-heading"><Link2 size={18} aria-hidden="true" /><h3>Kontextbezüge</h3></div>
    <p className="section-copy">Verknüpft Projektdateien oder öffentliche Doku-Adressen mit dieser Karte. Inhalte werden erst mit „Vorschau“ lokal gelesen; Webseiten werden nicht abgerufen. Agenten erhalten diese Bezüge nicht automatisch.</p>
    {!card.archivedAt ? <details className="card-context-whiteboard" onToggle={(event) => setWhiteboardOpen(event.currentTarget.open)}><summary>Whiteboard-Dateien auswählen</summary>
      {whiteboardOpen ? <WhiteboardContextSources projectId={card.projectId} disabled={busy || preparing} onPrepare={(id) => void prepareWhiteboard(id)} /> : null}
    </details> : null}
    {!card.archivedAt ? <form className="card-context-form" onSubmit={(event) => void add(event)}>
      <label>Quelltyp<select value={kind} disabled={busy || preparing} onChange={(event) => { setKind(event.target.value as 'file' | 'url'); setTarget(''); setPrepared(''); setPreparedWhiteboard(null); }}><option value="file">Projektdatei</option><option value="url">Öffentliche Doku-URL</option></select></label>
      <label>{kind === 'file' ? 'Relativer Projektpfad' : 'HTTPS-Adresse'}<input ref={targetInput} type={kind === 'file' ? 'text' : 'url'} value={target} required maxLength={kind === 'file' ? 300 : 2048} disabled={busy || preparing} onChange={(event) => { setTarget(event.target.value); setPrepared(''); setPreparedWhiteboard(null); }} placeholder={kind === 'file' ? 'src/components/Button.tsx' : 'https://docs.example.org/guide'} /></label>
      {prepared ? <p className="card-context-prepared" role="status">{prepared}</p> : null}
      <button className="secondary-button" type="submit" disabled={busy || preparing || !target.trim() || items.length >= 20}>Bezug hinzufügen</button>
    </form> : null}
    {loading ? <p className="section-copy" role="status">Kontextbezüge werden geladen…</p> : items.length ? <ul className="card-context-list">{items.map((item) => <li key={item.id}>
      <div className="card-context-source">{item.kind === 'file' ? <FileText size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}<span>{item.target}</span></div>
      <small>{item.kind === 'url' ? 'Adresse gespeichert, Inhalt nicht geprüft' : item.available ? 'Projektdatei' : 'Datei fehlt oder liegt nicht mehr im Projekt'}</small>
      <div className="card-context-actions"><button className="secondary-button small" type="button" disabled={busy || (item.kind === 'file' && !item.available)} onClick={() => void show(item.id)}>Vorschau</button>
        <button className="icon-button" type="button" disabled={busy || Boolean(card.archivedAt)} aria-label={`Kontextbezug „${item.target}“ entfernen`} title="Nur Bezug entfernen" onClick={() => void remove(item.id)}><Trash2 size={15} /></button></div>
      {preview?.id === item.id ? <div className="card-context-preview"><p>{preview.note}</p>{preview.text !== null ? <pre>{preview.text}</pre> : null}{preview.truncated ? <small>Vorschau nach 4 KB gekürzt.</small> : null}</div> : null}
    </li>)}</ul> : <p className="section-copy">Noch keine Kontextbezüge an dieser Karte.</p>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
