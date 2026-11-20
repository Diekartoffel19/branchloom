import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitBranch, Pause, Play, Plus, ShieldCheck } from 'lucide-react';
import type { ProjectSnapshot, Workflow, WorkflowStep } from '../../shared/types';
import type { Mutate } from './shared';
import { WorkflowPlanner } from './WorkflowPlanner';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openWorkflow?: { id: string; token: number } | null }

export function workflowPauseCopy(reason: Workflow['pauseReason']): { description: string; action: string } {
  if (reason === 'approval') return { description: 'Freigabe erforderlich: Der nächste Schritt startet erst nach deiner Bestätigung.', action: 'Schritt freigeben' };
  if (reason === 'manual') return { description: 'Der agentenlose Schritt wurde verschoben und wartet auf deine Bestätigung.', action: 'Schritt abschließen' };
  if (reason === 'review') return { description: 'Ein Agentenlauf muss geprüft werden. Öffne die betroffene Karte, bevor du diesen Schritt erneut startest.', action: 'Schritt erneut starten' };
  return { description: 'Der Workflow ist pausiert. Du kannst ihn fortsetzen.', action: 'Fortsetzen' };
}

export function WorkflowView({ snapshot, mutate, openWorkflow }: Props) {
  const columns = useMemo(() => [...snapshot.columns].sort((a, b) => a.position - b.position), [snapshot.columns]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [stepIds, setStepIds] = useState<string[]>([]);
  const [approvalIds, setApprovalIds] = useState<string[]>([]);
  const [agentByColumn, setAgentByColumn] = useState<Record<string, string>>({});

  useEffect(() => { if (openWorkflow) document.getElementById(`workflow-${openWorkflow.id}`)?.scrollIntoView({ block: 'center' }); }, [openWorkflow?.id, openWorkflow?.token, snapshot.project.id]);

  function toggle(id: string, values: string[], update: (next: string[]) => void) {
    update(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const steps: WorkflowStep[] = columns.filter((column) => stepIds.includes(column.id)).map((column) => ({
      id: crypto.randomUUID(), columnId: column.id, agentId: agentByColumn[column.id] || column.agentId || null,
      requireApproval: approvalIds.includes(column.id),
    }));
    const created = await mutate(() => window.studio.createWorkflow({ projectId: snapshot.project.id, name: name.trim(), cardIds, steps }));
    if (created) { setShowForm(false); setName(''); setCardIds([]); setStepIds([]); setApprovalIds([]); setAgentByColumn({}); }
  }

  return <div className="standard-page">
    <div className="view-header"><div><div className="eyebrow">AUTOMATION</div><h2>Workflows</h2><p>Beschreibe dein Ziel dem globalen Workflow-Agenten oder lege einen Ablauf selbst an.</p></div><button className="secondary-button" type="button" onClick={() => setShowForm(true)}><Plus size={17} /> Manuell anlegen</button></div>

    <WorkflowPlanner snapshot={snapshot} mutate={mutate} />

    <div className="workflow-list-heading"><h3>Gespeicherte Workflows</h3><span>{snapshot.workflows.length}</span></div>
    {snapshot.workflows.length === 0 ? <div className="feature-empty"><GitBranch size={30} /><h3>Noch kein Workflow</h3><p>Plane einen Ablauf mit dem Workflow-Agenten oder lege Karten und Schritte manuell fest.</p><button className="secondary-button" type="button" onClick={() => setShowForm(true)}>Manuell anlegen</button></div> : <div className="workflow-list">{[...snapshot.workflows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((workflow) => <article className={openWorkflow?.id === workflow.id ? 'workflow-card search-target' : 'workflow-card'} id={`workflow-${workflow.id}`} key={workflow.id}><div className="workflow-card-top"><div><span className="workflow-kicker"><GitBranch size={14} /> WORKFLOW</span><h3>{workflow.name}</h3><p>{workflow.cardIds.length} Karten · {workflow.steps.length} Schritte</p></div><span className={`state-badge ${workflow.state}`}>{workflow.state === 'running' ? 'Läuft' : workflow.state === 'paused' ? 'Pausiert' : workflow.state === 'done' ? 'Fertig' : 'Entwurf'}</span></div><div className="workflow-route">{workflow.steps.map((step, index) => <div className={index === workflow.currentStep && workflow.state === 'running' ? 'route-step current' : 'route-step'} key={step.id}><span className="route-number">{index + 1}</span><span><strong>{columns.find((column) => column.id === step.columnId)?.name ?? 'Entfernte Spalte'}</strong><small>{snapshot.agents.find((agent) => agent.id === step.agentId)?.name ?? 'Kein Agent'}{step.requireApproval ? ' · Freigabe' : ''}</small></span>{index < workflow.steps.length - 1 ? <ArrowRight size={16} /> : null}</div>)}</div><div className="workflow-actions"><span>{workflow.state === 'paused' ? workflowPauseCopy(workflow.pauseReason).description : workflow.state === 'draft' ? 'Bereit für den ersten Start.' : workflow.state === 'running' ? `Schritt ${Math.min(workflow.currentStep + 1, workflow.steps.length)} von ${workflow.steps.length}` : 'Alle Schritte abgeschlossen.'}</span>{workflow.state === 'running' ? <button className="secondary-button small" type="button" onClick={() => void mutate(() => window.studio.setWorkflowState({ id: workflow.id, state: 'paused' }))}><Pause size={14} /> Pausieren</button> : workflow.state === 'draft' || workflow.state === 'paused' ? <button className="primary-button small" type="button" onClick={() => void mutate(() => window.studio.setWorkflowState({ id: workflow.id, state: 'running' }))}><Play size={14} /> {workflow.state === 'paused' ? workflowPauseCopy(workflow.pauseReason).action : 'Starten'}</button> : null}</div></article>)}</div>}

    {showForm ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="dialog wide" onSubmit={(event) => void create(event)}><div className="dialog-heading"><div><small>NEUER ABLAUF</small><h2>Workflow erstellen</h2></div><button className="icon-button" type="button" onClick={() => setShowForm(false)} aria-label="Schließen">×</button></div><label>Name<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Zum Beispiel: Implementieren und prüfen" /></label><div className="form-section"><strong>Karten</strong><p>Wähle mindestens eine Karte für diesen Ablauf.</p><div className="option-grid">{snapshot.cards.length ? snapshot.cards.map((card) => <label className="check-option" key={card.id}><input type="checkbox" checked={cardIds.includes(card.id)} onChange={() => toggle(card.id, cardIds, setCardIds)} /><span>{card.title}</span></label>) : <span className="field-help">Lege zuerst eine Karte im Board an.</span>}</div></div><div className="form-section"><strong>Schritte in Board-Reihenfolge</strong><p>Wähle Spalten, Agenten und optionale Freigaben. Ein Schritt ohne Agent bleibt manuell.</p><div className="step-form-list">{columns.map((column) => <div className="step-form" key={column.id}><label className="step-main"><input type="checkbox" checked={stepIds.includes(column.id)} onChange={() => toggle(column.id, stepIds, setStepIds)} /> <span>{column.name}</span></label><select aria-label={`Agent für ${column.name}`} value={agentByColumn[column.id] ?? column.agentId ?? ''} disabled={!stepIds.includes(column.id)} onChange={(event) => setAgentByColumn((old) => ({ ...old, [column.id]: event.target.value }))}><option value="">Manuell</option>{snapshot.agents.filter((agent) => agent.enabled).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><label className="approval-check"><input type="checkbox" checked={approvalIds.includes(column.id)} disabled={!stepIds.includes(column.id)} onChange={() => toggle(column.id, approvalIds, setApprovalIds)} /><ShieldCheck size={14} /> Freigabe</label></div>)}</div></div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Abbrechen</button><button className="primary-button" type="submit" disabled={cardIds.length === 0 || stepIds.length === 0}>Workflow anlegen</button></div></form></div> : null}
  </div>;
}
