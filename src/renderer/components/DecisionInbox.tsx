import { ArrowRight, Inbox } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { decisionItems } from '../decision-inbox';
import '../decision-inbox.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenWorkflow: (id: string) => void;
  onOpenQueue: () => void;
}

export function DecisionInbox({ snapshot, onOpenWorkflow, onOpenQueue }: Props) {
  const items = decisionItems(snapshot);
  return <div className="standard-page decision-page">
    <div className="view-header"><div><h2>Offene Entscheidungen</h2><p>Freigaben und Pausen aus dem aktiven Projekt. Öffne den Ablauf und prüfe den gespeicherten Stand, bevor du ihn fortsetzt.</p></div></div>
    {items.length === 0 ? <div className="decision-empty"><Inbox size={24} aria-hidden="true" /><h3>Keine offenen Entscheidungen</h3><p>Hier erscheinen pausierte Workflows und die angehaltene Warteschlange, sobald sie deine Prüfung benötigen.</p></div>
      : <div className="decision-list" aria-label="Offene Entscheidungen">{items.map((item) => <article className="decision-item" key={item.id}>
        <div className="decision-item-body"><span className="decision-kind">{item.kind === 'queue' ? 'Warteschlange' : 'Workflow'}</span><h3>{item.title}</h3><p>{item.reason}</p>{item.context ? <p className="decision-context">{item.context}</p> : null}</div>
        <button className="secondary-button" type="button" onClick={() => { if (item.kind === 'queue') onOpenQueue(); else if (item.workflowId) onOpenWorkflow(item.workflowId); }}>{item.kind === 'queue' ? 'Zur Warteschlange' : 'Zum Workflow'} <ArrowRight size={15} aria-hidden="true" /></button>
      </article>)}</div>}
  </div>;
}
