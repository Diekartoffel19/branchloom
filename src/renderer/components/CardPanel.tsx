import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Bot, CircleStop, Mic, MicOff, Play, RotateCcw, Send, Terminal, X } from 'lucide-react';
import type { Card, CardPriority, ProjectSnapshot, WorktreeReview } from '../../shared/types';
import type { ConflictRadarResult } from '../../shared/conflict-radar';
import { CARD_PRIORITIES } from '../../shared/card-metadata';
import type { Mutate } from './shared';
import { CardAttachments } from './CardAttachments';
import { ConflictRadarNotice } from './ConflictRadarNotice';

const SessionTerminal = lazy(() => import('./SessionTerminal').then((module) => ({ default: module.SessionTerminal })));

interface Props { card: Card; snapshot: ProjectSnapshot; mutate: Mutate; onClose: () => void }

export function CardPanel({ card, snapshot, mutate, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState<CardPriority>(card.priority);
  const [labelsInput, setLabelsInput] = useState(card.labels.join(', '));
  const [agentId, setAgentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [worktreeReview, setWorktreeReview] = useState<WorktreeReview | null | undefined>(undefined);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState('');
  const [conflictRadar, setConflictRadar] = useState<ConflictRadarResult | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { setTitle(card.title); setDescription(card.description); setPriority(card.priority); setLabelsInput(card.labels.join(', ')); setPrompt(''); setMessage(''); setUseWorktree(false); setWorktreeReview(undefined); setWorktreeError(''); setConflictRadar(null); setConflictError(''); }, [card.id]);
  useEffect(() => () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  const sessions = useMemo(() => snapshot.sessions.filter((item) => item.cardId === card.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [snapshot.sessions, card.id]);
  const session = sessions[0] ?? null;
  useEffect(() => { setConflictRadar(null); }, [session?.id]);
  const sessionAgent = session ? snapshot.agents.find((item) => item.id === session.agentId) : null;
  const enabledAgents = snapshot.agents.filter((item) => item.enabled);
  const defaultAgentId = snapshot.columns.find((column) => column.id === card.columnId)?.agentId ?? enabledAgents[0]?.id ?? '';
  const chosenAgentId = agentId || defaultAgentId;


  async function saveCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (card.archivedAt) return;
    await mutate(() => window.studio.updateCard({ id: card.id, title: title.trim(), description, priority, labels: labelsInput.split(',').map((item) => item.trim()).filter(Boolean) }));
  }

  async function reviewWorktree() {
    setWorktreeBusy(true); setWorktreeError('');
    try { setWorktreeReview(await window.studio.reviewCardWorktree(card.id)); }
    catch (reason) { setWorktreeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorktreeBusy(false); }
  }

  async function reviewConflicts() {
    setConflictBusy(true); setConflictError(''); setConflictRadar(null);
    try { setConflictRadar(await window.studio.reviewCardConflicts(card.id)); }
    catch (reason) { setConflictError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setConflictBusy(false); }
  }

  async function mergeWorktree() {
    if (!worktreeReview?.canFastForward) return;
    if (!window.confirm(`Die ${worktreeReview.ahead} committeten Änderung(en) aus ${worktreeReview.branch} per Fast-Forward in ${worktreeReview.targetBranch} übernehmen? Der Worktree bleibt erhalten.`)) return;
    setWorktreeBusy(true); setWorktreeError('');
    try {
      const merged = await window.studio.mergeCardWorktree({ cardId: card.id, previewToken: worktreeReview.previewToken, confirm: true });
      setWorktreeReview(merged);
    } catch (reason) { setWorktreeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorktreeBusy(false); }
  }

  async function changeArchive(archived: boolean) {
    if (archived && !window.confirm(`„${card.title}“ archivieren? Die Karte bleibt erhalten und kann wiederhergestellt werden.`)) return;
    setArchiveBusy(true); setArchiveError('');
    const changed = await mutate(async () => {
      try { return await window.studio.setCardArchived({ id: card.id, archived }); }
      catch (reason) { setArchiveError(reason instanceof Error ? reason.message : String(reason)); throw reason; }
    });
    setArchiveBusy(false);
    if (changed) onClose();
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !message.trim()) return;
    const sent = await mutate(() => window.studio.sendSession({ sessionId: session.id, text: message.trim() }));
    if (sent !== null) setMessage('');
  }

  async function startRecording() {
    setVoiceError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Dieses System unterstützt die Mikrofonaufnahme nicht.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => setVoiceError('Die Aufnahme ist fehlgeschlagen.');
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        if (chunks.length === 0) { setVoiceError('Die Aufnahme ist leer.'); return; }
        setTranscribing(true);
        try {
          const audio = new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
          const text = await window.studio.transcribe(audio);
          setPrompt((old) => [old.trim(), text.trim()].filter(Boolean).join(' '));
        } catch (reason) {
          setVoiceError(reason instanceof Error ? reason.message : String(reason));
        } finally { setTranscribing(false); }
      };
      recorder.start(250);
      setRecording(true);
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setVoiceError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="card-drawer" aria-label={`Karte ${card.title}`}><header className="drawer-header"><div><small>KARTE · {snapshot.columns.find((column) => column.id === card.columnId)?.name}{card.archivedAt ? ' · ARCHIVIERT' : ''}</small><h2>{card.title}</h2></div><button className="icon-button" type="button" aria-label="Karte schließen" onClick={onClose}><X size={19} /></button></header>
      <div className="drawer-content">
        <form className="stacked-form" onSubmit={(event) => void saveCard(event)}><fieldset className="archive-fieldset" disabled={Boolean(card.archivedAt)}>
          <label>Titel<input value={title} required maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Beschreibung<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ziel, Kontext und gewünschtes Ergebnis…" /></label>
          <div className="card-metadata-fields">
            <label>Priorität<select value={priority} onChange={(event) => setPriority(event.target.value as CardPriority)}>{CARD_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label>Labels, mit Komma getrennt<input value={labelsInput} maxLength={500} onChange={(event) => setLabelsInput(event.target.value)} placeholder="z. B. Planung, Bug" /><small>Bis zu 12 Labels mit je 32 Zeichen.</small></label>
          </div>
          <div className="form-row"><label>Spalte<select value={card.columnId} onChange={(event) => void mutate(() => window.studio.moveCard({ id: card.id, columnId: event.target.value }))}>{[...snapshot.columns].sort((a, b) => a.position - b.position).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="submit">Karte speichern</button></div>
        </fieldset></form>
        <div className="archive-controls">{card.archivedAt ? <><p>Archiviert am {new Date(card.archivedAt).toLocaleString('de-DE')}. Verlauf und Daten bleiben erhalten.</p><button className="secondary-button" type="button" disabled={archiveBusy} onClick={() => void changeArchive(false)}><RotateCcw size={15} /> Wiederherstellen</button></> : <button className="text-button archive-action" type="button" disabled={archiveBusy} onClick={() => void changeArchive(true)}><Archive size={15} /> Karte archivieren</button>}</div>
        {archiveError ? <p className="inline-error" role="alert">{archiveError}</p> : null}
        <div className="drawer-divider" />
        <CardAttachments key={card.id} card={card} />
        <div className="drawer-divider" />
        <div className="section-heading"><Bot size={19} /><h3>Agent</h3></div>
        <p className="section-copy">{card.archivedAt ? 'Diese Karte ist archiviert. Stelle sie wieder her, bevor ein Agent weiterarbeitet.' : 'Starte einen CLI-Agenten im Projektordner. Seine Dateizugriffe folgen den Rechten deines Benutzerkontos.'}</p>
        <label className="field-label">Agent auswählen<select value={chosenAgentId} disabled={Boolean(card.archivedAt)} onChange={(event) => setAgentId(event.target.value)}><option value="">Agent wählen</option>{enabledAgents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.model ? ` · ${item.model}` : ''}</option>)}</select></label>
        <label className="field-label">Auftrag<textarea rows={4} value={prompt} disabled={Boolean(card.archivedAt)} onChange={(event) => setPrompt(event.target.value)} placeholder="Was soll der Agent an dieser Karte tun?" /></label>
        <label className="field-label"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={useWorktree} disabled={Boolean(card.archivedAt)} onChange={(event) => setUseWorktree(event.target.checked)} /> Isolierten Git-Worktree für diese Sitzung verwenden</span></label>
        <div className="agent-actions"><button className="primary-button" type="button" disabled={Boolean(card.archivedAt) || !chosenAgentId || session?.state === 'running'} onClick={() => void mutate(() => window.studio.startSession({ cardId: card.id, agentId: chosenAgentId, prompt: prompt.trim() || undefined, useWorktree }))}><Play size={16} /> Agent starten</button><button type="button" className={recording ? 'voice-button recording' : 'voice-button'} disabled={Boolean(card.archivedAt) || transcribing} onClick={() => recording ? recorderRef.current?.stop() : void startRecording()} title={recording ? 'Aufnahme beenden' : 'Spracheingabe'}>{recording ? <MicOff size={17} /> : <Mic size={17} />}{transcribing ? 'Transkribiere…' : recording ? 'Aufnahme beenden' : 'Sprechen'}</button></div>
        {voiceError ? <p className="inline-error" role="alert">{voiceError}</p> : null}
        {enabledAgents.length === 0 ? <p className="inline-note">Noch kein Agent eingerichtet. Unter „Agenten“ kannst du installierte CLIs erkennen und einen Startbefehl speichern.</p> : null}
        <div className="drawer-divider" />
        <div className="section-heading"><Terminal size={19} /><h3>Terminal</h3><span className={session?.state === 'running' ? 'session-state running' : 'session-state'}>{session?.state === 'running' ? 'Läuft' : session?.state === 'failed' ? 'Fehlgeschlagen' : session?.state === 'exited' ? 'Beendet' : session?.state === 'stopped' ? 'Gestoppt' : 'Kein Lauf'}</span></div>
        {session ? <>
          <Suspense fallback={<div className="terminal-empty">Terminal wird geladen…</div>}><SessionTerminal key={session.id} session={session} /></Suspense>
          {session.state === 'running' ? <div className="terminal-controls"><form onSubmit={(event) => void send(event)}><input aria-label="Nachricht an Agent" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Nachricht an Agent senden…" /><button type="submit" className="icon-button" disabled={!message.trim()} aria-label="Senden"><Send size={17} /></button></form><button type="button" className="danger-button" onClick={() => void mutate(() => window.studio.stopSession(session.id))}><CircleStop size={15} /> Stoppen</button></div> : null}
          {sessionAgent?.kind === 'codex' && session.state !== 'running' && !card.archivedAt ? <div className="resume-controls"><p className="section-copy">Codex zeigt gespeicherte Gespräche aus diesem Ordner. Wähle das richtige Gespräch im Terminal aus; Studio wiederholt den alten Auftrag nicht automatisch.</p><button className="secondary-button" type="button" disabled={snapshot.queue.state === 'running'} onClick={() => void mutate(() => window.studio.resumeCodexSession({ sessionId: session.id }))}><RotateCcw size={15} /> Codex-Gespräch auswählen</button>{snapshot.queue.state === 'running' ? <p className="inline-note">Projektwarteschlange zuerst pausieren.</p> : null}</div> : null}
          {session.worktreePath ? <p className="run-meta">Git-Worktree: <code>{session.worktreePath}</code>. Änderungen bleiben dort nach dem Stoppen erhalten.</p> : null}<p className="run-meta">Gestartet {new Date(session.startedAt).toLocaleString('de-DE')} · {sessions.length} Lauf{sessions.length === 1 ? '' : 'e'}</p>
        </> : <div className="terminal-empty">Noch kein Agentenlauf für diese Karte.</div>}
        <div className="drawer-divider" />
        <div className="section-heading"><h3>Git-Worktree prüfen</h3></div>
        <p className="section-copy">Status und Änderungsumfang lokal prüfen. Die App übernimmt nur committete Änderungen per Fast-Forward; bei divergierten Branches bleibt alles unangetastet.</p>
        <div className="agent-actions"><button className="secondary-button" type="button" disabled={worktreeBusy} onClick={() => void reviewWorktree()}>{worktreeBusy ? 'Prüfe…' : 'Git-Stand prüfen'}</button><button className="secondary-button" type="button" disabled={conflictBusy} onClick={() => void reviewConflicts()}>{conflictBusy ? 'Prüfe…' : 'Parallele Änderungen prüfen'}</button></div>
        {worktreeError ? <p className="inline-error" role="alert">{worktreeError}</p> : null}
        {conflictError ? <p className="inline-error" role="alert">Konflikt-Radar: {conflictError}</p> : null}
        {conflictRadar ? <ConflictRadarNotice result={conflictRadar} /> : null}
        {worktreeReview === null ? <p className="inline-note">Für diese Karte gibt es noch keinen Git-Worktree.</p> : null}
        {worktreeReview ? <div className="stacked-form"><p className="section-copy"><strong>{worktreeReview.branch}</strong><br />Worktree: <code>{worktreeReview.path}</code><br />Ziel: <code>{worktreeReview.targetPath}</code> ({worktreeReview.targetBranch ?? 'detached'})<br />Commits: {worktreeReview.ahead} voraus, {worktreeReview.behind} zurück.</p>
          {worktreeReview.sourceStatus.length ? <><strong>Nicht committiert im Worktree</strong><pre className="terminal-output">{worktreeReview.sourceStatus.join('\n')}</pre></> : <p className="section-copy">Worktree-Arbeitsbaum sauber.</p>}
          {worktreeReview.targetStatus.length ? <><strong>Nicht committiert im Ziel</strong><pre className="terminal-output">{worktreeReview.targetStatus.join('\n')}</pre></> : null}
          {worktreeReview.uncommittedStat ? <><strong>Uncommitteter Diff-Stat</strong><pre className="terminal-output">{worktreeReview.uncommittedStat}</pre></> : null}
          {worktreeReview.committedStat ? <><strong>Committeter Diff-Stat</strong><pre className="terminal-output">{worktreeReview.committedStat}</pre></> : null}
          {worktreeReview.blockers.length ? <p className="inline-note">Merge gesperrt: {worktreeReview.blockers.join(' ')}</p> : null}
          <button className="primary-button" type="button" disabled={worktreeBusy || !worktreeReview.canFastForward} onClick={() => void mergeWorktree()}>Fast-Forward bestätigt übernehmen</button>
        </div> : null}
      </div>
    </aside>
  </div>;
}
