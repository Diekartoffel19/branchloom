import { useEffect, useRef, useState } from 'react';
import type { CardQaReport } from '../../shared/types';
import './card-qa-viewport-matrix.css';

const sizes = [
  { label: 'Desktop', width: 1280, height: 800 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Mobile', width: 390, height: 844 },
] as const;

type MatrixSlot = { label: string; width: number; height: number; report: CardQaReport | null };
type LoadedSlot = MatrixSlot & { image: string | null; error: string | null };

export function qaViewportRoutes(reports: CardQaReport[]): string[] {
  const matching = reports.filter((report) => report.screenshotAvailable && sizes.some((size) =>
    report.viewportWidth === size.width && report.viewportHeight === size.height));
  return [...new Set(matching.sort((a, b) => b.endedAt.localeCompare(a.endedAt)).map((report) => report.finalUrl ?? report.requestedUrl))];
}

export function latestQaViewportSlots(reports: CardQaReport[], route: string): MatrixSlot[] {
  return sizes.map((size) => ({
    ...size,
    report: reports.filter((report) => report.screenshotAvailable
      && (report.finalUrl ?? report.requestedUrl) === route
      && report.viewportWidth === size.width && report.viewportHeight === size.height)
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id))[0] ?? null,
  }));
}

export function CardQaViewportMatrix({ cardId, reports }: { cardId: string; reports: CardQaReport[] }) {
  const routes = qaViewportRoutes(reports);
  const [routeChoice, setRouteChoice] = useState('');
  const route = routes.includes(routeChoice) ? routeChoice : routes[0] ?? '';
  const [loaded, setLoaded] = useState<LoadedSlot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const openButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    generation.current += 1;
    setLoaded(null);
    setBusy(false);
  }, [cardId, reports]);

  async function open() {
    if (busy || !route) return;
    const current = ++generation.current;
    const slots = latestQaViewportSlots(reports, route);
    setBusy(true);
    setLoaded(null);
    const results = await Promise.all(slots.map(async (slot): Promise<LoadedSlot> => {
      if (!slot.report) return { ...slot, image: null, error: null };
      try {
        return { ...slot, image: await window.studio.cardQaScreenshot({ cardId, reportId: slot.report.id }), error: null };
      } catch (reason) {
        return { ...slot, image: null, error: reason instanceof Error ? reason.message : String(reason) };
      }
    }));
    if (generation.current !== current) return;
    setLoaded(results);
    setBusy(false);
  }

  function close() {
    generation.current += 1;
    setLoaded(null);
    setBusy(false);
    openButton.current?.focus();
  }

  return <section className="card-qa-viewport-matrix" aria-label="Gespeicherte QA-Prüfgrößen">
    <h4>Prüfgrößen einer Route</h4>
    {routes.length === 0 ? <p className="section-copy">Für diese Karte liegt noch kein Screenshot mit erfasster Desktop-, Tablet- oder Mobile-Größe vor.</p> : <>
      <p className="section-copy">Die jeweils neueste gespeicherte Aufnahme pro Größe dieser Route. Die Läufe können zu verschiedenen Zeiten entstanden sein.</p>
      <label>Geladene Route<select value={route} disabled={busy} onChange={(event) => {
        generation.current += 1;
        setRouteChoice(event.target.value);
        setLoaded(null);
        setBusy(false);
      }}>{routes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button ref={openButton} className="secondary-button small" type="button" disabled={busy} onClick={() => void open()}>{busy ? 'Lädt…' : 'Gespeicherte Größen ansehen'}</button>
      {loaded ? <div className="card-qa-viewport-matrix-view" role="group" aria-label="Gespeicherte Screenshots nach Prüfgröße">
        <div className="card-qa-viewport-matrix-grid">{loaded.map((slot) => <figure key={slot.label}>
          <figcaption><strong>{slot.label}</strong><span>{slot.width} × {slot.height} px</span></figcaption>
          {slot.image && slot.report ? <>
            <img src={slot.image} alt={`Gespeicherter QA-Screenshot für ${slot.label}`} />
            <p><time dateTime={slot.report.endedAt}>{new Date(slot.report.endedAt).toLocaleString('de-DE')}</time><span>Quelle: {slot.report.finalUrl ?? slot.report.requestedUrl}</span></p>
          </> : <p className={slot.error ? 'inline-error' : 'card-qa-viewport-matrix-empty'}>{slot.error ? `Screenshot nicht ladbar: ${slot.error}` : 'Kein Screenshot dieser Größe für die Route gespeichert.'}</p>}
        </figure>)}</div>
        <p className="card-qa-viewport-matrix-limit">Gespeicherte Momentaufnahmen zur manuellen Prüfung. Keine gleichzeitige Live-Vorschau, Pixelbewertung oder automatische Layoutfreigabe.</p>
        <button className="secondary-button small" type="button" onClick={close}>Größenansicht schließen</button>
      </div> : null}
    </>}
  </section>;
}
