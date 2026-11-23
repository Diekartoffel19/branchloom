import { useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { planFeedback, planLines, type PlanComment, type ReviewedPlan } from '../../shared/plan-review';
import './plan-review.css';

const errorText = (value: unknown): string => value instanceof Error ? value.message : String(value);

export function PlanReviewPanel({ plan, onRuleSaved }: { plan: ReviewedPlan; onRuleSaved?: () => void }) {
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [line, setLine] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lines = planLines(plan.proposal);

  useEffect(() => {
    let active = true;
    setComments([]); setLine(null); setBody(''); setError(''); setNotice('');
    void window.studio.planComments(plan.id).then((items) => { if (active) setComments(items); }, (reason) => { if (active) setError(errorText(reason)); });
    return () => { active = false; };
  }, [plan.id]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (line === null || !body.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await window.studio.createPlanComment({ planId: plan.id, fingerprint: plan.fingerprint, line, body: body.trim() });
      setComments(await window.studio.planComments(plan.id));
      setLine(null); setBody('');
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function copyFeedback() {
    setError(''); setNotice('');
    try {
      await navigator.clipboard.writeText(planFeedback(plan, comments));
      setNotice('Feedback in die Zwischenablage kopiert. Es wurde nicht an einen Agenten gesendet.');
    } catch (reason) { setError(`Kopieren fehlgeschlagen: ${errorText(reason)}`); }
  }

  async function promote(comment: PlanComment) {
    setError(''); setNotice('');
    try {
      await window.studio.createReviewRuleFromComment({ projectId: plan.projectId, sourceKind: 'plan', sourceId: comment.id });
      setNotice('Kommentar als Projektregel übernommen. Die Regel ist bei der nächsten Workflow-Planung aktiv.');
      onRuleSaved?.();
    } catch (reason) { setError(errorText(reason)); }
  }

  return <section className="plan-review" aria-label="Plan kommentieren">
    <div className="plan-review-heading"><div><h4>Planstellen kommentieren</h4><p>Eine Zeile wählen und Feedback lokal speichern. Für eine Überarbeitung Feedback kopieren und bewusst in einen neuen Auftrag einfügen. Es wird nicht automatisch an einen Agenten gesendet.</p></div>
      <button className="secondary-button" type="button" disabled={comments.length === 0} onClick={() => void copyFeedback()}>Feedback kopieren</button></div>
    {plan.state !== 'open' ? <p className="inline-note" role="status">{plan.state === 'accepted' ? 'Dieser Vorschlag wurde übernommen.' : 'Ein neuerer Vorschlag liegt vor.'} Kommentare bleiben lesbar.</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
    <div className="plan-review-lines">{lines.map((item) => <div className="plan-review-entry" key={item.number}>
      <button type="button" className="plan-review-line" disabled={plan.state !== 'open'} aria-label={`Kommentar zu Planzeile ${item.number}`}
        aria-pressed={line === item.number} onClick={() => { setLine(item.number); setBody(''); }}>
        <span>{item.number}</span><span>{item.text || ' '}</span><MessageSquarePlus size={13} aria-hidden="true" />
      </button>
      {comments.filter((comment) => comment.line === item.number).map((comment) => <div className="plan-review-comment" key={comment.id}>
        <small>{new Date(comment.createdAt).toLocaleString('de-DE')}</small><p>{comment.body}</p>
        <button type="button" className="secondary-button" onClick={() => void promote(comment)}>Als Projektregel übernehmen</button>
      </div>)}
    </div>)}</div>
    {line !== null && plan.state === 'open' ? <form className="plan-review-form" onSubmit={(event) => void save(event)}>
      <label>Kommentar zu Zeile {line}<textarea autoFocus rows={3} maxLength={2000} value={body} disabled={busy} onChange={(event) => setBody(event.target.value)} placeholder="Konkrete Frage oder Änderung…" /></label>
      <div><button className="secondary-button" type="button" onClick={() => { setLine(null); setBody(''); }}>Abbrechen</button>
        <button className="primary-button" type="submit" disabled={busy || !body.trim()}>Kommentar speichern</button></div>
    </form> : null}
  </section>;
}
