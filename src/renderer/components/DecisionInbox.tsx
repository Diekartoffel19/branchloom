import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import type { ReviewInboxItem, ReviewInboxPage } from '../../shared/review-inbox';
import { decisionItems, filterDecisionItems, type DecisionFilter } from '../decision-inbox';
import '../decision-inbox.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenWorkflow: (id: string) => void;
  onOpenQueue: () => void;
  onOpenSession: (id: string) => void;
  onOpenCard: (id: string) => void;
  onAcknowledgeSession: (id: string) => void;
  onOpenPlan: (id: string) => void;
}

function pauseTime(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ReviewInboxList({ items, hasMore, busy, onOpenPlan, onOpenCard, onAcknowledge }: {
  items: ReviewInboxItem[]; hasMore: boolean; busy: string | null;
  onOpenPlan: (id: string) => void; onOpenCard: (id: string) => void; onAcknowledge: (item: ReviewInboxItem) => void;
}) {
  return <section className="decision-review-section" aria-label="Review-Kommentare"><h3>Review-Kommentare</h3><p>Gespeicherte Hinweise ohne Bestätigung. Diff-Kommentare können einen älteren Stand betreffen; prüfe die Quelle. „Als geprüft markieren“ räumt nur diesen Inbox-Eintrag weg und gibt keinen Schritt frei.</p>
    <div className="decision-list">{items.map((item) => <article className="decision-item decision-review-item" key={`${item.kind}:${item.id}`}>
      <div className="decision-item-body"><div className="decision-meta"><span className="decision-kind">{item.kind === 'plan' ? 'Plan-Review' : 'Code-Review'}</span><time dateTime={item.createdAt}>{pauseTime(item.createdAt)}</time></div>
        <h4>{item.sourceTitle}</h4><p className="decision-context">{item.location}</p><p>{item.body}</p></div>
      <div className="decision-actions"><button className="secondary-button" type="button" onClick={() => item.kind === 'plan' ? onOpenPlan(item.sourceId) : onOpenCard(item.sourceId)}>{item.kind === 'plan' ? 'Plan öffnen' : 'Karte öffnen'} <ArrowRight size={15} aria-hidden="true" /></button>
        <button className="decision-subaction" type="button" disabled={Boolean(busy)} onClick={() => onAcknowledge(item)}>{busy === item.id ? 'Speichert…' : 'Als geprüft markieren'}</button></div>
    </article>)}</div>{hasMore ? <p className="decision-review-more">Die neuesten 100 Kommentare werden angezeigt. Ältere Kommentare bleiben an ihren Quellen erhalten.</p> : null}
  </section>;
}

export function DecisionInbox({ snapshot, onOpenWorkflow, onOpenQueue, onOpenSession, onOpenCard, onAcknowledgeSession, onOpenPlan }: Props) {
  const [category, setCategory] = useState<DecisionFilter>('all');
  const [query, setQuery] = useState('');
  const [reviews, setReviews] = useState<ReviewInboxPage | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState('');
  const activeProject = useRef(snapshot.project.id);
  activeProject.current = snapshot.project.id;
  useEffect(() => { setCategory('all'); setQuery(''); }, [snapshot.project.id]);
  useEffect(() => {
    let active = true;
    setReviews(null); setReviewError(''); setReviewNotice(''); setReviewBusy(null);
    void window.studio.reviewInboxItems(snapshot.project.id).then((page) => { if (active) setReviews(page); },
      (reason: unknown) => { if (active) setReviewError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [snapshot.project.id]);
  const items = decisionItems(snapshot);
  const visible = filterDecisionItems(items, category, query);
  const search = query.trim().toLocaleLowerCase('de');
  const visibleReviews = (category === 'all' || category === 'review' ? reviews?.items ?? [] : []).filter((item) =>
    !search || [item.sourceTitle, item.location, item.body].some((value) => value.toLocaleLowerCase('de').includes(search)));
  const hasItems = items.length > 0 || Boolean(reviews?.items.length);
  async function acknowledge(item: ReviewInboxItem) {
    if (reviewBusy) return;
    const projectId = snapshot.project.id;
    setReviewBusy(item.id); setReviewError(''); setReviewNotice('');
    try {
      await window.studio.acknowledgeReviewInboxComment({ projectId, kind: item.kind, commentId: item.id });
      const page = await window.studio.reviewInboxItems(projectId);
      if (activeProject.current === projectId) { setReviews(page); setReviewNotice('Kommentar als geprüft markiert. Der Originalkommentar bleibt an seiner Quelle.'); }
    } catch (reason) { if (activeProject.current === projectId) setReviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (activeProject.current === projectId) setReviewBusy(null); }
  }

  return <div className="standard-page decision-page">
    <div className="view-header"><div><h2>Offene Entscheidungen</h2><p>Gespeicherte Pausen, unterbrochene Agentenläufe und Review-Kommentare aus dem aktiven Projekt. Öffne die Quelle vor einer Entscheidung.</p></div></div>
    {!reviews && !reviewError ? <p className="section-copy" role="status">Review-Kommentare werden geladen…</p> : null}
    {reviewError ? <p className="inline-error" role="alert">Review-Kommentare konnten nicht geladen werden: {reviewError}</p> : null}
    {reviewNotice ? <p className="inline-note" role="status">{reviewNotice}</p> : null}
    {!hasItems && reviews ? <div className="decision-empty"><Inbox size={24} aria-hidden="true" /><h3>Keine offenen Entscheidungen</h3><p>Hier erscheinen pausierte Workflows, angehaltene Warteschlangen, unterbrochene Agentenläufe und noch nicht geprüfte Kommentare.</p></div>
      : <>
        {items.length + (reviews?.items.length ?? 0) > 4 || category !== 'all' || query ? <div className="decision-controls">
          <label>Entscheidung suchen<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workflow, Karte oder Grund" /></label>
          <label>Grund<select value={category} onChange={(event) => setCategory(event.target.value as DecisionFilter)}>
            <option value="all">Alle</option><option value="approval">Freigabe</option><option value="review">Prüfung</option><option value="manual">Manueller Schritt</option><option value="paused">Pausiert</option>
          </select></label>
        </div> : null}
        {visible.length === 0 && visibleReviews.length === 0 && hasItems ? <p className="decision-no-match" role="status">Keine Entscheidung passt zur Suche. Passe Suchwort oder Grund an.</p>
          : visible.length ? <div className="decision-list" aria-label="Offene Entscheidungen">{visible.map((item) => <article className="decision-item" key={item.id}>
            <div className="decision-item-body">
              <div className="decision-meta"><span className="decision-kind">{item.kind === 'queue' ? 'Warteschlange' : item.kind === 'session' ? 'Agentenlauf' : 'Workflow'}</span>{pauseTime(item.updatedAt) ? <time dateTime={item.updatedAt ?? undefined}>Aktualisiert {pauseTime(item.updatedAt)}</time> : null}</div>
              <h3>{item.title}</h3><p>{item.reason}</p>{item.context ? <p className="decision-context">{item.context}</p> : null}
              <p className="decision-next"><strong>Nächster Schritt:</strong> {item.nextAction}</p>
            </div>
            <div className="decision-actions">
              <button className="secondary-button" type="button" onClick={() => { if (item.kind === 'queue') onOpenQueue(); else if (item.kind === 'session' && item.sessionId) onOpenSession(item.sessionId); else if (item.workflowId) onOpenWorkflow(item.workflowId); }}>{item.kind === 'queue' ? 'Zur Warteschlange' : item.kind === 'session' ? 'Verlauf prüfen' : 'Zum Workflow'} <ArrowRight size={15} aria-hidden="true" /></button>
              {item.kind === 'queue' && item.workflowId ? <button className="decision-subaction" type="button" onClick={() => onOpenWorkflow(item.workflowId!)}>Aktiven Workflow öffnen</button> : null}
              {item.kind === 'session' && item.cardId ? <button className="decision-subaction" type="button" onClick={() => onOpenCard(item.cardId!)}>Karte und Dateien öffnen</button> : null}
              {item.kind === 'session' && item.sessionId ? <button className="decision-subaction" type="button" onClick={() => onAcknowledgeSession(item.sessionId!)}>Prüfung abgeschlossen</button> : null}
            </div>
          </article>)}</div> : null}
        {visibleReviews.length ? <ReviewInboxList items={visibleReviews} hasMore={Boolean(reviews?.hasMore)} busy={reviewBusy}
          onOpenPlan={onOpenPlan} onOpenCard={onOpenCard} onAcknowledge={(item) => void acknowledge(item)} /> : null}
      </>}
  </div>;
}
