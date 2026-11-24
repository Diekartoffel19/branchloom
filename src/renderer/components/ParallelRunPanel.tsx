import { useEffect, useState } from 'react';
import type { CardRunGate } from '../../shared/parallel-runs';
import type { Card } from '../../shared/types';
import type { Mutate } from './shared';

export function ParallelRunPanel({ card, mutate, onGate }: { card: Card; mutate: Mutate; onGate: (gate: CardRunGate | null) => void }) {
  const [gate, setGate] = useState<CardRunGate | null>(null);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await window.studio.cardRunGate(card.id);
        if (active) { setGate(next); onGate(next); setError(''); }
      } catch (reason) {
        if (active) { setGate(null); onGate(null); setError(reason instanceof Error ? reason.message : String(reason)); }
      }
    };
    setGate(null); onGate(null); setReportId(''); setNote('');
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [card.id, onGate]);

  async function changeCapacity(capacity: number) {
    setBusy(true); setError('');
    try {
      const updated = await mutate(() => window.studio.setProjectRunCapacity({ projectId: card.projectId, capacity }));
      if (updated !== null) { const next = await window.studio.cardRunGate(card.id); setGate(next); onGate(next); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const next = await mutate(() => window.studio.approveCardDependency({ cardId: card.id, qaReportId: reportId, note }));
      if (next) { setGate(next); onGate(next); setNote(''); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <section className="stacked-form" aria-label="Parallele Kartenläufe">
    <div className="section-heading"><h3>Parallele Läufe</h3></div>
    {gate ? <>
      <label className="field-label">Agenten gleichzeitig im Projekt
        <select value={gate.capacity} disabled={busy} onChange={(event) => void changeCapacity(Number(event.target.value))}>
          {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <p className="run-meta" role="status">{gate.runningCount} von {gate.capacity} Plätzen belegt.</p>
      {gate.running.length ? <ul>{gate.running.map((run) => <li key={run.sessionId}>{run.title} · {run.worktreePath ? 'eigener Worktree' : 'Projektordner'}</li>)}</ul> : null}
      {gate.dependency ? <div className="inline-note">
        <strong>Vorgänger: {gate.dependency.prerequisiteTitle}</strong><br />
        {gate.dependency.status === 'workflow' ? 'Durch erfolgreich abgeschlossenen Workflow-Schritt belegt.' : gate.dependency.status === 'approved' ? `Mit QA-Bericht freigegeben. ${gate.dependency.approvalNote}` : 'Noch kein belegtes Ergebnis oder bewusste QA-Freigabe.'}
      </div> : null}
      {gate.dependency?.status === 'blocked' && gate.dependency.reports.length ? <form className="stacked-form" onSubmit={(event) => void approve(event)}>
        <label className="field-label">Bestandenen QA-Bericht auswählen<select required value={reportId} onChange={(event) => setReportId(event.target.value)}><option value="">Bericht wählen</option>{gate.dependency.reports.map((report) => <option key={report.id} value={report.id}>{new Date(report.endedAt).toLocaleString('de-DE')} · {report.id.slice(0, 8)}</option>)}</select></label>
        <label className="field-label">Warum darf die nächste Karte starten?<textarea required minLength={10} maxLength={1000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="secondary-button" type="submit" disabled={busy || !reportId || note.trim().length < 10}>Vorgänger bewusst freigeben</button>
      </form> : null}
      {gate.blockers.map((blocker) => <p className="inline-note" key={blocker}>{blocker}</p>)}
      <p className="field-help">Parallele Agenten brauchen getrennte Git-Worktrees. Eine Freigabe startet keinen Agenten.</p>
    </> : <p role="status" className="inline-note">Startbedingungen werden geprüft…</p>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
