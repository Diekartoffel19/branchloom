import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Card, CardQaReport } from '../../shared/types';
import type { ReviewComment } from '../../shared/diff-review';
import type { CardCriterion, CardCriterionEvidenceKind } from '../../shared/card-acceptance';
import './card-acceptance.css';

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function CardAcceptancePanel({ card, onOpenEvidence }: { card: Card; onOpenEvidence: (kind: CardCriterionEvidenceKind, sourceId: string) => void }) {
  const [criteria, setCriteria] = useState<CardCriterion[]>([]);
  const [reports, setReports] = useState<CardQaReport[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourcesError, setSourcesError] = useState('');

  async function refresh() {
    const [criteriaResult, reportsResult, commentsResult] = await Promise.allSettled([
      window.studio.cardCriteria(card.id), window.studio.cardQaReports(card.id), window.studio.listReviewComments(card.id),
    ]);
    if (criteriaResult.status === 'rejected') throw criteriaResult.reason;
    setCriteria(criteriaResult.value);
    setReports(reportsResult.status === 'fulfilled' ? reportsResult.value : []);
    setComments(commentsResult.status === 'fulfilled' ? commentsResult.value : []);
    setSourcesError(reportsResult.status === 'rejected' || commentsResult.status === 'rejected' ? 'Einige Prüfquellen konnten nicht geladen werden. Bitte erneut laden.' : '');
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSourcesError(''); setCriteria([]); setReports([]); setComments([]); setDraft('');
    void Promise.allSettled([window.studio.cardCriteria(card.id), window.studio.cardQaReports(card.id), window.studio.listReviewComments(card.id)]).then(([criteriaResult, reportsResult, commentsResult]) => {
      if (!active) return;
      if (criteriaResult.status === 'fulfilled') setCriteria(criteriaResult.value);
      else setError(errorText(criteriaResult.reason));
      setReports(reportsResult.status === 'fulfilled' ? reportsResult.value : []);
      setComments(commentsResult.status === 'fulfilled' ? commentsResult.value : []);
      if (reportsResult.status === 'rejected' || commentsResult.status === 'rejected') setSourcesError('Einige Prüfquellen konnten nicht geladen werden. Bitte erneut laden.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [card.id]);

  async function apply(action: () => Promise<CardCriterion[]>) {
    if (busy) return;
    setBusy(true); setError('');
    try { setCriteria(await action()); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function reload() {
    setBusy(true); setError('');
    try { await refresh(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  const gaps = criteria.filter((item) => !item.evidence.some((link) => link.sourceAvailable && link.currentForCriterion)).length;
  const disabled = busy || Boolean(card.archivedAt);

  return <section className="card-acceptance" aria-label="Abnahmekriterien">
    <div className="section-heading"><ClipboardCheck size={19} aria-hidden="true" /><h3>Abnahmekriterien</h3></div>
    <p className="section-copy">Beschreibe überprüfbare Ergebnisse. Ordne gespeicherte Browser-QA-Berichte oder Diff-Kommentare bewusst zu; ein Verweis bestätigt die Erfüllung nicht automatisch.</p>
    {loading ? <p className="section-copy" role="status">Kriterien werden geladen…</p> : <>
      <div className="card-acceptance-status" role="status"><span>{criteria.length} Kriterium{criteria.length === 1 ? '' : 'en'}</span><strong>{gaps ? `${gaps} ohne gültigen Prüfverweis` : criteria.length ? 'Alle mit Prüfverweis' : 'Noch keine Kriterien'}</strong><button type="button" className="text-button" disabled={busy} onClick={() => void reload()}>Quellen aktualisieren</button></div>
      {criteria.length ? <ol className="card-acceptance-list">{criteria.map((criterion) => <CriterionRow key={criterion.id} criterion={criterion} reports={reports} comments={comments} disabled={disabled} archived={Boolean(card.archivedAt)} onApply={apply} onOpenEvidence={onOpenEvidence} />)}</ol> : null}
      {card.archivedAt ? <p className="inline-note">Archivierte Karten bleiben lesbar; stelle die Karte zum Bearbeiten wieder her.</p> : <form className="card-acceptance-create" onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; void apply(async () => { const saved = await window.studio.createCardCriterion({ cardId: card.id, text: draft }); setDraft(''); return saved; }); }}>
        <label>Neues Kriterium<input value={draft} maxLength={500} disabled={busy} onChange={(event) => setDraft(event.target.value)} placeholder="Was muss nachweisbar funktionieren?" /></label>
        <button type="submit" className="secondary-button" disabled={busy || !draft.trim()}>Kriterium hinzufügen</button>
      </form>}
      {sourcesError ? <p className="inline-note" role="status">{sourcesError}</p> : null}
    </>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}

function CriterionRow({ criterion, reports, comments, disabled, archived, onApply, onOpenEvidence }: {
  criterion: CardCriterion; reports: CardQaReport[]; comments: ReviewComment[]; disabled: boolean; archived: boolean;
  onApply: (action: () => Promise<CardCriterion[]>) => Promise<void>;
  onOpenEvidence: (kind: CardCriterionEvidenceKind, sourceId: string) => void;
}) {
  const [text, setText] = useState(criterion.text);
  const [sourceKey, setSourceKey] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { setText(criterion.text); }, [criterion.text]);
  const live = criterion.evidence.some((item) => item.sourceAvailable && item.currentForCriterion);
  const options = [
    ...reports.map((report) => ({ key: `qa:${report.id}`, label: `QA ${new Date(report.endedAt).toLocaleString('de-DE')} · ${report.status} · ${report.requestedUrl}` })),
    ...comments.map((comment) => ({ key: `review:${comment.id}`, label: `Review ${comment.filePath}:${comment.line} · ${comment.body.slice(0, 90)}` })),
  ];
  return <li className="card-acceptance-item"><div className="card-acceptance-item-head"><strong>{criterion.text}</strong><span className={live ? 'card-acceptance-linked' : 'card-acceptance-gap'}>{live ? 'Prüfverweis vorhanden' : 'Prüfverweis fehlt'}</span></div>
    {criterion.evidence.length ? <ul className="card-acceptance-evidence">{criterion.evidence.map((link) => <li key={link.id}><div><strong>{link.sourceLabel}</strong><span>{!link.currentForCriterion ? 'Frühere Formulierung' : link.sourceStatus === 'passed' ? 'QA ohne erfasste Fehler' : link.sourceStatus === 'failed' ? 'QA mit Fehlern' : link.sourceStatus === 'error' ? 'QA nicht abgeschlossen' : link.sourceStatus === 'review' ? 'Review-Kommentar' : 'Quelle fehlt'}</span></div><p>{link.note}</p><div className="card-acceptance-evidence-actions">{link.sourceAvailable ? <button type="button" className="text-button" onClick={() => onOpenEvidence(link.kind, link.sourceId)}>Quelle öffnen</button> : null}<button type="button" className="text-button" disabled={disabled} onClick={() => void onApply(() => window.studio.unlinkCardCriterionEvidence({ cardId: criterion.cardId, criterionId: criterion.id, evidenceId: link.id }))}>Verweis lösen</button></div></li>)}</ul> : null}
    {!archived ? <details className="card-acceptance-edit"><summary>Kriterium und Verweise bearbeiten</summary>
      <form onSubmit={(event) => { event.preventDefault(); if (text.trim() === criterion.text) return; void onApply(() => window.studio.updateCardCriterion({ cardId: criterion.cardId, criterionId: criterion.id, text })); }}><label>Formulierung<input value={text} maxLength={500} disabled={disabled} onChange={(event) => setText(event.target.value)} /></label><button type="submit" className="secondary-button small" disabled={disabled || !text.trim() || text.trim() === criterion.text}>Text speichern</button></form>
      <form onSubmit={(event) => { event.preventDefault(); if (!sourceKey || !note.trim()) return; const at = sourceKey.indexOf(':'); const kind = sourceKey.slice(0, at) as CardCriterionEvidenceKind; const sourceId = sourceKey.slice(at + 1); void onApply(async () => { const saved = await window.studio.linkCardCriterionEvidence({ cardId: criterion.cardId, criterionId: criterion.id, kind, sourceId, note }); setSourceKey(''); setNote(''); return saved; }); }}>
        <label>Gespeicherte Prüfquelle<select value={sourceKey} disabled={disabled} onChange={(event) => setSourceKey(event.target.value)}><option value="">Quelle wählen</option>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label>Was deckt diese Quelle ab?<input value={note} maxLength={500} disabled={disabled} onChange={(event) => setNote(event.target.value)} placeholder="Konkrete Beobachtung oder offene Frage" /></label>
        <button type="submit" className="secondary-button small" disabled={disabled || !sourceKey || !note.trim()}>Verweis speichern</button>
        {!options.length ? <small>Für diese Karte gibt es noch keinen QA-Bericht oder Diff-Kommentar. Prüfe die Quellen unten und lade sie dann hier neu.</small> : null}
      </form>
      <button type="button" className="text-button card-acceptance-delete" disabled={disabled} onClick={() => { if (window.confirm('Kriterium und seine Verweise entfernen?')) void onApply(() => window.studio.deleteCardCriterion({ cardId: criterion.cardId, criterionId: criterion.id })); }}>Kriterium entfernen</button>
    </details> : null}
  </li>;
}
