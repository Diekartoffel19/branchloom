import { useEffect, useState } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { decisionItems, filterDecisionItems, type DecisionFilter } from '../decision-inbox';
import '../decision-inbox.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenWorkflow: (id: string) => void;
  onOpenQueue: () => void;
  onOpenSession: (id: string) => void;
  onOpenCard: (id: string) => void;
  onAcknowledgeSession: (id: string) => void;
}

function pauseTime(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function DecisionInbox({ snapshot, onOpenWorkflow, onOpenQueue, onOpenSession, onOpenCard, onAcknowledgeSession }: Props) {
  const [category, setCategory] = useState<DecisionFilter>('all');
  const [query, setQuery] = useState('');
  useEffect(() => { setCategory('all'); setQuery(''); }, [snapshot.project.id]);
  const items = decisionItems(snapshot);
  const visible = filterDecisionItems(items, category, query);

  return <div className="standard-page decision-page">
    <div className="view-header"><div><h2>Offene Entscheidungen</h2><p>Gespeicherte Pausen und unterbrochene Agentenläufe aus dem aktiven Projekt. Prüfe den Verlauf vor jeder Fortsetzung.</p></div></div>
    {items.length === 0 ? <div className="decision-empty"><Inbox size={24} aria-hidden="true" /><h3>Keine offenen Entscheidungen</h3><p>Hier erscheinen pausierte Workflows, angehaltene Warteschlangen und unterbrochene Agentenläufe, sobald sie deine Prüfung benötigen.</p></div>
      : <>
        {items.length > 4 || category !== 'all' || query ? <div className="decision-controls">
          <label>Entscheidung suchen<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workflow, Karte oder Grund" /></label>
          <label>Grund<select value={category} onChange={(event) => setCategory(event.target.value as DecisionFilter)}>
            <option value="all">Alle</option><option value="approval">Freigabe</option><option value="review">Prüfung</option><option value="manual">Manueller Schritt</option><option value="paused">Pausiert</option>
          </select></label>
        </div> : null}
        {visible.length === 0 ? <p className="decision-no-match" role="status">Keine Entscheidung passt zur Suche. Passe Suchwort oder Grund an.</p>
          : <div className="decision-list" aria-label="Offene Entscheidungen">{visible.map((item) => <article className="decision-item" key={item.id}>
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
          </article>)}</div>}
      </>}
  </div>;
}
