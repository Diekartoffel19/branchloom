import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, Link2, MousePointer2, Trash2 } from 'lucide-react';
import type { Card, CardContextKind, CardContextPreview, CardContextReference } from '../../shared/types';
import { CARD_ATTACHMENT_DRAG_TYPE } from '../attachment-drag';
import { WHITEBOARD_CONTEXT_DRAG_TYPE } from '../whiteboard-context-drag';
import { DESIGN_CONTEXT_DRAG_TYPE } from '../design-context-drag';
import { WhiteboardContextSources } from './WhiteboardContextSources';
import { DesignContextSources } from './DesignContextSources';
import './card-context.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const referenceNote = (item: CardContextReference): string => {
  if (item.kind === 'url') return 'Adresse gespeichert, Inhalt nicht geprüft';
  if (item.kind === 'folder') return item.available ? 'Projektordner, Inhalt nicht gelesen' : 'Ordner fehlt oder liegt nicht mehr im Projekt';
  if (item.kind === 'design') return item.available ? 'Gespeicherter Design-Beleg, Live-Seite nicht geprüft' : 'Design-Beleg fehlt oder gehört nicht mehr zum Projekt';
  return item.available ? 'Projektdatei' : 'Datei fehlt oder liegt nicht mehr im Projekt';
};

export function CardContextPanel({ card, attachmentRequest }: { card: Card; attachmentRequest?: { cardId: string; attachmentId: string; token: number } | null }) {
  const [items, setItems] = useState<CardContextReference[]>([]);
  const [kind, setKind] = useState<CardContextKind>('file');
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<CardContextPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState('');
  const [preparedWhiteboard, setPreparedWhiteboard] = useState<{ nodeId: string; kind: 'file' | 'folder'; target: string } | null>(null);
  const [preparedDesign, setPreparedDesign] = useState<{ selectionId: string; fingerprint: string; label: string } | null>(null);
  const [designNote, setDesignNote] = useState('');
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const targetInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setItems([]); setPreview(null); setTarget(''); setError(''); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); setDesignNote(''); setWhiteboardOpen(false); setDesignOpen(false); setLoading(true);
    void window.studio.cardContextReferences(card.id).then((refs) => { if (live) { setItems(refs); setLoading(false); } })
      .catch((reason: unknown) => { if (live) { setError(messageOf(reason)); setLoading(false); } });
    return () => { live = false; };
  }, [card.id]);

  useEffect(() => {
    if (attachmentRequest?.cardId === card.id) void prepareAttachment(attachmentRequest.attachmentId);
  }, [card.id, attachmentRequest?.token]);

  async function prepareAttachment(attachmentId: string) {
    if (preparing || busy || card.archivedAt) return;
    setPreparing(true); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); setError('');
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
    setPreparing(true); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); setError('');
    try {
      const candidate = await window.studio.cardContextCandidateFromWhiteboardNode({ cardId: card.id, nodeId });
      setKind(candidate.kind); setTarget(candidate.target); setPreparedWhiteboard({ nodeId, ...candidate });
      setPrepared(`Whiteboard-${candidate.kind === 'file' ? 'Datei' : 'Ordner'} „${candidate.target}“ vorbereitet. Prüfe den Pfad und klicke „Bezug hinzufügen“.`);
      requestAnimationFrame(() => targetInput.current?.focus());
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPreparing(false); }
  }

  async function prepareDesign(selectionId: string) {
    if (preparing || busy || card.archivedAt) return;
    setPreparing(true); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); setError('');
    try {
      const candidate = await window.studio.cardContextCandidateFromDesignSelection({ cardId: card.id, selectionId });
      setKind('design'); setTarget(candidate.selectionId);
      setPreparedDesign({ selectionId: candidate.selectionId, fingerprint: candidate.fingerprint, label: candidate.label });
      setPrepared(`Design-Beleg „${candidate.label}“ aus ${candidate.sourceUrl} vorbereitet. Ergänze bei Bedarf eine Notiz und klicke „Bezug hinzufügen“. Die Seite wurde nicht geladen.`);
      requestAnimationFrame(() => noteInput.current?.focus());
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPreparing(false); }
  }

  function onDrop(event: React.DragEvent<HTMLElement>) {
    if (card.archivedAt) return;
    const design = event.dataTransfer.types.includes(DESIGN_CONTEXT_DRAG_TYPE);
    const whiteboard = event.dataTransfer.types.includes(WHITEBOARD_CONTEXT_DRAG_TYPE);
    if (!design && !whiteboard && !event.dataTransfer.types.includes(CARD_ATTACHMENT_DRAG_TYPE)) return;
    event.preventDefault(); setDragActive(false);
    if (design) {
      const selectionId = event.dataTransfer.getData(DESIGN_CONTEXT_DRAG_TYPE);
      if (selectionId) void prepareDesign(selectionId);
    } else if (whiteboard) {
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
      setItems(kind === 'design' && preparedDesign?.selectionId === target
        ? await window.studio.addCardContextReferenceFromDesignSelection({ cardId: card.id, selectionId: target, expectedFingerprint: preparedDesign.fingerprint, note: designNote })
        : preparedWhiteboard && preparedWhiteboard.kind === kind && preparedWhiteboard.target === target
        ? await window.studio.addCardContextReferenceFromWhiteboardNode({ cardId: card.id, nodeId: preparedWhiteboard.nodeId, expectedKind: preparedWhiteboard.kind, expectedTarget: target })
        : await window.studio.addCardContextReference({ cardId: card.id, kind, target }));
      setTarget(''); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); setDesignNote('');
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
    onDragOver={(event) => { if ((event.dataTransfer.types.includes(CARD_ATTACHMENT_DRAG_TYPE) || event.dataTransfer.types.includes(WHITEBOARD_CONTEXT_DRAG_TYPE) || event.dataTransfer.types.includes(DESIGN_CONTEXT_DRAG_TYPE)) && !card.archivedAt) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragActive(true); } }}
    onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }}
    onDrop={onDrop}>
    <div className="section-heading"><Link2 size={18} aria-hidden="true" /><h3>Kontextbezüge</h3></div>
    <p className="section-copy">Verknüpft Projektpfade, öffentliche Doku-Adressen oder gespeicherte Design-Belege mit dieser Karte. Dateiinhalte werden erst mit „Vorschau“ lokal gelesen; Ordnerinhalte, Webseiten und Live-Designseiten werden nicht abgerufen. Agenten erhalten diese Bezüge nicht automatisch.</p>
    {!card.archivedAt ? <details className="card-context-whiteboard" onToggle={(event) => setWhiteboardOpen(event.currentTarget.open)}><summary>Whiteboard-Dateien und Ordner auswählen</summary>
      {whiteboardOpen ? <WhiteboardContextSources projectId={card.projectId} disabled={busy || preparing} onPrepare={(id) => void prepareWhiteboard(id)} /> : null}
    </details> : null}
    {!card.archivedAt ? <details className="card-context-whiteboard" onToggle={(event) => setDesignOpen(event.currentTarget.open)}><summary>Gespeicherte Design-Belege auswählen</summary>
      {designOpen ? <DesignContextSources projectId={card.projectId} disabled={busy || preparing} onPrepare={(id) => void prepareDesign(id)} /> : null}
    </details> : null}
    {!card.archivedAt ? <form className="card-context-form" onSubmit={(event) => void add(event)}>
      <label>Quelltyp<select value={kind} disabled={busy || preparing} onChange={(event) => { setKind(event.target.value as CardContextKind); setTarget(''); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); setDesignNote(''); }}><option value="file">Projektdatei</option><option value="folder">Projektordner</option><option value="url">Öffentliche Doku-URL</option><option value="design">Gespeicherter Design-Beleg</option></select></label>
      {kind === 'design' ? <><label>Ausgewählter Beleg<input type="text" value={preparedDesign?.label ?? ''} readOnly placeholder="Oben einen gespeicherten Beleg wählen" /></label>
        <label>Auftrag für diese Karte (optional)<input ref={noteInput} type="text" value={designNote} maxLength={300} disabled={busy || preparing} onChange={(event) => setDesignNote(event.target.value)} placeholder="Was soll am Element geändert werden?" /></label></>
        : <label>{kind === 'url' ? 'HTTPS-Adresse' : 'Relativer Projektpfad'}<input ref={targetInput} type={kind === 'url' ? 'url' : 'text'} value={target} required maxLength={kind === 'url' ? 2048 : 300} disabled={busy || preparing} onChange={(event) => { setTarget(event.target.value); setPrepared(''); setPreparedWhiteboard(null); setPreparedDesign(null); }} placeholder={kind === 'file' ? 'src/components/Button.tsx' : kind === 'folder' ? 'src/components' : 'https://docs.example.org/guide'} /></label>}
      {prepared ? <p className="card-context-prepared" role="status">{prepared}</p> : null}
      <button className="secondary-button" type="submit" disabled={busy || preparing || !target.trim() || (kind === 'design' && !preparedDesign) || items.length >= 20}>Bezug hinzufügen</button>
    </form> : null}
    {loading ? <p className="section-copy" role="status">Kontextbezüge werden geladen…</p> : items.length ? <ul className="card-context-list">{items.map((item) => <li key={item.id}>
      <div className="card-context-source">{item.kind === 'file' ? <FileText size={15} aria-hidden="true" /> : item.kind === 'folder' ? <Folder size={15} aria-hidden="true" /> : item.kind === 'design' ? <MousePointer2 size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}<span>{item.kind === 'design' ? item.label ?? 'Gespeicherter Design-Beleg fehlt' : item.target}</span></div>
      <small>{referenceNote(item)}{item.kind === 'design' && item.note ? ` · Auftrag: ${item.note}` : ''}</small>
      <div className="card-context-actions"><button className="secondary-button small" type="button" disabled={busy || (item.kind !== 'url' && !item.available)} onClick={() => void show(item.id)}>Vorschau</button>
        <button className="icon-button" type="button" disabled={busy || Boolean(card.archivedAt)} aria-label={`Kontextbezug „${item.kind === 'design' ? item.label ?? 'Design-Beleg' : item.target}“ entfernen`} title="Nur Bezug entfernen" onClick={() => void remove(item.id)}><Trash2 size={15} /></button></div>
      {preview?.id === item.id ? <div className="card-context-preview"><p>{preview.note}</p>{preview.text !== null ? <pre>{preview.text}</pre> : null}{preview.truncated ? <small>Vorschau nach 4 KB gekürzt.</small> : null}</div> : null}
    </li>)}</ul> : <p className="section-copy">Noch keine Kontextbezüge an dieser Karte.</p>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
