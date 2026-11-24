import { useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import type { MemoryGitCommit, MemoryGitSource } from '../../shared/memory-git-source';

interface Props { projectId: string; noteId: string }

const stateText: Record<MemoryGitSource['state'], string> = {
  'in-history': 'Commit ist in der aktuellen Projekt-Historie',
  'outside-history': 'Commit ist vorhanden, aber nicht mehr in der aktuellen HEAD-Historie',
  missing: 'Commit ist in diesem Repository nicht mehr vorhanden',
  'repository-changed': 'Projekt zeigt auf ein anderes Repository',
  unavailable: 'Git-Quelle konnte gerade nicht geprüft werden',
};

export function MemoryGitSourcePanel({ projectId, noteId }: Props) {
  const [source, setSource] = useState<MemoryGitSource | null>(null);
  const [candidates, setCandidates] = useState<MemoryGitCommit[] | null>(null);
  const [selectedHash, setSelectedHash] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  async function refresh() {
    const current = ++request.current;
    setLoading(true);
    setError('');
    try {
      const value = await window.studio.memoryGitSource({ projectId, noteId });
      if (current === request.current) setSource(value);
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    setSource(null); setCandidates(null); setSelectedHash(''); setBusy(false);
    void refresh();
    return () => { request.current += 1; };
  }, [projectId, noteId]);

  async function choose() {
    const current = ++request.current;
    setBusy(true); setError(''); setCandidates(null); setSelectedHash('');
    try {
      const rows = await window.studio.memoryGitCandidates(projectId);
      if (current === request.current) setCandidates(rows);
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  async function attach() {
    if (!selectedHash || busy) return;
    if (source && !window.confirm('Die bisherige Git-Quelle dieser Notiz ersetzen?')) return;
    const current = ++request.current;
    setBusy(true); setError('');
    try {
      const saved = await window.studio.attachMemoryGitSource({ projectId, noteId, commit: selectedHash });
      if (current === request.current) { setSource(saved); setCandidates(null); setSelectedHash(''); }
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  async function remove() {
    if (!source || busy || !window.confirm('Git-Quelle von dieser Notiz entfernen?')) return;
    const current = ++request.current;
    setBusy(true); setError('');
    try {
      await window.studio.removeMemoryGitSource({ projectId, noteId });
      if (current === request.current) { setSource(null); setCandidates(null); setSelectedHash(''); }
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  return <section className="memory-git-source" aria-label="Git-Quelle der Notiz">
    <div className="memory-git-source-head">
      <h3><GitCommitHorizontal size={16} /> Git-Quelle</h3>
      <div>
        {source ? <button className="secondary-button small" type="button" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={14} /> Erneut prüfen</button> : null}
        <button className="secondary-button small" type="button" disabled={busy || loading} onClick={() => void choose()}>{source ? 'Quelle ersetzen' : 'Commit auswählen'}</button>
        {source ? <button className="icon-button danger-icon" type="button" disabled={busy} aria-label="Git-Quelle entfernen" onClick={() => void remove()}><Trash2 size={15} /></button> : null}
      </div>
    </div>
    {loading ? <p role="status">Git-Quelle wird geprüft…</p> : null}
    {!loading && !source ? <p>Noch kein Commit als Quelle verknüpft.</p> : null}
    {source ? <div className="memory-git-source-record">
      <strong>{source.subject}</strong>
      <code title={source.hash}>{source.hash}</code>
      <small>{new Date(source.committedAt).toLocaleString('de-DE')} · {stateText[source.state]}</small>
    </div> : null}
    {candidates ? <div className="memory-git-source-chooser">
      <p>Nur Commits aus der aktuellen HEAD-Historie. Die Auswahl wird vor dem Speichern erneut geprüft.</p>
      {candidates.length ? <><fieldset disabled={busy}><legend>Commit für diese Notiz</legend>
        {candidates.map((item) => <label key={item.hash}><input type="radio" name={`memory-commit-${noteId}`} checked={selectedHash === item.hash} onChange={() => setSelectedHash(item.hash)} /><span><strong>{item.subject}</strong><small>{item.hash.slice(0, 12)} · {new Date(item.committedAt).toLocaleString('de-DE')}</small></span></label>)}
      </fieldset><div className="memory-git-source-actions"><button className="secondary-button small" type="button" onClick={() => setCandidates(null)}>Abbrechen</button><button className="primary-button small" type="button" disabled={!selectedHash || busy} onClick={() => void attach()}>{busy ? 'Speichern…' : 'Quelle verknüpfen'}</button></div></> : <p>In diesem Repository sind keine Commits vorhanden.</p>}
    </div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
