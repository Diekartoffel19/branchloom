import { useEffect, useState } from 'react';
import { GitCommitHorizontal, Milestone, Plus } from 'lucide-react';
import type { MilestoneCheckout, MilestoneComparison, ProjectMilestone } from '../../shared/milestones';
import './milestones.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function MilestonesView({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ProjectMilestone[]>([]);
  const [label, setLabel] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [comparison, setComparison] = useState<MilestoneComparison | null>(null);
  const [checkout, setCheckout] = useState<MilestoneCheckout | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setSelected(null); setComparison(null); setCheckout(null); setPreviewImage(null); setPreviewError('');
    window.studio.listMilestones(projectId).then((result) => { if (active) setItems(result); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !label.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const item = previewUrl.trim()
        ? await window.studio.createMilestoneWithPreview({ projectId, label, url: previewUrl.trim() })
        : await window.studio.createMilestone({ projectId, label });
      setItems(await window.studio.listMilestones(projectId));
      setSelected(item.id); setComparison(null); setCheckout(null); setPreviewImage(null); setPreviewError(''); setLabel(''); setPreviewUrl('');
      setNotice(item.previewAvailable ? 'Meilenstein und lokale Vorschauaufnahme gespeichert.' : 'Meilenstein für den aktuellen Git-Commit lokal markiert.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function compare(id: string) {
    if (busy) return;
    setSelected(id); setComparison(null); setCheckout(null); setPreviewImage(null); setPreviewError(''); setBusy(true); setError(''); setNotice('');
    try { setComparison(await window.studio.compareMilestone({ projectId, milestoneId: id })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function openIsolated() {
    if (!selected || busy) return;
    if (!window.confirm('Ein separates, abgekoppeltes Git-Checkout für diesen Meilenstein anlegen oder wiederverwenden? Dein aktueller Projektordner wird nicht verändert. Ein vorhandenes Checkout wird nicht überschrieben.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.studio.checkoutMilestone({ projectId, milestoneId: selected, confirm: true });
      setCheckout(result);
      setNotice(result.reused ? 'Vorhandenes isoliertes Checkout geprüft.' : 'Isoliertes Checkout angelegt.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function showPreview() {
    if (!comparison?.milestone.previewAvailable || !selected || busy || previewBusy) return;
    setPreviewBusy(true); setPreviewError('');
    try { setPreviewImage(await window.studio.milestonePreviewImage({ projectId, milestoneId: selected })); }
    catch (reason) { setPreviewError(messageOf(reason)); }
    finally { setPreviewBusy(false); }
  }

  return <section className="milestones-page" aria-label="Zeitmaschine">
    <header className="milestones-heading"><div><h2>Meilensteine</h2><p>Markiere einen sauberen Git-Commit, vergleiche ihn später mit deinem aktuellen Stand und öffne ihn bei Bedarf in einem separaten Checkout.</p></div></header>
    <form className="milestones-create" onSubmit={(event) => void create(event)}>
      <label>Meilenstein benennen<input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="z. B. Nach der ersten UI-Abnahme" /></label>
      <button type="submit" className="primary-button" disabled={busy || !label.trim()}><Plus size={16} /> Git-Stand markieren</button>
      <details className="milestones-preview-option"><summary>Optionale lokale Vorschauaufnahme</summary><label>Adresse des laufenden Dev-Servers<input type="url" value={previewUrl} maxLength={2048} onChange={(event) => setPreviewUrl(event.target.value)} placeholder="http://127.0.0.1:5173/" /></label><p>Nur eine ausdrücklich angegebene Loopback-Route wird geladen. Der lokale Server muss bereits laufen; das Bild wird begrenzt und nur in den lokalen App-Daten gespeichert.</p></details>
      <small>Nur bereits committete Dateien werden erfasst. Bei Änderungen im Arbeitsbaum wird die Markierung abgelehnt. Keine Dateien werden automatisch zurückgesetzt.</small>
    </form>
    {error ? <p className="milestones-feedback error" role="alert">{error}</p> : null}
    {notice ? <p className="milestones-feedback" role="status">{notice}</p> : null}
    <div className="milestones-list" aria-label="Gespeicherte Meilensteine">
      {loading ? <p className="milestones-empty">Meilensteine werden geladen…</p> : items.length === 0 ? <p className="milestones-empty">Noch kein Git-Stand markiert.</p> : items.map((item) =>
        <button key={item.id} type="button" className={selected === item.id ? 'milestones-item selected' : 'milestones-item'} onClick={() => void compare(item.id)} disabled={busy || previewBusy}>
          <Milestone size={17} aria-hidden="true" /><span><strong>{item.label}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.branch ?? 'Detached HEAD'} · {item.commit.slice(0, 12)}{item.previewAvailable ? ' · Vorschau' : ''}</small></span>
          <span className="milestones-item-action">Vergleichen</span>
        </button>)}
    </div>
    {comparison ? <section className="milestones-comparison" aria-label="Git-Vergleich">
      <div className="milestones-comparison-head"><div><h3>{comparison.milestone.label}</h3><p><GitCommitHorizontal size={15} aria-hidden="true" /> {comparison.milestone.commit.slice(0, 12)} → {comparison.currentCommit.slice(0, 12)}</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => void openIsolated()}>Isoliertes Checkout anlegen</button></div>
      <p className="milestones-condition">{comparison.isAncestor ? 'Der markierte Commit liegt in der aktuellen Historie.' : 'Die Git-Historie hat sich verzweigt oder wurde umgeschrieben.'} {comparison.workingTreeClean ? 'Arbeitsbaum sauber.' : 'Der aktuelle Arbeitsbaum enthält zusätzliche, hier nicht verglichene Änderungen.'}</p>
      <div className="milestones-preview-result">
        {comparison.milestone.previewAvailable ? <><p>Lokale Vorschauaufnahme: {comparison.milestone.previewSource} · {comparison.milestone.previewCapturedAt ? new Date(comparison.milestone.previewCapturedAt).toLocaleString() : 'Zeit unbekannt'}</p><button type="button" className="secondary-button small" disabled={busy || previewBusy} onClick={() => void showPreview()}>{previewBusy ? 'Lädt…' : previewImage ? 'Bild erneut laden' : 'Vorschau ansehen'}</button></> : <p>Für diesen Meilenstein wurde kein Vorschau-Bild gespeichert.</p>}
        {previewError ? <p className="milestones-feedback error" role="alert">{previewError}</p> : null}
        {previewImage ? <img src={previewImage} alt={`Lokale Vorschauaufnahme für Meilenstein ${comparison.milestone.label}`} /> : null}
        {comparison.milestone.previewAvailable ? <p>Das Bild ist mit dem Git-Commit markiert. Es beweist nicht, dass der lokale Dev-Server genau diesen Commit ausgeliefert hat.</p> : null}
      </div>
      {comparison.changedFiles.length === 0 ? <p className="milestones-empty">Zwischen den beiden Commits gibt es keine Dateiänderungen.</p> : <ul className="milestones-files">{comparison.changedFiles.map((file, index) => <li key={`${file.path}-${index}`}><span>{file.status}</span><code>{file.path}</code></li>)}</ul>}
      {comparison.truncated ? <p className="milestones-condition">Es werden höchstens 200 geänderte Dateien angezeigt.</p> : null}
      {checkout ? <p className="milestones-checkout" role="status">Isoliertes Checkout: <code>{checkout.path}</code>{checkout.workingTreeClean ? '' : ' · Enthält eigene Änderungen; nichts wurde überschrieben.'}</p> : null}
    </section> : null}
  </section>;
}
