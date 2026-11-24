import { useEffect, useRef, useState } from 'react';
import { Check, CornerDownRight, MousePointer2, Plus, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import type { Card } from '../../shared/types';
import type { CardWireframe, WireframeElement, WireframeElementKind, WireframeElementTone } from '../../shared/card-wireframe';
import { WIREFRAME_HEIGHT, WIREFRAME_WIDTH } from '../../shared/card-wireframe';
import { moveWireframeLayer, resizeWireframeElement, sameWireframeContent } from './wireframe-editing';
import './task-wireframe.css';

interface Draft { title: string; elements: WireframeElement[] }
interface Props { projectId: string; cards: Card[]; startCardId?: string | null }
const unsavedDrafts = new Map<string, Draft>();
const lastSelectedCard = new Map<string, string>();
const draftKey = (projectId: string, cardId: string): string => JSON.stringify([projectId, cardId]);

const labelForKind: Record<WireframeElementKind, string> = { panel: 'Fläche', text: 'Text', button: 'Knopf', field: 'Eingabe' };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function starterWireframe(card: Pick<Card, 'title'>): Draft {
  const title = card.title.slice(0, 100);
  return { title, elements: [
    { id: 'window-header', kind: 'panel', x: 20, y: 20, width: 920, height: 62, text: '', tone: 'muted' },
    { id: 'window-title', kind: 'text', x: 42, y: 35, width: 620, height: 34, text: title.slice(0, 120), tone: 'plain' },
    { id: 'navigation', kind: 'panel', x: 20, y: 100, width: 204, height: 480, text: 'Navigation', tone: 'muted' },
    { id: 'content', kind: 'panel', x: 242, y: 100, width: 698, height: 480, text: 'Inhalt', tone: 'plain' },
    { id: 'section-title', kind: 'text', x: 270, y: 136, width: 480, height: 42, text: 'Übersicht', tone: 'plain' },
    { id: 'primary-action', kind: 'button', x: 744, y: 510, width: 164, height: 44, text: 'Aktion', tone: 'accent' },
  ] };
}

export function TaskWireframeEditor({ projectId, cards, startCardId = null }: Props) {
  const initialCardId = [startCardId, lastSelectedCard.get(projectId)].find((id) => id && cards.some((card) => card.id === id)) ?? '';
  const [cardId, setCardId] = useState(initialCardId);
  const [saved, setSaved] = useState<CardWireframe | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialCardId));
  const [geometryDraft, setGeometryDraft] = useState<{ id: string; key: 'x' | 'y' | 'width' | 'height'; raw: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [, setHistoryRevision] = useState(0);
  const past = useRef<Draft[]>([]);
  const future = useRef<Draft[]>([]);
  const generation = useRef(0);
  const interactionLocked = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; x: number; y: number; before: Draft; recorded: boolean } | null>(null);
  const resize = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; width: number; height: number; before: Draft; recorded: boolean } | null>(null);
  const card = cards.find((item) => item.id === cardId) ?? null;
  const selected = draft?.elements.find((item) => item.id === selectedId) ?? null;

  function resetHistory() { past.current = []; future.current = []; setHistoryRevision((value) => value + 1); }
  function recordHistory(before: Draft) {
    past.current = [...past.current.slice(-49), before];
    future.current = [];
    setHistoryRevision((value) => value + 1);
  }
  function undo() {
    if (!draft || !past.current.length || interactionLocked.current) return;
    const previous = past.current[past.current.length - 1]!;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current.slice(-49), draft];
    retainDraft(previous); setGeometryDraft(null);
    if (!previous.elements.some((item) => item.id === selectedId)) setSelectedId(null);
    setHistoryRevision((value) => value + 1);
  }
  function redo() {
    if (!draft || !future.current.length || interactionLocked.current) return;
    const next = future.current[future.current.length - 1]!;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current.slice(-49), draft];
    retainDraft(next); setGeometryDraft(null);
    if (!next.elements.some((item) => item.id === selectedId)) setSelectedId(null);
    setHistoryRevision((value) => value + 1);
  }

  async function load(targetCardId: string, expectedGeneration = generation.current) {
    interactionLocked.current = true;
    setLoading(true); setError(''); setNotice('');
    try {
      const current = await window.studio.cardWireframe({ projectId, cardId: targetCardId });
      if (generation.current !== expectedGeneration) return;
      const retained = unsavedDrafts.get(draftKey(projectId, targetCardId));
      setSaved(current); setDraft(retained ?? (current ? { title: current.title, elements: current.elements } : null));
      setSelectedId(null); setDirty(Boolean(retained)); setGeometryDraft(null);
      resetHistory();
      if (retained) setNotice('Ungespeicherter Entwurf aus dieser App-Sitzung wiederhergestellt.');
    } catch (reason) { if (generation.current === expectedGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === expectedGeneration) { interactionLocked.current = false; setLoading(false); } }
  }

  useEffect(() => {
    const current = ++generation.current;
    interactionLocked.current = false; setBusy(false);
    setSaved(null); setDraft(null); setSelectedId(null); setDirty(false); setError(''); setNotice('');
    resetHistory();
    if (cardId && cards.some((item) => item.id === cardId)) { lastSelectedCard.set(projectId, cardId); void load(cardId, current); }
    else { if (cardId) setCardId(lastSelectedCard.get(projectId) && cards.some((item) => item.id === lastSelectedCard.get(projectId)) ? lastSelectedCard.get(projectId)! : ''); setLoading(false); }
    return () => { generation.current++; };
  }, [projectId, cardId]);

  function retainDraft(next: Draft) {
    const unchanged = sameWireframeContent(next, saved);
    if (cardId) {
      const key = draftKey(projectId, cardId);
      if (unchanged) unsavedDrafts.delete(key);
      else unsavedDrafts.set(key, next);
    }
    setDraft(next); setDirty(!unchanged);
    setNotice(unchanged ? 'Gespeicherten Stand wiederhergestellt.' : 'Ungespeicherte Änderungen.'); setError('');
  }
  function edit(next: Draft, record = true) { if (!interactionLocked.current) { if (draft && record) recordHistory(draft); retainDraft(next); } }
  function editElement(id: string, change: Partial<WireframeElement>, record = true) {
    if (!draft) return;
    const current = draft.elements.find((item) => item.id === id);
    if (!current || Object.entries(change).every(([key, value]) => current[key as keyof WireframeElement] === value)) return;
    edit({ ...draft, elements: draft.elements.map((item) => item.id === id ? { ...item, ...change } : item) }, record);
  }
  function addElement(kind: WireframeElementKind) {
    if (!draft || interactionLocked.current || draft.elements.length >= 40) return;
    const width = kind === 'panel' ? 250 : kind === 'text' ? 250 : 168;
    const height = kind === 'panel' ? 140 : kind === 'text' ? 42 : 44;
    const offset = (draft.elements.length % 10) * 18;
    const item: WireframeElement = {
      id: `item-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      kind, x: clamp(290 + offset, 0, WIREFRAME_WIDTH - width), y: clamp(220 + offset, 0, WIREFRAME_HEIGHT - height),
      width, height, text: kind === 'panel' ? 'Bereich' : kind === 'field' ? 'Eingabe' : kind === 'button' ? 'Aktion' : 'Text', tone: 'plain',
    };
    edit({ ...draft, elements: [...draft.elements, item] }); setSelectedId(item.id);
  }
  function removeElement(id: string) {
    if (!draft || interactionLocked.current) return;
    edit({ ...draft, elements: draft.elements.filter((item) => item.id !== id) }); setSelectedId(null);
  }
  function moveSelected(item: WireframeElement, dx: number, dy: number) {
    editElement(item.id, { x: clamp(item.x + dx, 0, WIREFRAME_WIDTH - item.width), y: clamp(item.y + dy, 0, WIREFRAME_HEIGHT - item.height) });
  }
  function changeLayer(id: string, direction: -1 | 1) {
    if (!draft) return;
    const elements = moveWireframeLayer(draft.elements, id, direction);
    if (elements !== draft.elements) edit({ ...draft, elements });
  }
  function setGeometry(item: WireframeElement, key: 'x' | 'y' | 'width' | 'height', raw: string) {
    if (interactionLocked.current) return;
    setGeometryDraft({ id: item.id, key, raw });
    if (!/^-?\d+$/.test(raw)) return;
    const value = Number(raw);
    if (!Number.isInteger(value)) return;
    const next = { ...item, [key]: value };
    next.width = clamp(next.width, 24, WIREFRAME_WIDTH);
    next.height = clamp(next.height, 24, WIREFRAME_HEIGHT);
    next.x = clamp(next.x, 0, WIREFRAME_WIDTH - next.width);
    next.y = clamp(next.y, 0, WIREFRAME_HEIGHT - next.height);
    editElement(item.id, next);
  }

  async function save() {
    if (!card || !draft || busy || interactionLocked.current || !dirty) return;
    const currentGeneration = generation.current;
    const submittedDraft = draft;
    const key = draftKey(projectId, card.id);
    interactionLocked.current = true;
    setBusy(true); setError('');
    try {
      const result = await window.studio.saveCardWireframe({ projectId, cardId: card.id, expectedRevision: saved?.revision ?? 0, title: draft.title, elements: draft.elements });
      if (unsavedDrafts.get(key) === submittedDraft) unsavedDrafts.delete(key);
      if (generation.current !== currentGeneration) return;
      setSaved(result); setDraft({ title: result.title, elements: result.elements }); setDirty(false);
      setNotice(result.approvedRevision === result.revision ? 'Entwurf unverändert; Freigabe bleibt bestehen.' : 'Entwurf gespeichert. Für Agentenläufe ist eine eigene Freigabe nötig.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }
  async function approve() {
    if (!card || !saved || dirty || busy || interactionLocked.current) return;
    const currentGeneration = generation.current;
    interactionLocked.current = true;
    setBusy(true); setError('');
    try {
      const result = await window.studio.approveCardWireframe({ projectId, cardId: card.id, expectedRevision: saved.revision });
      if (generation.current !== currentGeneration) return;
      setSaved(result); setNotice('Version ' + result.revision + ' ist als Layoutkontext für künftige Agentenläufe freigegeben. Es wurde kein Agent gestartet.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }
  async function propose() {
    if (!card || dirty || busy || interactionLocked.current) return;
    const currentGeneration = generation.current;
    interactionLocked.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const proposal = await window.studio.proposeCardWireframe({ projectId, cardId: card.id });
      if (generation.current !== currentGeneration) return;
      if (draft) recordHistory(draft);
      retainDraft({ title: proposal.title, elements: proposal.elements }); setSelectedId(null);
      setNotice('Agentenvorschlag geladen. Prüfe und bearbeite ihn, bevor du ihn speicherst und gesondert freigibst.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }

  return <section className="task-wireframe" aria-label="Wireframe-Entwurf">
    <div className="task-wireframe-head"><div><h2>Wireframe zur Aufgabe</h2><p>Entwirf ein App-Fenster vor dem Coding. Nur eine ausdrücklich freigegebene gespeicherte Version geht als Layoutkontext an spätere Agentenläufe.</p></div></div>
    <div className="task-wireframe-source">
      <label>Aufgabe<select aria-label="Aufgabe für Wireframe auswählen" value={cardId} disabled={dirty || busy} onChange={(event) => { setLoading(Boolean(event.target.value)); setSaved(null); setDraft(null); if (event.target.value) lastSelectedCard.set(projectId, event.target.value); else lastSelectedCard.delete(projectId); setCardId(event.target.value); }}><option value="">Karte auswählen</option>{cards.map((item) => <option key={item.id} value={item.id}>{item.title}{item.archivedAt ? ' · archiviert' : ''}</option>)}</select></label>
      {dirty ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (cardId) { unsavedDrafts.delete(draftKey(projectId, cardId)); void load(cardId); } }}>Änderungen verwerfen</button> : null}
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="task-wireframe-notice" role="status">{notice}</p> : null}
    {!card ? <p className="task-wireframe-empty">Wähle eine Karte. Der Entwurf bleibt lokal beim Projekt und startet keinen Agenten.</p> : loading ? <p role="status">Entwurf wird geladen…</p> : !draft ? <div className="task-wireframe-empty"><p>Für „{card.title}“ gibt es noch keinen Wireframe.</p><button type="button" className="primary-button" disabled={busy} onClick={() => edit(starterWireframe(card))}>Fenstergerüst vorbereiten</button><button type="button" className="secondary-button" disabled={busy} onClick={() => edit({ title: card.title.slice(0, 100), elements: [] })}>Leere Fläche beginnen</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void propose()}>{busy ? 'Agent entwirft…' : 'Mit Agent vorschlagen'}</button><small>Die Vorlage ist lokal und deterministisch. Der optionale Agentenvorschlag nutzt den gewählten Codex-Workflow-Agenten lesend und bleibt bis zum Speichern ungespeichert.</small></div> : <>
      <div className="task-wireframe-toolbar"><span>Element hinzufügen</span>{(['panel', 'text', 'button', 'field'] as const).map((kind) => <button key={kind} type="button" className="secondary-button small" disabled={busy || draft.elements.length >= 40} onClick={() => addElement(kind)}><Plus size={14} aria-hidden="true" />{labelForKind[kind]}</button>)}<div className="task-wireframe-history" role="group" aria-label="Bearbeitungsschritte"><button type="button" className="secondary-button small" disabled={busy || !past.current.length} onClick={undo} title="Rückgängig"><Undo2 size={14} aria-hidden="true" />Rückgängig</button><button type="button" className="secondary-button small" disabled={busy || !future.current.length} onClick={redo} title="Wiederholen"><Redo2 size={14} aria-hidden="true" />Wiederholen</button></div><button type="button" className="secondary-button small task-wireframe-propose" disabled={busy || dirty} onClick={() => void propose()}>{busy ? 'Agent entwirft…' : 'Mit Agent neu vorschlagen'}</button></div>
      <div className="task-wireframe-layout">
        <aside className="task-wireframe-layers" aria-label="Ebenen"><h3>Ebenen</h3>{draft.elements.length ? <ol>{draft.elements.map((item) => <li key={item.id}><button type="button" disabled={busy} className={selectedId === item.id ? 'selected' : ''} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>{labelForKind[item.kind]} · {item.text || 'Ohne Text'}</button></li>)}</ol> : <p>Noch keine Elemente.</p>}</aside>
        <div className="task-wireframe-canvas-wrap"><div className="task-wireframe-canvas-head"><span>{WIREFRAME_WIDTH} × {WIREFRAME_HEIGHT} · App-Fenster</span><span><MousePointer2 size={13} aria-hidden="true" /> Ziehen oder Pfeiltasten · Ecke für Größe</span></div><div className="task-wireframe-canvas" ref={stage} role="group" aria-label="Editierbares App-Wireframe">
          {draft.elements.map((item) => <button key={item.id} type="button" disabled={busy} className={`task-wireframe-element kind-${item.kind} tone-${item.tone}${selectedId === item.id ? ' selected' : ''}`} style={{ left: `${item.x / WIREFRAME_WIDTH * 100}%`, top: `${item.y / WIREFRAME_HEIGHT * 100}%`, width: `${item.width / WIREFRAME_WIDTH * 100}%`, height: `${item.height / WIREFRAME_HEIGHT * 100}%` }} aria-label={`${labelForKind[item.kind]}: ${item.text || 'ohne Text'}`} aria-pressed={selectedId === item.id}
            onFocus={() => { if (!interactionLocked.current) setSelectedId(item.id); }}
            onPointerDown={(event) => { if (interactionLocked.current || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y, before: draft, recorded: false }; setSelectedId(item.id); }}
            onPointerMove={(event) => { const current = drag.current; const rect = stage.current?.getBoundingClientRect(); if (!current || current.id !== item.id || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return; const x = clamp(Math.round(current.x + (event.clientX - current.clientX) * WIREFRAME_WIDTH / rect.width), 0, WIREFRAME_WIDTH - item.width); const y = clamp(Math.round(current.y + (event.clientY - current.clientY) * WIREFRAME_HEIGHT / rect.height), 0, WIREFRAME_HEIGHT - item.height); if (x !== item.x || y !== item.y) { if (!current.recorded) { recordHistory(current.before); current.recorded = true; } editElement(item.id, { x, y }, false); } }}
            onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelected(item, -step, 0); } else if (event.key === 'ArrowRight') { event.preventDefault(); moveSelected(item, step, 0); } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelected(item, 0, -step); } else if (event.key === 'ArrowDown') { event.preventDefault(); moveSelected(item, 0, step); } else if (event.key === 'Delete') { event.preventDefault(); removeElement(item.id); } }}>
            {item.kind === 'field' ? <span>{item.text || 'Eingabe'}</span> : item.text}
          </button>)}
          {selected ? <button type="button" className="task-wireframe-resize" disabled={busy} style={{ left: `clamp(16px, ${(selected.x + selected.width) / WIREFRAME_WIDTH * 100}%, calc(100% - 16px))`, top: `clamp(16px, ${(selected.y + selected.height) / WIREFRAME_HEIGHT * 100}%, calc(100% - 16px))` }} aria-label={`Größe ändern: ${labelForKind[selected.kind]} ${selected.text || 'ohne Text'}. Pfeil rechts oder links ändert Breite, Pfeil unten oder oben Höhe; Umschalt für zehn Pixel.`} title="Größe ziehen · Pfeiltasten ändern um 1 px, Umschalt um 10 px"
            onPointerDown={(event) => { if (interactionLocked.current || event.button !== 0 || !draft) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { id: selected.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, width: selected.width, height: selected.height, before: draft, recorded: false }; }}
            onPointerMove={(event) => { const current = resize.current; const rect = stage.current?.getBoundingClientRect(); if (!current || current.id !== selected.id || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return; const next = resizeWireframeElement({ ...selected, width: current.width, height: current.height }, (event.clientX - current.clientX) * WIREFRAME_WIDTH / rect.width, (event.clientY - current.clientY) * WIREFRAME_HEIGHT / rect.height); if (next.width !== selected.width || next.height !== selected.height) { if (!current.recorded) { recordHistory(current.before); current.recorded = true; } editElement(selected.id, { width: next.width, height: next.height }, false); } }}
            onPointerUp={(event) => { if (resize.current?.pointerId === event.pointerId) resize.current = null; }} onPointerCancel={() => { resize.current = null; }}
            onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; const change: [number, number] | null = event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowDown' ? [0, step] : event.key === 'ArrowUp' ? [0, -step] : null; if (!change) return; event.preventDefault(); event.stopPropagation(); const next = resizeWireframeElement(selected, change[0], change[1]); editElement(selected.id, { width: next.width, height: next.height }); }}><CornerDownRight size={12} aria-hidden="true" /></button> : null}
        </div></div>
        <aside className="task-wireframe-properties" aria-label="Eigenschaften"><h3>Eigenschaften</h3><label>Entwurfstitel<input value={draft.title} disabled={busy} maxLength={100} onChange={(event) => edit({ ...draft, title: event.target.value })} /></label>{selected ? <>
          <div className="task-wireframe-property-kind">{labelForKind[selected.kind]}</div>
          <label>Text<input aria-label="Text des ausgewählten Elements" value={selected.text} disabled={busy} maxLength={120} onChange={(event) => editElement(selected.id, { text: event.target.value })} /></label>
          <div className="task-wireframe-geometry">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'width' ? 'Breite' : key === 'height' ? 'Höhe' : key.toUpperCase()}<input type="number" min={key === 'width' || key === 'height' ? 24 : 0} max={key === 'width' || key === 'x' ? WIREFRAME_WIDTH : WIREFRAME_HEIGHT} disabled={busy} value={geometryDraft?.id === selected.id && geometryDraft.key === key ? geometryDraft.raw : selected[key]} onChange={(event) => setGeometry(selected, key, event.target.value)} onBlur={() => setGeometryDraft(null)} /></label>)}</div>
          <label>Ton<select value={selected.tone} disabled={busy} onChange={(event) => editElement(selected.id, { tone: event.target.value as WireframeElementTone })}><option value="plain">Neutral</option><option value="muted">Zurückhaltend</option><option value="accent">Akzent</option></select></label>
          <div className="task-wireframe-layer-order" role="group" aria-label="Ebenenreihenfolge"><button type="button" className="secondary-button small" disabled={busy || draft.elements[0]?.id === selected.id} onClick={() => changeLayer(selected.id, -1)}>Eine Ebene zurück</button><button type="button" className="secondary-button small" disabled={busy || draft.elements[draft.elements.length - 1]?.id === selected.id} onClick={() => changeLayer(selected.id, 1)}>Eine Ebene vor</button></div>
          <button type="button" className="secondary-button small" disabled={busy} onClick={() => removeElement(selected.id)}>Element entfernen</button>
        </> : <p>Wähle ein Element auf der Fläche oder in der Ebenenliste.</p>}</aside>
      </div>
      <div className="task-wireframe-actions"><span>{saved ? `Version ${saved.revision}${saved.approvedRevision === saved.revision ? ' · freigegeben' : ' · nicht freigegeben'}` : 'Noch nicht gespeichert'}{dirty ? ' · geändert' : ''}</span><button type="button" className="secondary-button" disabled={!dirty || busy || !draft.title.trim()} onClick={() => void save()}>{busy && dirty ? 'Speichere…' : 'Entwurf speichern'}</button><button type="button" className="primary-button" disabled={!saved || dirty || busy || !saved.elements.length || saved.approvedRevision === saved.revision} onClick={() => void approve()}><Check size={15} aria-hidden="true" />Für Agenten freigeben</button>{saved && !dirty ? <button type="button" className="icon-button" disabled={busy} title="Gespeicherten Entwurf neu laden" aria-label="Gespeicherten Entwurf neu laden" onClick={() => void load(card.id)}><RotateCcw size={15} /></button> : null}</div>
      <p className="task-wireframe-help">Die Freigabe teilt nur die gespeicherte Anordnung beim nächsten Agentenstart. Kein Projektcode wird geändert. Nach einer Bearbeitung musst du erneut speichern und freigeben.</p>
    </>}
  </section>;
}
