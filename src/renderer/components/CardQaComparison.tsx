import { useEffect, useRef, useState } from 'react';
import type { CardQaReport } from '../../shared/types';
import { qaGitComparisonNote, qaGitLabel } from './qa-git-label';
import './card-qa-comparison.css';

interface Comparison { left: CardQaReport; right: CardQaReport; leftImage: string; rightImage: string }
interface ImageSize { width: number; height: number }

export function overlayEligible(left: CardQaReport, right: CardQaReport, leftSize: ImageSize | null, rightSize: ImageSize | null): boolean {
  return left.viewportWidth > 0 && left.viewportHeight > 0
    && left.viewportWidth === right.viewportWidth && left.viewportHeight === right.viewportHeight
    && Boolean(leftSize && rightSize && leftSize.width > 0 && leftSize.height > 0
      && leftSize.width === rightSize.width && leftSize.height === rightSize.height);
}

function viewport(report: CardQaReport): string {
  return report.viewportWidth > 0 && report.viewportHeight > 0 ? `${report.viewportWidth} × ${report.viewportHeight} px` : 'nicht erfasst';
}

export function QaComparisonView({ comparison, onClose }: { comparison: Comparison; onClose: () => void }) {
  const [expanded, setExpanded] = useState<'A' | 'B' | null>(null);
  const [imageSizes, setImageSizes] = useState<{ A: ImageSize | null; B: ImageSize | null }>({ A: null, B: null });
  const [imageErrors, setImageErrors] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [split, setSplit] = useState(50);
  const canOverlay = !imageErrors.A && !imageErrors.B && overlayEligible(comparison.left, comparison.right, imageSizes.A, imageSizes.B);
  const images = [
    { label: 'A' as const, report: comparison.left, src: comparison.leftImage },
    { label: 'B' as const, report: comparison.right, src: comparison.rightImage },
  ];
  return <div className="card-qa-comparison-view" role="group" aria-label="Visueller Vergleich zweier QA-Screenshots">
    <p className="card-qa-comparison-loaded" role="status">Zwei Screenshots geladen. Quelle und Viewport stehen unter den Bildern.</p>
    {comparison.left.finalUrl !== comparison.right.finalUrl ? <p className="card-qa-comparison-warning">Die geladenen Routen unterscheiden sich. Vergleiche die Ansichten mit diesem Kontext.</p> : null}
    <p className="card-qa-comparison-warning">{qaGitComparisonNote(comparison.left, comparison.right)} Der lokale Dev-Server ist dadurch keinem Commit nachweislich zugeordnet.</p>
    <div className="card-qa-comparison-images">{images.map(({ label, report, src }) => <figure key={report.id} className={expanded === label ? 'expanded' : undefined}>
      {imageErrors[label] ? <p role="alert">Screenshot {label} konnte nicht angezeigt werden.</p> : <img src={src} alt={`Gespeicherter QA-Screenshot ${label}`} onLoad={(event) => { const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setImageSizes((old) => ({ ...old, [label]: size })); }} onError={() => { setImageErrors((old) => ({ ...old, [label]: true })); setOverlayOpen(false); }} />}
      <figcaption><strong>Screenshot {label}</strong><time dateTime={report.endedAt}>{new Date(report.endedAt).toLocaleString('de-DE')}</time><span>Quelle: {report.finalUrl ?? report.requestedUrl}</span><span>Viewport: {viewport(report)}</span><span>{qaGitLabel(report)}</span></figcaption>
      {!imageErrors[label] ? <button className="secondary-button small" type="button" onClick={() => setExpanded(expanded === label ? null : label)}>{expanded === label ? `Screenshot ${label} verkleinern` : `Screenshot ${label} vergrößern`}</button> : null}
    </figure>)}</div>
    {canOverlay ? <>
      <button className="secondary-button small card-qa-overlay-toggle" type="button" aria-expanded={overlayOpen} onClick={() => setOverlayOpen((value) => !value)}>{overlayOpen ? 'Überlagerung schließen' : 'Überlagerung öffnen'}</button>
      {overlayOpen ? <div className="card-qa-overlay" aria-label="Überlagerung der geladenen Screenshots">
        <p>Screenshot A liegt darunter; Screenshot B wird von links eingeblendet. A und B sind deine Auswahl, keine zeitliche Reihenfolge.</p>
        <div className="card-qa-overlay-stage" role="img" aria-label={`Überlagerung: ${split} Prozent von Screenshot B sichtbar`} style={{ aspectRatio: `${imageSizes.A!.width} / ${imageSizes.A!.height}` }}>
          <img src={comparison.leftImage} alt="" aria-hidden="true" />
          <img className="card-qa-overlay-upper" src={comparison.rightImage} alt="" aria-hidden="true" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
          <span className="card-qa-overlay-divider" aria-hidden="true" style={{ left: `${split}%` }} />
        </div>
        <label>Screenshot B sichtbar: {split} %<input type="range" min="0" max="100" step="1" value={split} aria-label="Anteil von Screenshot B" aria-valuetext={`${split} Prozent Screenshot B sichtbar`} onChange={(event) => setSplit(Number(event.target.value))} /></label>
      </div> : null}
    </> : <p className="card-qa-comparison-limit">Überlagerung erst möglich, wenn beide Bilder geladen sind und erfasster Viewport sowie Bildmaße übereinstimmen.</p>}
    <p className="card-qa-comparison-limit">Zwei lokale Momentaufnahmen zur visuellen Prüfung. Keine Pixelbewertung, Layoutfreigabe oder automatische QA-Entscheidung.</p>
    <button className="secondary-button small" type="button" onClick={onClose}>Vergleich schließen</button>
  </div>;
}

export function CardQaComparison({ cardId, reports }: { cardId: string; reports: CardQaReport[] }) {
  const available = reports.filter((report) => report.screenshotAvailable);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const compareButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setComparison(null);
    setLeftId((id) => available.some((report) => report.id === id) ? id : '');
    setRightId((id) => available.some((report) => report.id === id) ? id : '');
  }, [reports]);

  async function compare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const left = available.find((report) => report.id === leftId);
    const right = available.find((report) => report.id === rightId);
    if (!left || !right || left.id === right.id) { setError('Wähle zwei verschiedene gespeicherte Screenshots.'); return; }
    setBusy(true); setError(''); setComparison(null);
    try {
      const [leftImage, rightImage] = await Promise.all([
        window.studio.cardQaScreenshot({ cardId, reportId: left.id }),
        window.studio.cardQaScreenshot({ cardId, reportId: right.id }),
      ]);
      setComparison({ left, right, leftImage, rightImage });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <section className="card-qa-comparison" aria-label="QA-Screenshots vergleichen">
    <h4>Screenshots vergleichen</h4>
    {available.length < 2 ? <p className="section-copy">Für einen visuellen Vergleich braucht diese Karte zwei gespeicherte QA-Screenshots.</p> : <form onSubmit={(event) => void compare(event)}>
      <p className="section-copy">Wähle zwei verschiedene Läufe dieser Karte. Es werden nur die gespeicherten Bilder geladen.</p>
      <label>Screenshot A<select value={leftId} disabled={busy} onChange={(event) => { setLeftId(event.target.value); setComparison(null); }}><option value="">Lauf wählen</option>{available.map((report, index) => <option key={report.id} value={report.id}>Lauf {index + 1} · {new Date(report.endedAt).toLocaleString('de-DE')} · {report.finalUrl ?? report.requestedUrl}</option>)}</select></label>
      <label>Screenshot B<select value={rightId} disabled={busy} onChange={(event) => { setRightId(event.target.value); setComparison(null); }}><option value="">Lauf wählen</option>{available.map((report, index) => <option key={report.id} value={report.id}>Lauf {index + 1} · {new Date(report.endedAt).toLocaleString('de-DE')} · {report.finalUrl ?? report.requestedUrl}</option>)}</select></label>
      <button ref={compareButton} className="secondary-button" type="submit" disabled={busy || !leftId || !rightId || leftId === rightId}>{busy ? 'Lädt…' : 'Visuell vergleichen'}</button>
    </form>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {comparison ? <QaComparisonView key={`${comparison.left.id}:${comparison.right.id}`} comparison={comparison} onClose={() => { setComparison(null); compareButton.current?.focus(); }} /> : null}
  </section>;
}
