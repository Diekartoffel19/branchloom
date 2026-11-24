import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import type { DesignInspectionState, DesignSelection } from '../../shared/design-inspection';
import { ComponentCatalogPanel } from './ComponentCatalogPanel';
import { ThemeTokensPanel } from './ThemeTokensPanel';
import './design-inspection.css';

const emptyState: DesignInspectionState = { projectId: null, sourceUrl: null, ready: false, armed: false };
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function DesignInspectionView({ projectId, active }: { projectId: string; active: boolean }) {
  const [url, setUrl] = useState('');
  const [selector, setSelector] = useState('');
  const [state, setState] = useState<DesignInspectionState>(emptyState);
  const [selections, setSelections] = useState<DesignSelection[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  const syncBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    void window.studio.designInspectionSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch((reason: unknown) => setError(messageOf(reason)));
  }, []);

  useEffect(() => {
    let mounted = true;
    setSelections([]); setState(emptyState); setError(''); setUrl(''); setSelector('');
    void window.studio.designSelections(projectId).then((items) => { if (mounted) setSelections(items); }).catch((reason: unknown) => { if (mounted) setError(messageOf(reason)); });
    const unsubscribe = window.studio.onDesignSelection((selection) => {
      if (!mounted || selection.projectId !== projectId) return;
      setSelections((items) => [selection, ...items.filter((item) => item.id !== selection.id)].slice(0, 20));
      setState((old) => ({ ...old, armed: false }));
    });
    return () => { mounted = false; unsubscribe(); void window.studio.designInspectionSetVisible(false).catch(() => undefined); };
  }, [projectId]);

  useEffect(() => {
    if (!active) { void window.studio.designInspectionSetVisible(false).then(setState).catch(() => undefined); return; }
    const element = viewport.current;
    if (!element) return;
    let scheduled = 0;
    const update = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(syncBounds); };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    void window.studio.designInspectionSetVisible(true).then(setState).catch((reason: unknown) => setError(messageOf(reason)));
    return () => { cancelAnimationFrame(scheduled); observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); void window.studio.designInspectionSetVisible(false).catch(() => undefined); };
  }, [active, syncBounds]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { setState(await window.studio.designInspectionStart({ projectId, url })); }
    catch (reason) { setState(emptyState); setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function arm() {
    setError('');
    try {
      viewport.current?.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) throw new Error('Die Vorschau ist nicht sichtbar.');
      await window.studio.designInspectionSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      setState(await window.studio.designInspectionArm(projectId));
    }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function selectBySelector(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.ready || busy) return;
    setBusy(true); setError('');
    try { await window.studio.designInspectionSelectSelector({ projectId, selector }); setState((old) => ({ ...old, armed: false })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="design-inspection" aria-label="Design-Inspektion">
    <div className="design-inspection-intro"><div><h2>Design-Inspektion</h2><p>Öffne eine laufende lokale Vorschau. Wähle anschließend genau ein Element; Branchloom speichert dessen begrenzte CSS-Belege nur in diesem Projekt.</p></div></div>
    <form className="design-inspection-toolbar" onSubmit={(event) => void start(event)}>
      <label>Lokale Vorschau-URL<input type="url" required maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:5173/" /></label>
      <button className="secondary-button" type="submit" disabled={busy || !url.trim()}>{busy ? 'Öffne…' : 'Vorschau öffnen'}</button>
      <button className="primary-button" type="button" disabled={!state.ready || busy || state.armed || !active} onClick={() => void arm()}><MousePointer2 size={15} aria-hidden="true" />{state.armed ? 'Element anklicken…' : 'Element auswählen'}</button>
    </form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <p className="design-inspection-state" role="status">{state.armed ? 'Auswahl aktiv: Klicke ein Element in der Vorschau. Der Seitenklick wird abgefangen.' : state.ready ? `Vorschau geladen: ${state.sourceUrl}` : 'Noch keine Vorschau geöffnet.'}</p>
    <details className="design-inspection-selector"><summary>Mit Tastatur oder CSS-Selektor auswählen</summary><form onSubmit={(event) => void selectBySelector(event)}><label>CSS-Selektor<input value={selector} maxLength={320} disabled={!state.ready || busy} onChange={(event) => setSelector(event.target.value)} placeholder="#header oder main button" /></label><button className="secondary-button" type="submit" disabled={!state.ready || busy || !selector.trim()}>Element prüfen</button></form></details>
    <div className="design-inspection-viewport" ref={viewport} aria-label="Lokale Design-Vorschau">{!state.ready ? <p>Die laufende Seite erscheint hier nach „Vorschau öffnen“.</p> : null}</div>
    <div className="design-inspection-evidence"><h3>Ausgewählte Elemente</h3>
      {selections.length === 0 ? <p>Für dieses Projekt ist noch kein Element gespeichert.</p> : <ol>{selections.map((item) => <li key={item.id}>
        <div className="design-inspection-item-head"><strong><code>{item.selector}</code></strong><time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString('de-DE')}</time></div>
        <p><span>Tag: <code>{item.tag}</code></span><span>Quelle: {item.sourceUrl}</span>{item.text ? <span>Text: {item.text}</span> : null}</p>
        <dl>{Object.entries(item.styles).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {item.tokens.length ? <details><summary>{item.tokens.length} CSS-Variablen am Element</summary><dl>{item.tokens.map((token) => <div key={token.name}><dt>{token.name}</dt><dd>{token.value}</dd></div>)}</dl></details> : <small>Keine berechneten CSS-Variablen erfasst.</small>}
      </li>)}</ol>}
    </div>
    <ComponentCatalogPanel projectId={projectId} />
    <ThemeTokensPanel projectId={projectId} />
    <p className="design-inspection-limit">Die Auswahl liest berechnete Werte aus einer lokalen Seite. Sie ändert keine Projektdateien und startet keinen Agenten. Die Seite führt beim Laden weiterhin eigenes JavaScript aus.</p>
  </section>;
}
