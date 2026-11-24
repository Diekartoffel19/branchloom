import { useEffect, useState } from 'react';
import type { Session } from '../../shared/types';
import type { SessionRecoveryState } from '../../shared/session-recovery';
import './session-recovery.css';

const time = (value: string) => new Date(value).toLocaleString('de-DE');

export function SessionRecoveryPanel({ session }: { session: Session }) {
  const [state, setState] = useState<SessionRecoveryState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setState(null); setError(false);
    const check = () => { void window.studio.sessionRecovery(session.id)
      .then((result) => { if (active) {
        setState((old) => old?.signal === result.signal && old.process === result.process && old.sessionState === result.sessionState
          && old.events.length === result.events.length && old.events[0]?.observedAt === result.events[0]?.observedAt ? old : result);
        setError(false);
      } })
      .catch(() => { if (active) { setState(null); setError(true); } }); };
    check();
    const timer = window.setInterval(check, 5_000);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', check); window.removeEventListener('offline', check); };
  }, [session.id]);

  return <section className="session-recovery" aria-label="Verbindung und Wiederaufnahme" aria-live="polite">
    <strong>Verbindung und Wiederaufnahme</strong>
    {error ? <p role="alert">Netz- und Prozessstatus konnten gerade nicht gelesen werden. Der gespeicherte Terminalverlauf bleibt erhalten.</p> : null}
    {!state && !error ? <p>Netz- und Prozessstatus werden geprüft…</p> : null}
    {state ? <SessionRecoveryDetails state={state} /> : null}
  </section>;
}

export function SessionRecoveryDetails({ state }: { state: SessionRecoveryState }) {
  return <>
      <p>{state.signal === 'offline' ? 'Gerät meldet offline.' : 'Gerät meldet online.'} Das Signal bestätigt keine Verbindung zum Modellanbieter.</p>
      <p>{state.process === 'attached' ? 'Der lokale PTY ist noch an Branchloom gebunden; der bisherige Lauf bleibt derselbe.'
        : state.process === 'interrupted' ? 'Nach App-Neustart ist der frühere PTY nicht mehr an Branchloom gebunden. Prüfe Verlauf und Dateien vor einem neuen Start.'
          : state.process === 'unconfirmed' ? 'Die Datenbank meldet einen Lauf, aber ein lokaler PTY ist nicht belegt. Starte nichts erneut, bevor du den Zustand geprüft hast.'
            : state.sessionState === 'failed' ? 'Der Lauf ist mit Fehler beendet. Ob CLI, Modellanbieter oder Prozess die Ursache war, zeigt nur der gespeicherte Terminalverlauf.'
              : state.sessionState === 'stopped' ? 'Für diesen Lauf wurde Stoppen angefordert. Prüfe den Terminalbeleg für das Prozessende.'
                : 'Dieser Lauf ist beendet. Sein gespeicherter Verlauf bleibt lesbar.'}</p>
      {state.signal === 'offline' ? <p>Automatische Workflow-Schritte und die Warteschlange werden pausiert. Ein bereits laufender PTY wird nicht automatisch gestoppt.</p> : null}
      {state.events.length ? <details><summary>Netzbeobachtungen ({state.events.length})</summary><ol>{state.events.slice(0, 6).map((event, index) => <li key={`${event.observedAt}-${index}`}><time dateTime={event.observedAt}>{time(event.observedAt)}</time> · {event.signal === 'offline' ? 'offline' : 'online'}</li>)}</ol></details> : <p>Für diesen Lauf ist noch kein Netzwechsel gespeichert.</p>}
    </>;
}
