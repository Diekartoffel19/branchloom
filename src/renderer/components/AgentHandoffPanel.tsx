import { useEffect, useRef, useState } from 'react';
import type { AgentHandoffPreview, AgentHandoffReceipt, AgentHandoffSelection } from '../../shared/agent-handoff';
import type { Card, Session } from '../../shared/types';
import type { Mutate } from './shared';
import './agent-handoff.css';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function AgentHandoffPanel({ card, sourceSession, targetAgentId, useWorktree, queueRunning, mutate }: {
  card: Card; sourceSession: Session | null; targetAgentId: string; useWorktree: boolean; queueRunning: boolean; mutate: Mutate;
}) {
  const [preview, setPreview] = useState<AgentHandoffPreview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<AgentHandoffReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const contextKey = `${card.id}:${sourceSession?.id ?? ''}:${sourceSession?.state ?? ''}:${targetAgentId}:${useWorktree}:${queueRunning}:${Boolean(card.archivedAt)}`;
  const currentContext = useRef(contextKey);
  const requestGeneration = useRef(0);
  if (currentContext.current !== contextKey) { currentContext.current = contextKey; requestGeneration.current += 1; }
  useEffect(() => { setPreview(null); setSelected({}); setEdits({}); setError(''); setBusy(false); }, [contextKey]);
  useEffect(() => {
    let active = true;
    setReceipt(null);
    if (sourceSession) void window.studio.agentHandoffReceipt({ projectId: card.projectId, sessionId: sourceSession.id })
      .then((value) => { if (active) setReceipt(value); })
      .catch(() => { if (active) setReceipt(null); });
    return () => { active = false; };
  }, [card.projectId, sourceSession?.id]);

  async function prepare() {
    if (!sourceSession || busy) return;
    const request = ++requestGeneration.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const value = await window.studio.previewAgentHandoff({ projectId: card.projectId, cardId: card.id,
        sourceSessionId: sourceSession.id, targetAgentId, useWorktree });
      if (request !== requestGeneration.current) return;
      setPreview(value);
      setSelected(Object.fromEntries(value.passages.map((item) => [item.id, item.selected])));
      setEdits(Object.fromEntries(value.passages.map((item) => [item.id, item.text])));
    } catch (reason) { if (request === requestGeneration.current) setError(message(reason)); }
    finally { if (request === requestGeneration.current) setBusy(false); }
  }

  async function start() {
    if (!activePreview || busy) return;
    const request = ++requestGeneration.current;
    const entries: AgentHandoffSelection[] = activePreview.passages.filter((item) => selected[item.id])
      .map((item) => ({ id: item.id, fingerprint: item.fingerprint, text: edits[item.id] ?? item.text }));
    if (!entries.length) { setError('Wähle mindestens eine Passage.'); return; }
    setBusy(true); setError('');
    const result = await mutate(() => window.studio.startAgentHandoff({ preview: activePreview, selected: entries }));
    if (request !== requestGeneration.current) return;
    if (result) {
      setPreview(null);
      try { const saved = await window.studio.agentHandoffReceipt({ projectId: card.projectId, sessionId: result.id }); if (request === requestGeneration.current) setReceipt(saved); }
      catch { /* Start bleibt im Kartenlauf sichtbar. */ }
    } else setError('Die Übergabe wurde nicht gestartet. Prüfe die Fehlermeldung oben und bereite das Paket erneut vor.');
    setBusy(false);
  }

  const canPrepare = Boolean(sourceSession && sourceSession.state !== 'running' && targetAgentId && targetAgentId !== sourceSession.agentId && !card.archivedAt && !queueRunning);
  const activePreview = preview && preview.cardId === card.id && preview.sourceSessionId === sourceSession?.id
    && preview.targetAgentId === targetAgentId && preview.useWorktree === useWorktree && !card.archivedAt ? preview : null;
  const selectedLength = activePreview?.passages.filter((item) => selected[item.id]).reduce((total, item) => total + (edits[item.id] ?? item.text).length, 0) ?? 0;
  return <details className="agent-handoff">
    <summary>Kontext an anderen Agenten übergeben</summary>
    <div className="agent-handoff-body">
      <p>Ein Paket aus gespeicherten Quellen vorbereiten, Passagen wählen und bearbeiten. Erst der bestätigte Start übergibt den Text. Terminalausgabe wird nicht als Zusammenfassung übernommen.</p>
      {receipt ? <p className="agent-handoff-receipt">Übergabe am {new Date(receipt.startedAt).toLocaleString('de-DE')}: {receipt.selectedSources.map((item) => item.id).join(', ')} · Beleg {receipt.contentSha256.slice(0, 12)}. Die CLI-Verarbeitung bleibt ungeprüft.</p> : null}
      <button type="button" className="secondary-button small" disabled={!canPrepare || busy} onClick={() => void prepare()}>{busy && !preview ? 'Lese Quellen…' : 'Kontextpaket vorbereiten'}</button>
      {!sourceSession ? <p>Für diese Karte liegt noch kein Quelllauf vor.</p> : sourceSession.state === 'running' ? <p>Beende den laufenden Agenten vor einem Wechsel.</p> : queueRunning ? <p>Pausiere die Projektwarteschlange vor dem Wechsel.</p> : !targetAgentId || targetAgentId === sourceSession.agentId ? <p>Wähle oben einen anderen Agenten.</p> : null}
      {activePreview ? <div className="agent-handoff-preview">
        <p><strong>Vorschau</strong> · {activePreview.passages.length} lokale Quellen · maximal 15 Minuten gültig. Ein freigegebener Wireframe wird beim normalen Kartenstart weiterhin zusätzlich eingebunden.</p>
        {activePreview.passages.map((item) => <div className="agent-handoff-passage" key={item.id}>
          <label className="agent-handoff-choice"><input type="checkbox" checked={Boolean(selected[item.id])} disabled={busy} onChange={(event) => setSelected((old) => ({ ...old, [item.id]: event.target.checked }))} /><strong>{item.title}</strong></label>
          <small>{item.source} · {new Date(item.sourceAt).toLocaleString('de-DE')}{item.truncated ? ' · gekürzt' : ''}{item.redacted ? ' · sensible Muster ausgeblendet' : ''}</small>
          <textarea aria-label={`${item.title} bearbeiten`} rows={Math.min(7, Math.max(3, (edits[item.id] ?? '').split('\n').length + 1))} maxLength={2000} value={edits[item.id] ?? ''} disabled={busy || !selected[item.id]} onChange={(event) => setEdits((old) => ({ ...old, [item.id]: event.target.value }))} />
        </div>)}
        <p>Änderungen an gespeicherten Quellen oder Git seit dieser Vorschau sperren den Start. Erfasste Geheimnisse werden in der Vorschau ausgeblendet; der endgültige Text wird vor dem CLI-Start erneut geprüft.</p>
        <p className={selectedLength > 10_000 ? 'inline-error' : undefined}>Auswahl: {selectedLength} von 10.000 Zeichen.</p>
        <button type="button" className="primary-button" disabled={busy || !selectedLength || selectedLength > 10_000} onClick={() => void start()}>{busy ? 'Prüfe und starte…' : 'Auswahl bestätigen und Agent starten'}</button>
      </div> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  </details>;
}
