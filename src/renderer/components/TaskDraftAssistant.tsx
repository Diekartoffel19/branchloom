import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, X } from 'lucide-react';
import type { Card, ProjectSnapshot } from '../../shared/types';
import type { DraftTurn, TaskDraftReply } from '../../shared/task-draft';
import type { Mutate } from './shared';
import './task-draft-assistant.css';

interface Props {
  snapshot: ProjectSnapshot;
  mutate: Mutate;
  onClose: () => void;
  onCreated: (card: Card) => void;
}

export function TaskDraftAssistant({ snapshot, mutate, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [turns, setTurns] = useState<DraftTurn[]>([]);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState<TaskDraftReply | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(snapshot.columns.find((item) => item.name.toLocaleLowerCase() === 'to do')?.id ?? snapshot.columns[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); }, []);
  useEffect(() => { if (busy) dialogRef.current?.focus(); }, [busy]);

  function dialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])') ?? [])];
    if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim()) return;
    const next = [...turns.slice(-10), { role: 'user' as const, text: message.trim() }];
    while (next.length > 1 && next.reduce((size, turn) => size + turn.text.length, 0) > 16_000) next.shift();
    setBusy(true); setError('');
    try {
      const answer = await window.studio.discussTaskDraft({ projectId: snapshot.project.id, turns: next });
      setTurns([...next, { role: 'assistant', text: answer.reply }]);
      setReply(answer);
      setTitle(answer.specTitle);
      setDescription(answer.specDescription);
      setMessage('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !reply?.ready || !title.trim() || !description.trim() || !columnId) return;
    setBusy(true); setError('');
    try {
      const card = await mutate(() => window.studio.createCard({ projectId: snapshot.project.id, columnId, title: title.trim(), description: description.trim() }));
      if (card) onCreated(card);
      else setError('Die Karte konnte nicht erstellt werden. Schließe das Fenster, um die genaue Fehlermeldung im Board zu sehen.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  return <div className="drawer-backdrop task-draft-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="task-draft-panel" role="dialog" aria-modal="true" aria-label="Aufgabe besprechen" aria-busy={busy} tabIndex={-1} onKeyDown={dialogKeyDown}>
      <header className="drawer-header"><div><small>BOARD · AUFGABENKLÄRUNG</small><h2>Aufgabe besprechen</h2></div><button type="button" className="icon-button" aria-label="Schließen" disabled={busy} onClick={onClose}><X size={19} /></button></header>
      <div className="task-draft-content">
        <p className="section-copy">Beim Klick auf „Besprechen“ erhält der eingestellte Codex-Agent dein Gespräch, Projektname und Spalten, bis zu 30 aktive Kartentitel sowie das reguläre Projekt-README (maximal 12 KB). Andere Projektdateien werden hier nicht mitgegeben. Eine Karte entsteht erst nach deinem Klick auf „Karte erstellen“.</p>
        <div className="task-draft-turns" aria-live="polite">{turns.length === 0 ? <p className="inline-note">Was soll geändert oder gebaut werden? Beschreibe das Ziel in deinen Worten.</p> : turns.map((turn, index) => <div className={`task-draft-turn ${turn.role}`} key={index}><strong>{turn.role === 'user' ? 'Du' : 'Agent'}</strong><p>{turn.text}</p></div>)}</div>
        <form className="task-draft-ask" onSubmit={(event) => void ask(event)}><label>Deine Nachricht<textarea autoFocus rows={3} maxLength={4_000} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder="Zum Beispiel: Die Karten brauchen eine bessere Review-Vorschau …" /></label><button className="secondary-button" type="submit" disabled={busy || !message.trim()}><Bot size={16} /> {busy ? 'Prüfe Projekt…' : 'Besprechen'}</button></form>
        {reply?.ready ? <form className="task-draft-spec" onSubmit={(event) => void create(event)}><h3>Editierbarer Kartenvorschlag</h3><label>Titel<input value={title} maxLength={160} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label><label>Beschreibung<textarea rows={8} maxLength={8_000} required disabled={busy} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Spalte<select value={columnId} disabled={busy} onChange={(event) => setColumnId(event.target.value)}>{snapshot.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="primary-button" type="submit" disabled={busy || !title.trim() || !description.trim() || !columnId}>Karte erstellen <ArrowRight size={16} /></button></form> : null}
        {error ? <p role="alert" className="inline-error">{error}</p> : null}
      </div>
    </section>
  </div>;
}
