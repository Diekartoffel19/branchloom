import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bot, CircleAlert, CircleStop, Clock3, Columns3, GitBranch, Search } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { activityItems, formatDuration, type ActivityKindFilter, type ActivityStatusFilter } from '../activity-data';

interface Props { snapshot: ProjectSnapshot; onOpenCard: (id: string) => void; onOpenWorkflow: (id: string) => void }

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'nicht erfasst';
}

export function ActivityView({ snapshot, onOpenCard, onOpenWorkflow }: Props) {
  const [kind, setKind] = useState<ActivityKindFilter>('all');
  const [status, setStatus] = useState<ActivityStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  const rows = useMemo(() => activityItems(snapshot, now, kind), [snapshot, now, kind]);
  const filtered = useMemo(() => rows.filter((item) => (status === 'all' || item.status === status) && `${item.title} ${item.subtitle} ${item.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [rows, status, query]);
  const shown = filtered.slice(0, 100);
  const cardIdsWithRuns = new Set(snapshot.sessions.map((session) => session.cardId));
  const runningCount = snapshot.sessions.filter((session) => session.state === 'running').length + snapshot.workflows.filter((workflow) => workflow.state === 'running').length;
  const attentionCount = snapshot.sessions.filter((session) => session.state === 'failed' || (session.state === 'exited' && session.exitCode !== null && session.exitCode !== 0)).length + snapshot.workflows.filter((workflow) => workflow.state === 'paused' && ['approval', 'manual', 'review'].includes(workflow.pauseReason ?? '')).length;
  const stoppedCount = snapshot.sessions.filter((session) => session.state === 'stopped').length;
  const untouchedCount = snapshot.cards.filter((card) => !cardIdsWithRuns.has(card.id)).length;

  return <div className="standard-page activity-page">
    <div className="view-header"><div><div className="eyebrow">PROJEKTAKTIVITÄT</div><h2>Was gerade passiert</h2><p>Gespeicherte Agentenläufe, Workflows und Karten ohne Lauf. Zeiten stammen aus dem lokalen Projektstand.</p></div></div>
    <div className="activity-stats" aria-label="Aktivitätsübersicht"><div><Bot size={17} /><strong>{runningCount}</strong><span>Läuft</span></div><div><CircleAlert size={17} /><strong>{attentionCount}</strong><span>Handlungsbedarf</span></div><div><CircleStop size={17} /><strong>{stoppedCount}</strong><span>Gestoppt</span></div><div><Columns3 size={17} /><strong>{untouchedCount}</strong><span>Karten ohne Lauf</span></div></div>
    <div className="activity-filters"><label>Art<select value={kind} onChange={(event) => setKind(event.target.value as ActivityKindFilter)}><option value="all">Alle Aktivitäten</option><option value="session">Agentenläufe</option><option value="workflow">Workflows</option><option value="card">Karten mit letztem Lauf</option></select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ActivityStatusFilter)}><option value="all">Alle Status</option><option value="running">Läuft</option><option value="attention">Handlungsbedarf</option><option value="finished">Beendet</option><option value="stopped">Gestoppt</option><option value="paused">Pausiert</option><option value="idle">Noch nicht gestartet</option></select></label><label className="activity-search"><span className="sr-only">Aktivität durchsuchen</span><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel oder Agent suchen…" aria-label="Aktivität durchsuchen" /></label></div>
    <div className="activity-list" aria-live="polite">{shown.map((item) => { const Icon = item.kind === 'session' ? Bot : item.kind === 'workflow' ? GitBranch : Columns3; return <article className="activity-item" key={`${item.kind}:${item.id}`}><span className="activity-icon"><Icon size={18} /></span><div className="activity-main"><div className="activity-title-row"><h3>{item.title}</h3><span className={`activity-badge ${item.status}`}>{item.statusLabel}</span></div><p>{item.subtitle} · {item.detail}</p><div className="activity-meta"><span><Clock3 size={13} /> {item.kind === 'card' ? 'Letzter Lauf' : item.kind === 'session' ? 'Gestartet' : 'Aktualisiert'}: {item.kind === 'card' && item.status === 'idle' ? 'nicht erfasst' : dateTime(item.timestamp)}</span><span>Dauer: {formatDuration(item.durationMs)}</span>{item.exitCode !== null ? <span>Exit-Code: {item.exitCode}</span> : null}<span>Token: nicht erfasst</span><span>Kosten: nicht erfasst</span></div></div><button className="secondary-button small" type="button" onClick={() => item.kind === 'workflow' ? onOpenWorkflow(item.targetId) : onOpenCard(item.targetId)}><ArrowUpRight size={14} /> {item.kind === 'workflow' ? 'Zum Workflow' : 'Zur Karte'}</button></article>; })}{filtered.length === 0 ? <div className="feature-empty activity-empty"><Clock3 size={28} /><h3>{rows.length === 0 ? 'Noch keine Aktivität' : 'Keine Treffer'}</h3><p>{rows.length === 0 ? 'Starte einen Agenten auf einer Karte oder lege einen Workflow an. Hier erscheinen dann die gespeicherten Zustände.' : 'Ändere Status, Art oder Suchbegriff.'}</p></div> : null}</div>
    {filtered.length > shown.length ? <p className="activity-more">{filtered.length - shown.length} weitere Einträge. Nutze die Filter, um sie einzugrenzen.</p> : null}
  </div>;
}
