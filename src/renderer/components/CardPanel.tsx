import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CircleStop, Mic, MicOff, Play, Send, Terminal, X } from 'lucide-react';
import type { Card, ProjectSnapshot } from '../../shared/types';
import type { Mutate } from './shared';

interface Props { card: Card; snapshot: ProjectSnapshot; mutate: Mutate; onClose: () => void }

export function CardPanel({ card, snapshot, mutate, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [agentId, setAgentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => { setTitle(card.title); setDescription(card.description); setPrompt(''); setMessage(''); }, [card.id]);
  useEffect(() => () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  const sessions = useMemo(() => snapshot.sessions.filter((item) => item.cardId === card.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [snapshot.sessions, card.id]);
  const session = sessions[0] ?? null;
  const enabledAgents = snapshot.agents.filter((item) => item.enabled);
  const defaultAgentId = snapshot.columns.find((column) => column.id === card.columnId)?.agentId ?? enabledAgents[0]?.id ?? '';
  const chosenAgentId = agentId || defaultAgentId;

  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [session?.output]);

  async function saveCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(() => window.studio.updateCard({ id: card.id, title: title.trim(), description }));
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
    <aside className="card-drawer" aria-label={`Karte ${card.title}`}><header className="drawer-header"><div><small>KARTE · {snapshot.columns.find((column) => column.id === card.columnId)?.name}</small><h2>{card.title}</h2></div><button className="icon-button" type="button" aria-label="Karte schließen" onClick={onClose}><X size={19} /></button></header>
      <div className="drawer-content">
        <form className="stacked-form" onSubmit={(event) => void saveCard(event)}><label>Titel<input value={title} required maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label><label>Beschreibung<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ziel, Kontext und gewünschtes Ergebnis…" /></label><div className="form-row"><label>Spalte<select value={card.columnId} onChange={(event) => void mutate(() => window.studio.moveCard({ id: card.id, columnId: event.target.value }))}>{[...snapshot.columns].sort((a, b) => a.position - b.position).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="submit">Karte speichern</button></div></form>
        <div className="drawer-divider" />
        <div className="section-heading"><Bot size={19} /><h3>Agent</h3></div>
        <p className="section-copy">Starte einen CLI-Agenten im Projektordner. Seine Dateizugriffe folgen den Rechten deines Benutzerkontos.</p>
        <label className="field-label">Agent auswählen<select value={chosenAgentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Agent wählen</option>{enabledAgents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.model ? ` · ${item.model}` : ''}</option>)}</select></label>
        <label className="field-label">Auftrag<textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Was soll der Agent an dieser Karte tun?" /></label>
        <div className="agent-actions"><button className="primary-button" type="button" disabled={!chosenAgentId || session?.state === 'running'} onClick={() => void mutate(() => window.studio.startSession({ cardId: card.id, agentId: chosenAgentId, prompt: prompt.trim() || undefined }))}><Play size={16} /> Agent starten</button><button type="button" className={recording ? 'voice-button recording' : 'voice-button'} disabled={transcribing} onClick={() => recording ? recorderRef.current?.stop() : void startRecording()} title={recording ? 'Aufnahme beenden' : 'Spracheingabe'}>{recording ? <MicOff size={17} /> : <Mic size={17} />}{transcribing ? 'Transkribiere…' : recording ? 'Aufnahme beenden' : 'Sprechen'}</button></div>
        {voiceError ? <p className="inline-error" role="alert">{voiceError}</p> : null}
        {enabledAgents.length === 0 ? <p className="inline-note">Noch kein Agent eingerichtet. Unter „Agenten“ kannst du installierte CLIs erkennen und einen Startbefehl speichern.</p> : null}
        <div className="drawer-divider" />
        <div className="section-heading"><Terminal size={19} /><h3>Terminal</h3><span className={session?.state === 'running' ? 'session-state running' : 'session-state'}>{session?.state === 'running' ? 'Läuft' : session?.state === 'failed' ? 'Fehlgeschlagen' : session?.state === 'exited' ? 'Beendet' : session?.state === 'stopped' ? 'Gestoppt' : 'Kein Lauf'}</span></div>
        {session ? <><pre className="terminal-output" ref={outputRef} role="log" aria-live="polite">{session.output || 'Agent gestartet. Warte auf Ausgabe…'}</pre>{session.state === 'running' ? <div className="terminal-controls"><form onSubmit={(event) => void send(event)}><input aria-label="Nachricht an Agent" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Nachricht an Agent senden…" /><button type="submit" className="icon-button" disabled={!message.trim()} aria-label="Senden"><Send size={17} /></button></form><button type="button" className="danger-button" onClick={() => void mutate(() => window.studio.stopSession(session.id))}><CircleStop size={15} /> Stoppen</button></div> : null}<p className="run-meta">Gestartet {new Date(session.startedAt).toLocaleString('de-DE')} · {sessions.length} Lauf{sessions.length === 1 ? '' : 'e'}</p></> : <div className="terminal-empty">Noch kein Agentenlauf für diese Karte.</div>}
      </div>
    </aside>
  </div>;
}
