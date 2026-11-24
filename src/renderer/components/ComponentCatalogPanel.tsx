import { useEffect, useMemo, useState } from 'react';
import type { ComponentCatalog } from '../../shared/component-catalog';
import './component-catalog.css';

export function ComponentCatalogPanel({ projectId }: { projectId: string }) {
  const [catalog, setCatalog] = useState<ComponentCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { setCatalog(null); setQuery(''); setError(''); setCopied(''); }, [projectId]);

  async function scan() {
    setLoading(true); setError(''); setCopied('');
    try { setCatalog(await window.studio.componentCatalog(projectId)); }
    catch (reason) { setCatalog(null); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }

  async function copy(path: string, line: number) {
    try { await navigator.clipboard.writeText(`${path}:${line}`); setCopied(`${path}:${line}`); setError(''); }
    catch { setError('Dateipfad konnte nicht kopiert werden.'); }
  }

  const filtered = useMemo(() => catalog?.candidates.filter((candidate) => `${candidate.name} ${candidate.path}`.toLocaleLowerCase('de-DE').includes(query.trim().toLocaleLowerCase('de-DE'))) ?? [], [catalog, query]);

  return <section className="component-catalog" aria-label="Komponenten-Quellen">
    <div className="component-catalog-head"><div><h3>Komponenten-Quellen</h3><p>Versionierte TSX-/JSX-Dateien nach exportierten JSX-Kandidaten durchsuchen. Branchloom führt ihren Code dabei nicht aus.</p></div><button className="secondary-button" type="button" disabled={loading} onClick={() => void scan()}>{loading ? 'Suche…' : catalog ? 'Erneut suchen' : 'Komponenten suchen'}</button></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {catalog ? <>
      <p className="component-catalog-summary" role="status">{catalog.candidates.length} Kandidaten · {catalog.scannedFiles} {catalog.scannedFiles === 1 ? 'Datei' : 'Dateien'} gelesen{catalog.partial ? ' · unvollständig' : ''}. Dateinamen und Zeilen sind Quellenhinweise, keine gerenderte Komponentenbibliothek.</p>
      {catalog.notes.length ? <ul className="component-catalog-notes">{catalog.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {catalog.candidates.length ? <label className="component-catalog-search">Kandidaten filtern<input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder Dateipfad" /></label> : null}
      {filtered.length ? <ol className="component-catalog-list">{filtered.map((candidate) => <li key={`${candidate.path}:${candidate.line}:${candidate.name}`}><div><strong>{candidate.name}</strong><small>{candidate.kind === 'function' ? 'Exportierte Funktion' : 'Exportierte Konstante'}</small><code>{candidate.path}:{candidate.line}</code></div><button className="secondary-button" type="button" onClick={() => void copy(candidate.path, candidate.line)}>{copied === `${candidate.path}:${candidate.line}` ? 'Pfad kopiert' : 'Pfad kopieren'}</button></li>)}</ol> : <p className="component-catalog-empty">{query ? 'Keine Treffer für diesen Filter.' : 'Keine passenden exportierten JSX-Kandidaten gefunden.'}</p>}
    </> : null}
    <p className="component-catalog-limit">Die Suche erkennt nur einfache Exportformen. Re-Exports, dynamische Komponenten, Framework-Metadaten und tatsächliche Renderzustände bleiben offen.</p>
  </section>;
}
