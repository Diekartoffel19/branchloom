import { useEffect, useState } from 'react';
import type { CardQaReport } from '../../shared/types';
import './card-qa-comparison.css';

interface Comparison { left: CardQaReport; right: CardQaReport; leftImage: string; rightImage: string }

function viewport(report: CardQaReport): string {
  return report.viewportWidth > 0 && report.viewportHeight > 0 ? `${report.viewportWidth} × ${report.viewportHeight} px` : 'nicht erfasst';
}

export function QaComparisonView({ comparison }: { comparison: Comparison }) {
  const images = [
    { label: 'A', report: comparison.left, src: comparison.leftImage },
    { label: 'B', report: comparison.right, src: comparison.rightImage },
  ];
  return <div className="card-qa-comparison-view" aria-label="Visueller Vergleich zweier QA-Screenshots">
    {comparison.left.finalUrl !== comparison.right.finalUrl ? <p className="card-qa-comparison-warning">Die geladenen Routen unterscheiden sich. Vergleiche die Ansichten mit diesem Kontext.</p> : null}
    <div className="card-qa-comparison-images">{images.map(({ label, report, src }) => <figure key={report.id}>
      <img src={src} alt={`Gespeicherter QA-Screenshot ${label}`} />
      <figcaption><strong>Screenshot {label}</strong><time dateTime={report.endedAt}>{new Date(report.endedAt).toLocaleString('de-DE')}</time><span>Quelle: {report.finalUrl ?? report.requestedUrl}</span><span>Viewport: {viewport(report)}</span></figcaption>
    </figure>)}</div>
    <p className="card-qa-comparison-limit">Zwei lokale Momentaufnahmen zur visuellen Prüfung. Keine Pixelbewertung, Layoutfreigabe oder automatische QA-Entscheidung.</p>
  </div>;
}

export function CardQaComparison({ cardId, reports }: { cardId: string; reports: CardQaReport[] }) {
  const available = reports.filter((report) => report.screenshotAvailable);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      <button className="secondary-button" type="submit" disabled={busy || !leftId || !rightId || leftId === rightId}>{busy ? 'Lädt…' : 'Visuell vergleichen'}</button>
    </form>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {comparison ? <QaComparisonView comparison={comparison} /> : null}
  </section>;
}
