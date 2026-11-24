import { useEffect, useRef, useState } from 'react';
import { Check, CornerDownRight, MousePointer2, Plus, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import type { Card } from '../../shared/types';
import type { CardWireframe, WireframeArtboard, WireframeElement, WireframeElementKind, WireframeElementStyle, WireframeElementTone, WireframeVariant } from '../../shared/card-wireframe';
import { WIREFRAME_ARTBOARDS, WIREFRAME_HEIGHT, WIREFRAME_THEME_COLORS, WIREFRAME_WIDTH, wireframeColorCss } from '../../shared/card-wireframe';
import { moveWireframeLayer, resizeWireframeElement, sameWireframeContent, snapWireframePosition, wireframePreviewFontSize } from './wireframe-editing';
import { copyDesktopToArtboard } from './wireframe-artboards';
import { alignWireframeSelection, moveWireframeSelection, type WireframeAlignment } from './wireframe-selection';
import './task-wireframe.css';

interface Draft { title: string; elements: WireframeElement[]; artboards: CardWireframe['artboards'] }
interface Props { projectId: string; cards: Card[]; startCardId?: string | null; focusMode: boolean; canEnterFocus: boolean; onFocusModeChange: (focus: boolean) => void }
const unsavedDrafts = new Map<string, Draft>();
const lastSelectedCard = new Map<string, string>();
const draftKey = (projectId: string, cardId: string): string => JSON.stringify([projectId, cardId]);

const labelForKind: Record<WireframeElementKind, string> = { panel: 'Fläche', text: 'Text', button: 'Knopf', field: 'Eingabe' };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
type StyleColorKey = keyof typeof WIREFRAME_THEME_COLORS;

function StyleColorControl({ label, styleKey, item, disabled, onChange }: {
  label: string; styleKey: StyleColorKey; item: WireframeElement; disabled: boolean; onChange: (value?: string) => void;
}) {
  const [, refreshTheme] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => refreshTheme((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const value = item.style?.[styleKey];
  const cssColor = wireframeColorCss({ ...item, style: { ...item.style, [styleKey]: value ?? WIREFRAME_THEME_COLORS[styleKey] } }, styleKey)!;
  const themeHex = cssColor.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(cssColor.slice(4, -1)).trim() : cssColor;
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(themeHex) ? themeHex : '#000000';
  return <div className="task-wireframe-color-control">
    <label><input type="checkbox" checked={value !== undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked ? WIREFRAME_THEME_COLORS[styleKey] : undefined)} />{label}</label>
    <input type="color" aria-label={`${label} auswählen`} value={pickerValue} disabled={disabled || value === undefined} onChange={(event) => onChange(event.target.value)} />
    <span>{value?.startsWith('@') ? `Theme · ${pickerValue}` : value ?? 'Standard'}</span>
  </div>;
}

export function starterWireframe(card: Pick<Card, 'title'>): Draft {
  const title = card.title.slice(0, 100);
  return { title, artboards: {}, elements: [
    { id: 'window-header', kind: 'panel', x: 20, y: 20, width: 920, height: 62, text: '', tone: 'muted' },
    { id: 'window-title', kind: 'text', x: 42, y: 35, width: 620, height: 34, text: title.slice(0, 120), tone: 'plain' },
    { id: 'navigation', kind: 'panel', x: 20, y: 100, width: 204, height: 480, text: 'Navigation', tone: 'muted' },
    { id: 'content', kind: 'panel', x: 242, y: 100, width: 698, height: 480, text: 'Inhalt', tone: 'plain' },
    { id: 'section-title', kind: 'text', x: 270, y: 136, width: 480, height: 42, text: 'Übersicht', tone: 'plain' },
    { id: 'primary-action', kind: 'button', x: 744, y: 510, width: 164, height: 44, text: 'Aktion', tone: 'accent' },
  ] };
}

export function TaskWireframeEditor({ projectId, cards, startCardId = null, focusMode, canEnterFocus, onFocusModeChange }: Props) {
  const initialCardId = [startCardId, lastSelectedCard.get(projectId)].find((id) => id && cards.some((card) => card.id === id)) ?? '';
  const [cardId, setCardId] = useState(initialCardId);
  const [saved, setSaved] = useState<CardWireframe | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [artboard, setArtboard] = useState<WireframeArtboard>('desktop');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialCardId));
  const [geometryDraft, setGeometryDraft] = useState<{ id: string; key: 'x' | 'y' | 'width' | 'height'; raw: string } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [styleNumberDraft, setStyleNumberDraft] = useState<{ id: string; key: 'fontSize' | 'radius'; raw: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [, setHistoryRevision] = useState(0);
  const past = useRef<Draft[]>([]);
  const future = useRef<Draft[]>([]);
  const generation = useRef(0);
  const interactionLocked = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; ids: string[]; pointerId: number; clientX: number; clientY: number; before: Draft; origin: WireframeElement[]; recorded: boolean } | null>(null);
  const pointerSelection = useRef(false);
  const resize = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; width: number; height: number; before: Draft; recorded: boolean } | null>(null);
  const card = cards.find((item) => item.id === cardId) ?? null;
  const canvas = WIREFRAME_ARTBOARDS[artboard];
  const elements = draft ? artboard === 'desktop' ? draft.elements : draft.artboards[artboard] : undefined;
  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const selected = elements?.find((item) => item.id === selectedId) ?? null;
  const selectedElements = elements?.filter((item) => selectedIds.includes(item.id)) ?? [];
  function setSelectedId(id: string | null) { setSelectedIds(id ? [id] : []); }
  function toggleSelected(id: string) { setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }
  function selectionFor(next: Draft): WireframeElement[] { return artboard === 'desktop' ? next.elements : next.artboards[artboard] ?? []; }

  function editElements(next: WireframeElement[], record = true) {
    if (!draft) return;
    edit(artboard === 'desktop' ? { ...draft, elements: next } : { ...draft, artboards: { ...draft.artboards, [artboard]: next } }, record);
  }
  function createArtboard(target: WireframeVariant, fromDesktop: boolean) {
    if (!draft || interactionLocked.current || draft.artboards[target]) return;
    edit({ ...draft, artboards: { ...draft.artboards, [target]: fromDesktop ? copyDesktopToArtboard(draft.elements, target) : [] } });
    setSelectedId(null);
  }
  function removeArtboard(target: WireframeVariant) {
    if (!draft || interactionLocked.current || draft.artboards[target] === undefined) return;
    const next = { ...draft.artboards }; delete next[target];
    edit({ ...draft, artboards: next }); setSelectedId(null);
  }

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
    retainDraft(previous); setGeometryDraft(null); setStyleNumberDraft(null);
    setSelectedIds((ids) => ids.filter((id) => selectionFor(previous).some((item) => item.id === id)));
    setHistoryRevision((value) => value + 1);
  }
  function redo() {
    if (!draft || !future.current.length || interactionLocked.current) return;
    const next = future.current[future.current.length - 1]!;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current.slice(-49), draft];
    retainDraft(next); setGeometryDraft(null); setStyleNumberDraft(null);
    setSelectedIds((ids) => ids.filter((id) => selectionFor(next).some((item) => item.id === id)));
    setHistoryRevision((value) => value + 1);
  }

  async function load(targetCardId: string, expectedGeneration = generation.current) {
    interactionLocked.current = true;
    setLoading(true); setError(''); setNotice('');
    try {
      const current = await window.studio.cardWireframe({ projectId, cardId: targetCardId });
      if (generation.current !== expectedGeneration) return;
      const retained = unsavedDrafts.get(draftKey(projectId, targetCardId));
      setSaved(current); setDraft(retained ?? (current ? { title: current.title, elements: current.elements, artboards: current.artboards } : null));
      setSelectedId(null); setDirty(Boolean(retained)); setGeometryDraft(null); setStyleNumberDraft(null);
      resetHistory();
      if (retained) setNotice('Ungespeicherter Entwurf aus dieser App-Sitzung wiederhergestellt.');
    } catch (reason) { if (generation.current === expectedGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === expectedGeneration) { interactionLocked.current = false; setLoading(false); } }
  }

  useEffect(() => {
    const current = ++generation.current;
    interactionLocked.current = false; setBusy(false);
    setSaved(null); setDraft(null); setSelectedId(null); setArtboard('desktop'); setDirty(false); setError(''); setNotice('');
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
    if (!draft || !elements) return;
    const current = elements.find((item) => item.id === id);
    if (!current || Object.entries(change).every(([key, value]) => current[key as keyof WireframeElement] === value)) return;
    editElements(elements.map((item) => item.id === id ? { ...item, ...change } : item), record);
  }
  function setStyle(key: keyof WireframeElementStyle, value: string | number | undefined) {
    if (!selected || selected.style?.[key] === value || interactionLocked.current) return;
    const style: WireframeElementStyle = { ...selected.style, [key]: value };
    if (value === undefined) delete style[key];
    editElement(selected.id, { style: Object.keys(style).length ? style : undefined });
  }
  function setStyleNumber(item: WireframeElement, key: 'fontSize' | 'radius', raw: string) {
    if (interactionLocked.current) return;
    setStyleNumberDraft({ id: item.id, key, raw });
    if (raw === '') { setStyle(key, undefined); return; }
    if (!/^\d+$/.test(raw)) return;
    const value = Number(raw);
    if (value >= (key === 'fontSize' ? 8 : 0) && value <= 64) setStyle(key, value);
  }
  function addElement(kind: WireframeElementKind) {
    if (!draft || !elements || interactionLocked.current || elements.length >= 40) return;
    const width = kind === 'panel' ? 250 : kind === 'text' ? 250 : 168;
    const height = kind === 'panel' ? 140 : kind === 'text' ? 42 : 44;
    const offset = (elements.length % 10) * 18;
    const item: WireframeElement = {
      id: `item-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      kind, x: clamp(Math.round(canvas.width * .3) + offset, 0, canvas.width - width), y: clamp(220 + offset, 0, canvas.height - height),
      width, height, text: kind === 'panel' ? 'Bereich' : kind === 'field' ? 'Eingabe' : kind === 'button' ? 'Aktion' : 'Text', tone: 'plain',
    };
    editElements([...elements, item]); setSelectedId(item.id);
  }
  function removeElement(id: string) {
    if (!draft || !elements || interactionLocked.current) return;
    editElements(elements.filter((item) => item.id !== id)); setSelectedId(null);
  }
  function removeSelection() {
    if (!elements || !selectedIds.length || interactionLocked.current) return;
    const ids = new Set(selectedIds);
    editElements(elements.filter((item) => !ids.has(item.id)));
    setSelectedId(null);
  }
  function moveSelected(item: WireframeElement, dx: number, dy: number) {
    if (!elements) return;
    if (selectedIds.length > 1 && selectedIds.includes(item.id)) {
      const next = moveWireframeSelection(elements, selectedIds, dx, dy, canvas.width, canvas.height);
      if (next !== elements) editElements(next);
    } else editElement(item.id, { x: clamp(item.x + dx, 0, canvas.width - item.width), y: clamp(item.y + dy, 0, canvas.height - item.height) });
  }
  function alignSelection(mode: WireframeAlignment) {
    if (!elements || interactionLocked.current) return;
    const next = alignWireframeSelection(elements, selectedIds, mode);
    if (next !== elements) editElements(next);
  }
  function changeLayer(id: string, direction: -1 | 1) {
    if (!draft || !elements) return;
    const next = moveWireframeLayer(elements, id, direction);
    if (next !== elements) editElements(next);
  }
  function setGeometry(item: WireframeElement, key: 'x' | 'y' | 'width' | 'height', raw: string) {
    if (interactionLocked.current) return;
    setGeometryDraft({ id: item.id, key, raw });
    if (!/^-?\d+$/.test(raw)) return;
    const value = Number(raw);
    if (!Number.isInteger(value)) return;
    const next = { ...item, [key]: value };
    next.width = clamp(next.width, 24, canvas.width);
    next.height = clamp(next.height, 24, canvas.height);
    next.x = clamp(next.x, 0, canvas.width - next.width);
    next.y = clamp(next.y, 0, canvas.height - next.height);
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
      const result = await window.studio.saveCardWireframe({ projectId, cardId: card.id, expectedRevision: saved?.revision ?? 0, title: draft.title, elements: draft.elements, artboards: draft.artboards });
      if (unsavedDrafts.get(key) === submittedDraft) unsavedDrafts.delete(key);
      if (generation.current !== currentGeneration) return;
      setSaved(result); setDraft({ title: result.title, elements: result.elements, artboards: result.artboards }); setDirty(false);
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
      retainDraft({ title: proposal.title, elements: proposal.elements, artboards: draft?.artboards ?? {} }); setArtboard('desktop'); setSelectedId(null);
      setNotice('Agentenvorschlag geladen. Prüfe und bearbeite ihn, bevor du ihn speicherst und gesondert freigibst.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }

  return <section className={`task-wireframe${focusMode ? ' is-focused' : ''}`} aria-label="Wireframe-Entwurf">
    <div className="task-wireframe-head"><div><h2>Wireframe zur Aufgabe</h2><p>Entwirf ein App-Fenster vor dem Coding. Nur eine ausdrücklich freigegebene gespeicherte Version geht als Layoutkontext an spätere Agentenläufe.</p></div><button type="button" className="secondary-button task-wireframe-focus-toggle" aria-pressed={focusMode} disabled={!focusMode && (!card || !canEnterFocus)} title={!focusMode && !canEnterFocus ? 'Beende zuerst die laufende Design-Auswahl oder Vorschau-Aktion.' : undefined} onClick={() => onFocusModeChange(!focusMode)}>{focusMode ? 'Zur Design-Inspektion' : 'Arbeitsfläche vergrößern'}</button></div>
    <div className="task-wireframe-source">
      <label>Aufgabe<select aria-label="Aufgabe für Wireframe auswählen" value={cardId} disabled={dirty || busy} onChange={(event) => { setLoading(Boolean(event.target.value)); setSaved(null); setDraft(null); if (event.target.value) lastSelectedCard.set(projectId, event.target.value); else lastSelectedCard.delete(projectId); setCardId(event.target.value); }}><option value="">Karte auswählen</option>{cards.map((item) => <option key={item.id} value={item.id}>{item.title}{item.archivedAt ? ' · archiviert' : ''}</option>)}</select></label>
      {dirty ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (cardId) { unsavedDrafts.delete(draftKey(projectId, cardId)); void load(cardId); } }}>Änderungen verwerfen</button> : null}
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="task-wireframe-notice" role="status">{notice}</p> : null}
    {!card ? <p className="task-wireframe-empty">Wähle eine Karte. Der Entwurf bleibt lokal beim Projekt und startet keinen Agenten.</p> : loading ? <p role="status">Entwurf wird geladen…</p> : !draft ? <div className="task-wireframe-empty"><p>Für „{card.title}“ gibt es noch keinen Wireframe.</p><button type="button" className="primary-button" disabled={busy} onClick={() => edit(starterWireframe(card))}>Fenstergerüst vorbereiten</button><button type="button" className="secondary-button" disabled={busy} onClick={() => edit({ title: card.title.slice(0, 100), elements: [], artboards: {} })}>Leere Fläche beginnen</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void propose()}>{busy ? 'Agent entwirft…' : 'Mit Agent vorschlagen'}</button><small>Die Vorlage ist lokal und deterministisch. Der optionale Agentenvorschlag nutzt den gewählten Codex-Workflow-Agenten lesend und bleibt bis zum Speichern ungespeichert.</small></div> : <>
      <div className="task-wireframe-artboard-switch" role="group" aria-label="Wireframe-Zeichenfläche">{(Object.keys(WIREFRAME_ARTBOARDS) as WireframeArtboard[]).map((name) => <button key={name} type="button" className={artboard === name ? 'active' : ''} aria-pressed={artboard === name} disabled={busy} onClick={() => { drag.current = null; resize.current = null; setArtboard(name); setSelectedId(null); setGeometryDraft(null); setStyleNumberDraft(null); }}>{WIREFRAME_ARTBOARDS[name].label}<small>{WIREFRAME_ARTBOARDS[name].width} × {WIREFRAME_ARTBOARDS[name].height}{name !== 'desktop' && draft.artboards[name] === undefined ? ' · fehlt' : ''}</small></button>)}</div>
      {artboard !== 'desktop' && elements === undefined ? <div className="task-wireframe-empty task-wireframe-variant-empty"><p>Für {canvas.label} gibt es noch keinen eigenen Entwurf. Desktop bleibt unverändert.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => createArtboard(artboard, true)}>Desktop als Ausgangspunkt kopieren</button><button type="button" className="secondary-button" disabled={busy} onClick={() => createArtboard(artboard, false)}>Leere Zeichenfläche beginnen</button><small>Die Kopie passt nur Breiten an. Sie ist kein automatisch responsives Layout; prüfe die Anordnung selbst.</small></div> : null}
      <div className="task-wireframe-toolbar"><span>Element hinzufügen</span>{(['panel', 'text', 'button', 'field'] as const).map((kind) => <button key={kind} type="button" className="secondary-button small" disabled={busy || !elements || elements.length >= 40} onClick={() => addElement(kind)}><Plus size={14} aria-hidden="true" />{labelForKind[kind]}</button>)}<div className="task-wireframe-history" role="group" aria-label="Bearbeitungsschritte"><button type="button" className="secondary-button small" disabled={busy || !past.current.length} onClick={undo} title="Rückgängig"><Undo2 size={14} aria-hidden="true" />Rückgängig</button><button type="button" className="secondary-button small" disabled={busy || !future.current.length} onClick={redo} title="Wiederholen"><Redo2 size={14} aria-hidden="true" />Wiederholen</button></div><button type="button" className="secondary-button small task-wireframe-propose" disabled={busy || dirty} onClick={() => void propose()}>{busy ? 'Agent entwirft…' : 'Mit Agent neu vorschlagen'}</button></div>
      {elements ? <div className="task-wireframe-layout">
        <aside className="task-wireframe-layers" aria-label="Ebenen" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(elements.map((item) => item.id)); } else if (event.key === 'Escape') { event.preventDefault(); setSelectedId(null); } else if (event.key === 'Delete' && selectedIds.length) { event.preventDefault(); removeSelection(); } }}><h3>Ebenen</h3><p className="task-wireframe-selection-hint">Umschalt oder Strg: mehrere wählen</p>{elements.length ? <ol>{elements.map((item) => <li key={item.id}><button type="button" disabled={busy} className={selectedIds.includes(item.id) ? 'selected' : ''} aria-pressed={selectedIds.includes(item.id)} onClick={(event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) toggleSelected(item.id); else setSelectedId(item.id); }}>{labelForKind[item.kind]} · {item.text || 'Ohne Text'}</button></li>)}</ol> : <p>Noch keine Elemente.</p>}</aside>
        <div className="task-wireframe-canvas-wrap" data-artboard={artboard}>
          <div className="task-wireframe-canvas-head"><span>{canvas.width} × {canvas.height} · {canvas.label}</span><div className="task-wireframe-view-controls" role="group" aria-label="Zeichenflächenansicht"><button type="button" className="secondary-button small" aria-label="Ansicht verkleinern" disabled={zoom <= 50} onClick={() => setZoom((value) => value - 25)}>−</button><output aria-label="Zoomstufe">{zoom} %</output><button type="button" className="secondary-button small" aria-label="Ansicht vergrößern" disabled={zoom >= 150} onClick={() => setZoom((value) => value + 25)}>+</button><button type="button" className="secondary-button small" aria-pressed={snapToGrid} onClick={() => setSnapToGrid((value) => !value)}>8 px Raster</button></div></div>
          <div className="task-wireframe-canvas-viewport" role="region" tabIndex={0} aria-label="Verschiebbare Zeichenflächenansicht"><div className="task-wireframe-canvas-scale" style={{ width: `${zoom}%`, aspectRatio: `${canvas.width} / ${canvas.height}` }}><div className={`task-wireframe-canvas${snapToGrid ? ' has-grid' : ''}`} style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, width: `${10000 / zoom}%`, transform: `scale(${zoom / 100})`, backgroundSize: snapToGrid ? `${800 / canvas.width}% ${800 / canvas.height}%` : undefined }} ref={stage} role="group" aria-label={`Editierbares ${canvas.label}-Wireframe`} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(elements.map((item) => item.id)); } else if (event.key === 'Escape') { event.preventDefault(); setSelectedId(null); } }}>
          {elements.map((item) => <button key={item.id} type="button" disabled={busy} className={`task-wireframe-element kind-${item.kind} tone-${item.tone}${selectedIds.includes(item.id) ? ' selected' : ''}`} style={{ left: `${item.x / canvas.width * 100}%`, top: `${item.y / canvas.height * 100}%`, width: `${item.width / canvas.width * 100}%`, height: `${item.height / canvas.height * 100}%`, backgroundColor: wireframeColorCss(item, 'fill'), borderColor: wireframeColorCss(item, 'stroke'), color: wireframeColorCss(item, 'textColor'), borderRadius: item.style?.radius, fontSize: wireframePreviewFontSize(item.style?.fontSize, canvas.width), fontWeight: item.style?.fontWeight }} aria-label={`${labelForKind[item.kind]}: ${item.text || 'ohne Text'}`} aria-pressed={selectedIds.includes(item.id)}
            onFocus={() => { if (!interactionLocked.current && !pointerSelection.current) setSelectedId(item.id); }}
            onPointerDown={(event) => { if (interactionLocked.current || event.button !== 0) return; if (event.shiftKey || event.ctrlKey || event.metaKey) { event.preventDefault(); toggleSelected(item.id); return; } pointerSelection.current = true; const ids = selectedIds.includes(item.id) ? selectedIds : [item.id]; if (ids !== selectedIds) setSelectedIds(ids); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, ids, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, before: draft, origin: elements, recorded: false }; }}
            onPointerMove={(event) => { const current = drag.current; const rect = stage.current?.getBoundingClientRect(); if (!current || current.id !== item.id || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return; const rawDx = (event.clientX - current.clientX) * canvas.width / rect.width; const rawDy = (event.clientY - current.clientY) * canvas.height / rect.height; const origin = current.origin.find((candidate) => candidate.id === item.id)!; const dx = snapToGrid ? snapWireframePosition(origin.x + rawDx, origin.width, canvas.width) - origin.x : rawDx; const dy = snapToGrid ? snapWireframePosition(origin.y + rawDy, origin.height, canvas.height) - origin.y : rawDy; const next = moveWireframeSelection(current.origin, current.ids, dx, dy, canvas.width, canvas.height); if (next.some((candidate, index) => candidate.x !== elements[index]!.x || candidate.y !== elements[index]!.y)) { if (!current.recorded) { recordHistory(current.before); current.recorded = true; } editElements(next, false); } }}
            onPointerUp={(event) => { pointerSelection.current = false; if (drag.current?.pointerId === event.pointerId) drag.current = null; }} onPointerCancel={() => { pointerSelection.current = false; drag.current = null; }}
            onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelected(item, -step, 0); } else if (event.key === 'ArrowRight') { event.preventDefault(); moveSelected(item, step, 0); } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelected(item, 0, -step); } else if (event.key === 'ArrowDown') { event.preventDefault(); moveSelected(item, 0, step); } else if (event.key === 'Delete') { event.preventDefault(); selectedIds.includes(item.id) ? removeSelection() : removeElement(item.id); } }}>
            {item.kind === 'field' ? <span>{item.text || 'Eingabe'}</span> : item.text}
          </button>)}
          {selected ? <button type="button" className="task-wireframe-resize" disabled={busy} style={{ left: `clamp(16px, ${(selected.x + selected.width) / canvas.width * 100}%, calc(100% - 16px))`, top: `clamp(16px, ${(selected.y + selected.height) / canvas.height * 100}%, calc(100% - 16px))` }} aria-label={`Größe ändern: ${labelForKind[selected.kind]} ${selected.text || 'ohne Text'}. Pfeil rechts oder links ändert Breite, Pfeil unten oder oben Höhe; Umschalt für zehn Pixel.`} title="Größe ziehen · Pfeiltasten ändern um 1 px, Umschalt um 10 px"
            onPointerDown={(event) => { if (interactionLocked.current || event.button !== 0 || !draft) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { id: selected.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, width: selected.width, height: selected.height, before: draft, recorded: false }; }}
            onPointerMove={(event) => { const current = resize.current; const rect = stage.current?.getBoundingClientRect(); if (!current || current.id !== selected.id || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return; const next = resizeWireframeElement({ ...selected, width: current.width, height: current.height }, (event.clientX - current.clientX) * canvas.width / rect.width, (event.clientY - current.clientY) * canvas.height / rect.height, canvas.width, canvas.height); if (next.width !== selected.width || next.height !== selected.height) { if (!current.recorded) { recordHistory(current.before); current.recorded = true; } editElement(selected.id, { width: next.width, height: next.height }, false); } }}
            onPointerUp={(event) => { if (resize.current?.pointerId === event.pointerId) resize.current = null; }} onPointerCancel={() => { resize.current = null; }}
            onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; const change: [number, number] | null = event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowDown' ? [0, step] : event.key === 'ArrowUp' ? [0, -step] : null; if (!change) return; event.preventDefault(); event.stopPropagation(); const next = resizeWireframeElement(selected, change[0], change[1], canvas.width, canvas.height); editElement(selected.id, { width: next.width, height: next.height }); }}><CornerDownRight size={12} aria-hidden="true" /></button> : null}
        </div></div></div><p className="task-wireframe-canvas-hint"><MousePointer2 size={13} aria-hidden="true" /> Ziehen oder Pfeiltasten · Ecke für Größe · Raster wirkt beim Ziehen</p></div>
        <aside className="task-wireframe-properties" aria-label="Eigenschaften"><h3>Eigenschaften</h3><label>Entwurfstitel<input value={draft.title} disabled={busy} maxLength={100} onChange={(event) => edit({ ...draft, title: event.target.value })} /></label>{selectedElements.length > 1 ? <div className="task-wireframe-multi" role="group" aria-label="Mehrfachauswahl ausrichten"><strong>{selectedElements.length} Elemente ausgewählt</strong><div className="task-wireframe-align-grid">{([
          ['left', 'Links'], ['center-x', 'Mitte X'], ['right', 'Rechts'], ['top', 'Oben'], ['center-y', 'Mitte Y'], ['bottom', 'Unten'],
        ] as const).map(([mode, label]) => <button key={mode} type="button" className="secondary-button small" disabled={busy} onClick={() => alignSelection(mode)}>{label}</button>)}</div><div className="task-wireframe-distribute"><button type="button" className="secondary-button small" disabled={busy || selectedElements.length < 3} onClick={() => alignSelection('distribute-x')}>Horizontal verteilen</button><button type="button" className="secondary-button small" disabled={busy || selectedElements.length < 3} onClick={() => alignSelection('distribute-y')}>Vertikal verteilen</button></div><button type="button" className="secondary-button small" disabled={busy} onClick={removeSelection}>Auswahl entfernen</button></div> : selected ? <>
          <div className="task-wireframe-property-kind">{labelForKind[selected.kind]}</div>
          <label>Text<input aria-label="Text des ausgewählten Elements" value={selected.text} disabled={busy} maxLength={120} onChange={(event) => editElement(selected.id, { text: event.target.value })} /></label>
          <div className="task-wireframe-geometry">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'width' ? 'Breite' : key === 'height' ? 'Höhe' : key.toUpperCase()}<input type="number" min={key === 'width' || key === 'height' ? 24 : 0} max={key === 'width' || key === 'x' ? canvas.width : canvas.height} disabled={busy} value={geometryDraft?.id === selected.id && geometryDraft.key === key ? geometryDraft.raw : selected[key]} onChange={(event) => setGeometry(selected, key, event.target.value)} onBlur={() => setGeometryDraft(null)} /></label>)}</div>
          <label>Ton<select value={selected.tone} disabled={busy} onChange={(event) => editElement(selected.id, { tone: event.target.value as WireframeElementTone })}><option value="plain">Neutral</option><option value="muted">Zurückhaltend</option><option value="accent">Akzent</option></select></label>
          <fieldset className="task-wireframe-style"><legend>Gestaltung</legend>
            <div className="task-wireframe-style-pair"><label>Schriftgröße<input aria-label="Schriftgröße in Pixel" type="number" min={8} max={64} step={1} placeholder="Standard" value={styleNumberDraft?.id === selected.id && styleNumberDraft.key === 'fontSize' ? styleNumberDraft.raw : selected.style?.fontSize ?? ''} disabled={busy} onChange={(event) => setStyleNumber(selected, 'fontSize', event.target.value)} onBlur={() => setStyleNumberDraft(null)} /></label><label>Schriftstärke<select aria-label="Schriftstärke" value={selected.style?.fontWeight ?? ''} disabled={busy} onChange={(event) => setStyle('fontWeight', event.target.value ? Number(event.target.value) : undefined)}><option value="">Standard</option><option value="400">Normal</option><option value="500">Mittel</option><option value="600">Halbfett</option><option value="700">Fett</option></select></label></div>
            <StyleColorControl label="Textfarbe" styleKey="textColor" item={selected} disabled={busy} onChange={(value) => setStyle('textColor', value)} />
            <StyleColorControl label="Füllung" styleKey="fill" item={selected} disabled={busy} onChange={(value) => setStyle('fill', value)} />
            <StyleColorControl label="Kontur" styleKey="stroke" item={selected} disabled={busy} onChange={(value) => setStyle('stroke', value)} />
            <label>Eckenradius<input aria-label="Eckenradius in Pixel" type="number" min={0} max={64} step={1} placeholder="Standard" value={styleNumberDraft?.id === selected.id && styleNumberDraft.key === 'radius' ? styleNumberDraft.raw : selected.style?.radius ?? ''} disabled={busy} onChange={(event) => setStyleNumber(selected, 'radius', event.target.value)} onBlur={() => setStyleNumberDraft(null)} /></label>
          </fieldset>
          <div className="task-wireframe-layer-order" role="group" aria-label="Ebenenreihenfolge"><button type="button" className="secondary-button small" disabled={busy || elements[0]?.id === selected.id} onClick={() => changeLayer(selected.id, -1)}>Eine Ebene zurück</button><button type="button" className="secondary-button small" disabled={busy || elements[elements.length - 1]?.id === selected.id} onClick={() => changeLayer(selected.id, 1)}>Eine Ebene vor</button></div>
          <button type="button" className="secondary-button small" disabled={busy} onClick={() => removeElement(selected.id)}>Element entfernen</button>
        </> : <p>Wähle ein Element auf der Fläche oder in der Ebenenliste.</p>}</aside>
      </div> : null}
      {artboard !== 'desktop' && elements ? <div className="task-wireframe-variant-tools"><span>Eigener {canvas.label}-Entwurf</span><button type="button" className="secondary-button small" disabled={busy} onClick={() => removeArtboard(artboard)}>Zeichenfläche entfernen</button></div> : null}
      <div className="task-wireframe-actions"><span>{saved ? `Version ${saved.revision}${saved.approvedRevision === saved.revision ? ' · freigegeben' : ' · nicht freigegeben'}` : 'Noch nicht gespeichert'}{dirty ? ' · geändert' : ''}</span><button type="button" className="secondary-button" disabled={!dirty || busy || !draft.title.trim()} onClick={() => void save()}>{busy && dirty ? 'Speichere…' : 'Entwurf speichern'}</button><button type="button" className="primary-button" disabled={!saved || dirty || busy || !(saved.elements.length || Object.values(saved.artboards).some((items) => items.length)) || saved.approvedRevision === saved.revision} onClick={() => void approve()}><Check size={15} aria-hidden="true" />Für Agenten freigeben</button>{saved && !dirty ? <button type="button" className="icon-button" disabled={busy} title="Gespeicherten Entwurf neu laden" aria-label="Gespeicherten Entwurf neu laden" onClick={() => void load(card.id)}><RotateCcw size={15} /></button> : null}</div>
      <p className="task-wireframe-help">Die Freigabe teilt nur die gespeicherte Anordnung beim nächsten Agentenstart. Kein Projektcode wird geändert. Nach einer Bearbeitung musst du erneut speichern und freigeben.</p>
    </>}
  </section>;
}
