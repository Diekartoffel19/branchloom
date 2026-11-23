import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, ListTree, LoaderCircle } from 'lucide-react';
import type { AgentDetection, ProjectSnapshot, WorkflowAgentSettings, WorkflowProposal } from '../../shared/types';
import type { Mutate } from './shared';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate }
const emptySettings: WorkflowAgentSettings = { agentId: null, model: null, effort: null };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function ProposalPreview({ proposal, snapshot, onAccept, accepting }: {
  proposal: WorkflowProposal; snapshot: ProjectSnapshot; onAccept: () => void; accepting: boolean;
}) {
  const route = proposal.columnIds.map((id) => snapshot.columns.find((column) => column.id === id));
  return <section className="proposal-preview" aria-label="Workflow-Vorschau">
    <div className="proposal-heading"><div><span className="workflow-kicker"><ListTree size={14} /> VORSCHLAG</span><h3>{proposal.title}</h3></div><span className="state-badge">Noch nicht übernommen</span></div>
    <p>{proposal.explanation}</p>
    <div className="proposal-grid"><div><h4>Karten</h4><ol className="proposal-cards">{proposal.cards.map((card, index) => <li key={index}><strong>{card.title}</strong><span>{card.description}</span></li>)}</ol></div><div><h4>Route und Spaltenagenten</h4><div className="proposal-route">{route.map((column, index) => <span key={`${index}-${column?.id ?? 'missing'}`}><span className="route-number">{index + 1}</span><span><strong>{column?.name ?? 'Unbekannte Spalte'}</strong><small>{snapshot.agents.find((agent) => agent.id === column?.agentId)?.name ?? 'Manueller Schritt'} · {column?.autoStart ? 'Automatisch' : 'Freigabe vor Start'}</small></span>{index < route.length - 1 ? <ArrowRight size={13} /> : null}</span>)}</div></div></div>
    <div className="proposal-footer"><span>Beim Übernehmen werden Karten und ein Workflow-Entwurf angelegt. Er startet erst nach deinem Klick auf „Starten“.</span><button className="primary-button" type="button" disabled={accepting || proposal.cards.length === 0 || route.length === 0} onClick={onAccept}>{accepting ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Vorschlag übernehmen</button></div>
  </section>;
}

export function WorkflowPlanner({ snapshot, mutate }: Props) {
  const [settings, setSettings] = useState<WorkflowAgentSettings>(emptySettings);
  const [loaded, setLoaded] = useState(false);
  const [detections, setDetections] = useState<AgentDetection[]>([]);
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState<WorkflowProposal | null>(null);
  const [busy, setBusy] = useState<'save' | 'plan' | 'accept' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const currentProjectId = useRef(snapshot.project.id);
  currentProjectId.current = snapshot.project.id;

  useEffect(() => {
    let active = true;
    setLoaded(false);
    Promise.all([window.studio.workflowAgentSettings(), window.studio.detectAgents().catch(() => [])])
      .then(([saved, available]) => { if (active) { setSettings(saved); setDetections(available); setLoaded(true); } })
      .catch((reason: unknown) => { if (active) { setError(errorMessage(reason)); setLoaded(true); } });
    return () => { active = false; };
  }, []);

  useEffect(() => { setProposal(null); setNotice(''); }, [snapshot.project.id]);

  const selected = snapshot.agents.find((agent) => agent.id === settings.agentId);
  const selectedDetection = selected && detections.find((item) => item.kind === selected.kind && item.command === selected.command);
  const missingCli = selected && selectedDetection?.available === false;
  const unsupportedPlanner = selected && selected.kind !== 'codex';

  function changeSettings(next: WorkflowAgentSettings) {
    setSettings(next); setProposal(null); setNotice(''); setError('');
  }

  async function save() {
    setBusy('save'); setError(''); setNotice('');
    try {
      const saved = await window.studio.saveWorkflowAgentSettings(settings);
      setSettings(saved); setNotice('Workflow-Agent gespeichert. Diese Einstellung gilt für alle Projekte.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function plan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.enabled || unsupportedPlanner || missingCli || !request.trim()) return;
    setBusy('plan'); setError(''); setNotice(''); setProposal(null);
    const projectId = snapshot.project.id;
    try {
      const saved = await window.studio.saveWorkflowAgentSettings(settings);
      setSettings(saved);
      const result = await window.studio.proposeWorkflow({ projectId, request: request.trim() });
      if (currentProjectId.current === projectId) setProposal(result);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function accept() {
    if (!proposal) return;
    setBusy('accept'); setError(''); setNotice('');
    const created = await mutate(() => window.studio.acceptWorkflowProposal({ projectId: snapshot.project.id, proposal }));
    if (created) { setProposal(null); setRequest(''); setNotice('Der Workflow-Entwurf und seine Karten wurden im Board angelegt.'); }
    setBusy(null);
  }

  return <section className="workflow-planner panel" aria-label="Globaler Workflow-Agent">
    <div className="planner-head"><span className="planner-avatar"><Bot size={22} /></span><div><span className="workflow-kicker">GLOBALER WORKFLOW-AGENT</span><h3>Beschreibe das Ziel. Der Agent plant den Ablauf.</h3><p>Dieser Agent plant für das gewählte Projekt Karten und ihre Route. Die Spaltenagenten führen später die einzelnen Schritte aus. Du prüfst den Vorschlag, bevor etwas angelegt wird.</p></div></div>
    <div className="planner-settings">
      <label>Agent<select value={settings.agentId ?? ''} disabled={!loaded || busy !== null} onChange={(event) => changeSettings({ ...settings, agentId: event.target.value || null })}><option value="">Agent auswählen</option>{snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.enabled ? '' : ' (deaktiviert)'}</option>)}</select></label>
      <label>Modell<input value={settings.model ?? ''} disabled={!loaded || busy !== null} onChange={(event) => changeSettings({ ...settings, model: event.target.value || null })} placeholder={selected?.model || 'Standard des Agenten'} /></label>
      <label>Effort<select value={settings.effort ?? ''} disabled={!loaded || busy !== null} onChange={(event) => changeSettings({ ...settings, effort: event.target.value ? event.target.value as WorkflowAgentSettings['effort'] : null })}><option value="">CLI-Standard</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <button className="secondary-button" type="button" disabled={!loaded || busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle className="spin" size={14} /> : null} Einstellungen speichern</button>
    </div>
    {snapshot.agents.length === 0 ? <p className="planner-hint">Noch kein CLI-Agent eingerichtet. Lege im Bereich „Agenten“ zuerst ein Profil an.</p> : null}
    {selected && !selected.enabled ? <p className="inline-error" role="alert">Dieses Agentenprofil ist deaktiviert. Aktiviere es im Bereich „Agenten“.</p> : null}
    {unsupportedPlanner ? <p className="inline-error" role="alert">Die sichere, schreibgeschützte Workflow-Planung unterstützt derzeit nur Codex CLI. Andere CLI-Agenten können als Spaltenagenten arbeiten.</p> : null}
    {missingCli ? <p className="inline-error" role="alert">Die CLI für „{selected.name}“ ist auf diesem Gerät nicht installiert oder nicht erreichbar. Prüfe die Installation im Bereich „Agenten“.</p> : null}
    <form className="planner-request" onSubmit={(event) => void plan(event)}><label htmlFor="workflow-request">Was soll erledigt werden?</label><textarea id="workflow-request" rows={4} maxLength={8000} value={request} disabled={busy !== null} onChange={(event) => { setRequest(event.target.value); setProposal(null); setNotice(''); }} placeholder="Zum Beispiel: Plane die Umsetzung einer lokalen Suche mit Tests und Review." /><div className="planner-request-actions"><span>Beim Planen erhält Codex dein Ziel, den Projektnamen, Spalten mit Agent und Autostart-Status sowie das reguläre Projekt-README (maximal 12 KB). Andere Projektdateien werden nicht mitgegeben. Der Vorschlag legt noch nichts an.</span><button className="primary-button" type="submit" disabled={!loaded || busy !== null || !selected?.enabled || Boolean(unsupportedPlanner) || Boolean(missingCli) || !request.trim()}>{busy === 'plan' ? <LoaderCircle className="spin" size={15} /> : <ListTree size={15} />} Ablauf vorschlagen</button></div></form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="planner-notice" role="status">{notice}</p> : null}
    {proposal ? <ProposalPreview proposal={proposal} snapshot={snapshot} onAccept={() => void accept()} accepting={busy === 'accept'} /> : null}
  </section>;
}
