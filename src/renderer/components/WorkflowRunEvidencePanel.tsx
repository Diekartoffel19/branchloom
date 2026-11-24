import { useEffect, useRef, useState } from 'react';
import type { Column, SessionState, Workflow } from '../../shared/types';
import type { WorkflowRunEvidence, WorkflowProgressState } from '../../shared/workflow-evidence';
import './workflow-run-evidence.css';

const progressLabels: Record<WorkflowProgressState, string> = {
  pending: 'Ausstehend',
  running: 'Läuft',
  complete: 'Schritt abgeschlossen',
  needs_review: 'Prüfung nötig',
  manual_wait: 'Manuelle Bestätigung',
};
const sessionLabels: Record<SessionState, string> = {
  running: 'läuft', exited: 'beendet', failed: 'fehlgeschlagen', stopped: 'gestoppt',
};

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function WorkflowEvidenceRows({ evidence, workflow, columns, onOpenCard, onOpenSession }: {
  evidence: WorkflowRunEvidence;
  workflow: Workflow;
  columns: Column[];
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  if (!evidence.rows.length) return <p>Noch kein Schrittfortschritt gespeichert.</p>;
  return <>
    <ol className="workflow-evidence-list">{evidence.rows.map((row) => {
      const step = workflow.steps[row.stepIndex];
      const column = columns.find((item) => item.id === step?.columnId);
      return <li key={`${row.stepIndex}:${row.cardId}`}>
        <div className="workflow-evidence-row-head"><strong>Schritt {row.stepIndex + 1} · {column?.name ?? 'Entfernte Spalte'}</strong><span>{progressLabels[row.state] ?? 'Unbekannter Zustand'}</span></div>
        <p>{row.cardTitle ?? 'Entfernte Karte'}</p>
        {row.session ? <p>{row.session.agentName} · Sitzung {sessionLabels[row.session.state] ?? 'unbekannt'} · Exit-Code: {row.session.exitCode ?? 'nicht erfasst'}</p>
          : row.missingSession ? <p>Verknüpfte Sitzung nicht verfügbar.</p>
            : <p>Für diesen Fortschritt ist keine Sitzung gespeichert.</p>}
        <div className="workflow-evidence-links">
          {row.cardTitle && onOpenCard ? <button className="secondary-button small" type="button" onClick={() => onOpenCard(row.cardId)}>Karte öffnen</button> : null}
          {row.session && onOpenSession ? <button className="secondary-button small" type="button" onClick={() => onOpenSession(row.session!.id)}>Verlauf öffnen</button> : null}
        </div>
      </li>;
    })}</ol>
    {evidence.moreAvailable ? <p role="status">Weitere gespeicherte Zeilen sind vorhanden. Diese Ansicht zeigt höchstens 200; den einzelnen Kartenverlauf für Details öffnen.</p> : null}
  </>;
}

export function WorkflowRunEvidencePanel({ projectId, workflow, columns, onOpenCard, onOpenSession }: {
  projectId: string;
  workflow: Workflow;
  columns: Column[];
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<WorkflowRunEvidence | null>(null);
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setOpen(false);
    setBusy(false);
    setError('');
    setEvidence(null);
  }, [projectId, workflow.id]);
  useEffect(() => () => { request.current += 1; }, []);

  async function load() {
    const current = ++request.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.studio.workflowRunEvidence({ projectId, workflowId: workflow.id });
      if (current === request.current) setEvidence(result);
    } catch (reason) {
      if (current === request.current) setError(errorText(reason));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  function toggle() {
    if (open) {
      request.current += 1;
      setOpen(false);
      setBusy(false);
    } else {
      setOpen(true);
      void load();
    }
  }

  const panelId = `workflow-evidence-${workflow.id}`;
  return <div className="workflow-evidence">
    <button className="secondary-button small" type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
      {open ? 'Verlauf schließen' : 'Schrittverlauf ansehen'}
    </button>
    {open ? <section id={panelId} className="workflow-evidence-panel" aria-label={`Gespeicherter Schrittverlauf: ${workflow.name}`}>
      <div className="workflow-evidence-head">
        <div><strong>Gespeicherter Schrittverlauf</strong><p>Momentaufnahme aus SQLite. Status und Exit-Code stammen aus getrennten gespeicherten Quellen.</p></div>
        <button className="secondary-button small" type="button" disabled={busy} onClick={() => void load()}>Aktualisieren</button>
      </div>
      {busy ? <p role="status">Verlauf wird geladen …</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {!busy && !error && evidence ? <WorkflowEvidenceRows evidence={evidence} workflow={workflow} columns={columns} onOpenCard={onOpenCard} onOpenSession={onOpenSession} /> : null}
    </section> : null}
  </div>;
}
