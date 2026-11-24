import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { Card, CardQaReport, CardQaViewport } from '../../shared/types';
import { CardQaComparison } from './CardQaComparison';
import './card-qa.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const statusOf = (report: CardQaReport): string => report.status === 'passed'
  ? 'Keine Konsolen- oder Ladefehler gefunden'
  : report.status === 'failed' ? `${report.diagnostics.length} Fehler gefunden` : 'Prüfung nicht abgeschlossen';
const viewportOf = (report: CardQaReport): string => report.viewportWidth > 0 && report.viewportHeight > 0
  ? `${report.viewportWidth} × ${report.viewportHeight} px` : 'nicht erfasst';

function CardQaScreenshot({ cardId, reportId }: { cardId: string; reportId: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    if (busy) return;
    if (dataUrl) { setDataUrl(null); return; }
    setBusy(true); setError('');
    try { setDataUrl(await window.studio.cardQaScreenshot({ cardId, reportId })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <div className="card-qa-screenshot">
    <button className="secondary-button small" type="button" disabled={busy} onClick={() => void open()}>{busy ? 'Lädt…' : dataUrl ? 'Screenshot schließen' : 'Screenshot ansehen'}</button>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {dataUrl ? <figure><img src={dataUrl} alt="Lokaler Screenshot der geprüften Seite" /><figcaption>Momentaufnahme dieser Route zum Prüfzeitpunkt. Kein Vorher/Nachher-Vergleich.</figcaption></figure> : null}
  </div>;
}

function CardQaReportItem({ cardId, report, initiallyOpen }: { cardId: string; report: CardQaReport; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => { setOpen(initiallyOpen); }, [initiallyOpen]);
  return <details className="card-qa-report" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span className={`card-qa-state ${report.status}`}>{statusOf(report)}</span><time dateTime={report.endedAt}>{new Date(report.endedAt).toLocaleString('de-DE')}</time><span className="card-qa-viewport">{viewportOf(report)}</span></summary>
    <p className="card-qa-source"><strong>Seite:</strong> {report.requestedUrl}{report.finalUrl && report.finalUrl !== report.requestedUrl ? <> · <strong>Geladen:</strong> {report.finalUrl}</> : null}</p>
    {report.note ? <p className="inline-note">{report.note}</p> : null}
    {report.diagnostics.length ? <ol className="card-qa-findings">{report.diagnostics.map((item) => <li key={item.id}><strong>{item.kind === 'console' ? 'Konsole' : 'Laden'}:</strong> {item.message}{item.sourceUrl ? <small>{item.sourceUrl}{item.line ? `:${item.line}` : ''}</small> : null}</li>)}</ol> : null}
    {open && report.screenshotAvailable ? <CardQaScreenshot cardId={cardId} reportId={report.id} /> : null}
  </details>;
}

export function CardQaPanel({ card }: { card: Card }) {
  const [url, setUrl] = useState('');
  const [viewport, setViewport] = useState<CardQaViewport>('desktop');
  const [reports, setReports] = useState<CardQaReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setReports([]); setUrl(''); setViewport('desktop');
    void window.studio.cardQaReports(card.id).then((items) => {
      if (!alive) return;
      setReports(items); setLoading(false);
      setUrl((current) => current || items[0]?.requestedUrl || '');
    }).catch((reason: unknown) => { if (alive) { setError(messageOf(reason)); setLoading(false); } });
    return () => { alive = false; };
  }, [card.id]);

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || card.archivedAt) return;
    setBusy(true); setError('');
    try {
      const report = await window.studio.runCardQa({ cardId: card.id, url, viewport });
      setReports((items) => [report, ...items.filter((item) => item.id !== report.id)].slice(0, 20));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="card-qa" aria-label="Lokale Browser-QA">
    <div className="section-heading"><FlaskConical size={19} aria-hidden="true" /><h3>Lokale Browser-QA</h3></div>
    <p className="section-copy">Prüft nach deinem Klick genau eine lokale Dev-Server-Seite in einem frischen, isolierten Browser. Fremde Anfragen, Pop-ups und Berechtigungen werden blockiert. Es startet kein Agent.</p>
    <form className="card-qa-form" onSubmit={(event) => void run(event)}>
      <label>Vorschau-URL<input type="url" value={url} required maxLength={2048} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:5173/" /></label>
      <label>Prüfgröße<select value={viewport} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setViewport(event.target.value as CardQaViewport)}><option value="desktop">Desktop · 1280 × 800</option><option value="tablet">Tablet · 768 × 1024</option><option value="mobile">Mobile · 390 × 844</option></select></label>
      <button className="secondary-button" type="submit" disabled={busy || Boolean(card.archivedAt) || !url.trim()}>{busy ? 'Prüft…' : 'Lokale Seite prüfen'}</button>
    </form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {loading ? <p className="section-copy" role="status">Gespeicherte Prüfungen werden geladen…</p> : reports.length === 0 ? <p className="section-copy">Für diese Karte liegt noch kein Browser-QA-Bericht vor.</p> : <div className="card-qa-reports">
      {reports.map((report) => <CardQaReportItem key={report.id} cardId={card.id} report={report} initiallyOpen={report.id === reports[0]?.id} />)}
    </div>}
    {!loading ? <CardQaComparison cardId={card.id} reports={reports} /> : null}
    <p className="card-qa-limit">Der Bericht belegt nur diesen Seitenaufruf bei der gewählten Prüfgröße und Fehler im kurzen Prüfzeitraum. Layout, Interaktion, andere Routen und Tests bleiben separat zu prüfen.</p>
  </section>;
}
