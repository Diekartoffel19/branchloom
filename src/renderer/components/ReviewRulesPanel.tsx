import { useEffect, useState } from 'react';
import type { ReviewRule } from '../../shared/review-rules';
import './review-rules.css';

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function ReviewRulesPanel({ projectId, refreshKey = 0 }: { projectId: string; refreshKey?: number }) {
  const [rules, setRules] = useState<ReviewRule[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setRules([]); setEditing(null); setConfirmDelete(null); setError('');
    void window.studio.reviewRules(projectId).then((items) => { if (active) setRules(items); }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [projectId, refreshKey]);

  async function reload() { setRules(await window.studio.reviewRules(projectId)); }
  async function save(rule: ReviewRule) {
    if (busy || !draft.trim()) return;
    setBusy(true); setError('');
    try { await window.studio.updateReviewRule({ projectId, id: rule.id, body: draft }); await reload(); setEditing(null); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  async function toggle(rule: ReviewRule) {
    if (busy) return;
    setBusy(true); setError('');
    try { await window.studio.updateReviewRule({ projectId, id: rule.id, enabled: !rule.enabled }); await reload(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  async function remove(rule: ReviewRule) {
    if (busy || confirmDelete !== rule.id) return;
    setBusy(true); setError('');
    try { await window.studio.deleteReviewRule({ projectId, id: rule.id }); await reload(); setConfirmDelete(null); setEditing(null); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  return <section className="review-rules" aria-label="Projektregeln aus Reviews">
    <div className="review-rules-head"><div><h4>Projektregeln aus Reviews</h4><p>Nur ausdrücklich übernommene Kommentare. Aktivierte Regeln werden bei der nächsten Codex-Workflow-Planung als Projektkontext mitgesendet: maximal 10 Regeln und 4.000 Zeichen. Sie geben keine zusätzlichen Dateirechte.</p></div><span>{rules.length} / 30</span></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {rules.length === 0 ? <p className="inline-note">Noch keine Review-Regel übernommen. Bei einem Plan- oder Diff-Kommentar kannst du eine Regel anlegen.</p> : <ul className="review-rules-list">{rules.map((rule) => <li key={rule.id}>
      <div className="review-rules-source"><span>{rule.sourceKind === 'plan' ? 'Plan-Review' : 'Code-Review'} · {rule.sourceLabel}</span><span>{new Date(rule.updatedAt).toLocaleDateString('de-DE')}</span></div>
      {editing === rule.id ? <form onSubmit={(event) => { event.preventDefault(); void save(rule); }}><label>Regeltext<textarea rows={3} maxLength={2000} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} /></label><div><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Abbrechen</button><button type="submit" className="primary-button" disabled={busy || !draft.trim()}>Speichern</button></div></form> : <p>{rule.body}</p>}
      <div className="review-rules-actions"><label><input type="checkbox" checked={rule.enabled} disabled={busy} onChange={() => void toggle(rule)} /> Bei Planung nutzen</label><button type="button" className="secondary-button" disabled={busy} onClick={() => { setEditing(rule.id); setDraft(rule.body); setConfirmDelete(null); }}>Bearbeiten</button>
        {confirmDelete === rule.id ? <><button type="button" className="secondary-button" onClick={() => setConfirmDelete(null)}>Abbrechen</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void remove(rule)}>Endgültig entfernen</button></> : <button type="button" className="secondary-button" disabled={busy} onClick={() => { setConfirmDelete(rule.id); setEditing(null); }}>Entfernen</button>}</div>
    </li>)}</ul>}
  </section>;
}
