import { useEffect, useState } from 'react';
import { Bot, Check, CircleHelp, Plus, Radar, RefreshCw, Terminal } from 'lucide-react';
import type { AgentDetection, AgentPreset, ProjectSnapshot } from '../../shared/types';
import type { Mutate } from './shared';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate }
type Draft = Omit<AgentPreset, 'id'> & { id?: string; argumentsText: string };

const emptyDraft: Draft = { name: '', kind: 'codex', command: '', args: [], argumentsText: '', model: null, enabled: true };

export function AgentView({ snapshot, mutate }: Props) {
  const [detections, setDetections] = useState<AgentDetection[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  async function detect() {
    setDetecting(true); setDetectError('');
    try { setDetections(await window.studio.detectAgents()); }
    catch (reason) { setDetectError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDetecting(false); }
  }
  useEffect(() => { void detect(); }, []);

  function edit(agent: AgentPreset) { setDraft({ ...agent, argumentsText: agent.args.join('\n') }); }
  function fromDetection(detection: AgentDetection) {
    setDraft({ ...emptyDraft, name: detection.kind === 'codex' ? 'Codex' : detection.kind === 'claude' ? 'Claude Code' : detection.kind === 'gemini' ? 'Gemini CLI' : 'Eigener Agent', kind: detection.kind, command: detection.command });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const { argumentsText, ...values } = draft;
    const saved = await mutate(() => window.studio.saveAgent({ ...values, name: values.name.trim(), command: values.command.trim(), args: argumentsText.split('\n').map((line) => line.trim()).filter(Boolean), model: values.model?.trim() || null }));
    if (saved) setDraft(null);
  }

  return <div className="standard-page"><div className="view-header"><div><div className="eyebrow">CLI-LAUFZEIT</div><h2>Agenten verbinden</h2><p>Installierte CLIs erkennen, Startargumente festlegen und auf Karten einsetzen.</p></div><button className="primary-button" type="button" onClick={() => setDraft({ ...emptyDraft })}><Plus size={17} /> Agent anlegen</button></div>
    <div className="agent-grid"><section className="panel"><div className="panel-heading"><div><Radar size={18} /><h3>Erkannte CLIs</h3></div><button className="icon-button" type="button" title="Erkennung erneut starten" aria-label="Erkennung erneut starten" disabled={detecting} onClick={() => void detect()}><RefreshCw size={16} className={detecting ? 'spin' : ''} /></button></div><p className="panel-subtitle">Jarvis Studio prüft nur, ob die Programme erreichbar sind. Ein Modellaufruf startet erst mit einer Karte.</p>{detectError ? <p className="inline-error" role="alert">{detectError}</p> : null}<div className="detected-list">{detecting && detections.length === 0 ? <p className="list-empty">Suche nach CLIs…</p> : detections.map((item) => <div className="detected-item" key={item.kind}><div className="detected-icon"><Terminal size={18} /></div><div><strong>{item.kind === 'codex' ? 'Codex' : item.kind === 'claude' ? 'Claude Code' : item.kind === 'gemini' ? 'Gemini CLI' : item.kind}</strong><span>{item.available ? item.version || item.command : 'Nicht gefunden'}</span></div><span className={item.available ? 'available-badge' : 'unavailable-badge'}>{item.available ? <><Check size={12} /> Bereit</> : 'Fehlt'}</span>{item.available ? <button className="text-button" type="button" onClick={() => fromDetection(item)}>Einrichten</button> : null}</div>)}</div></section>
      <section className="panel"><div className="panel-heading"><div><Bot size={18} /><h3>Gespeicherte Agenten</h3></div><span className="count-pill">{snapshot.agents.length}</span></div><p className="panel-subtitle">Ein Agentenprofil ist eine ausführbare CLI mit festen Argumenten. Spalten und Karten können sie auswählen.</p>{snapshot.agents.length ? <div className="preset-list">{snapshot.agents.map((agent) => <button className="preset-item" type="button" key={agent.id} onClick={() => edit(agent)}><span className="preset-avatar"><Bot size={19} /></span><span><strong>{agent.name}</strong><small>{agent.kind} · {agent.command}{agent.model ? ` · ${agent.model}` : ''}</small></span><span className={agent.enabled ? 'available-badge' : 'unavailable-badge'}>{agent.enabled ? 'Aktiv' : 'Inaktiv'}</span></button>)}</div> : <div className="agent-empty"><CircleHelp size={22} /><p>Noch kein Agent gespeichert. Nutze einen erkannten CLI-Eintrag oder lege einen eigenen an.</p></div>}</section></div>
    <div className="info-strip"><CircleHelp size={18} /><p>CLI-Agenten können Dateien im Projektordner ändern und eigene Netzwerkzugriffe durchführen. Verwende nur Programme und Modelle, denen du vertraust.</p></div>
    {draft ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><form className="dialog" onSubmit={(event) => void save(event)}><div className="dialog-heading"><div><small>AGENTENPROFIL</small><h2>{draft.id ? 'Agent bearbeiten' : 'Agent anlegen'}</h2></div><button className="icon-button" type="button" onClick={() => setDraft(null)} aria-label="Schließen">×</button></div><label>Name<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft((old) => old && ({ ...old, name: event.target.value }))} placeholder="Codex" /></label><label>Typ<select value={draft.kind} onChange={(event) => setDraft((old) => old && ({ ...old, kind: event.target.value as AgentPreset['kind'] }))}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="gemini">Gemini CLI</option><option value="custom">Eigener CLI-Agent</option></select></label><label>Programm<input required value={draft.command} onChange={(event) => setDraft((old) => old && ({ ...old, command: event.target.value }))} placeholder="codex oder C:\\Pfad\\agent.exe" /></label><label>Argumente – eine Zeile pro Argument<textarea rows={4} value={draft.argumentsText} onChange={(event) => setDraft((old) => old && ({ ...old, argumentsText: event.target.value }))} placeholder="--model&#10;gpt-6.1-sol" /></label><label>Modell (optional)<input value={draft.model ?? ''} onChange={(event) => setDraft((old) => old && ({ ...old, model: event.target.value }))} placeholder="Modellkennung" /></label><label className="check-option"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((old) => old && ({ ...old, enabled: event.target.checked }))} /> Profil aktivieren</label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDraft(null)}>Abbrechen</button><button className="primary-button" type="submit">Speichern</button></div></form></div> : null}
  </div>;
}
