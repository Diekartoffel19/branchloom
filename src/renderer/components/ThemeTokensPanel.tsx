import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeTokenInventory } from '../../shared/theme-tokens';
import './theme-tokens.css';

export function ThemeTokensPanel({ projectId }: { projectId: string }) {
  const [inventory, setInventory] = useState<ThemeTokenInventory | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setInventory(null); setQuery(''); setLoading(false); setError(''); setCopied('');
    return () => { generation.current++; };
  }, [projectId]);

  async function scan() {
    const current = ++generation.current;
    setLoading(true); setError(''); setCopied('');
    try {
      const result = await window.studio.themeTokens(projectId);
      if (generation.current === current && result.projectId === projectId) setInventory(result);
    } catch (reason) {
      if (generation.current === current) { setInventory(null); setError(reason instanceof Error ? reason.message : String(reason)); }
    } finally { if (generation.current === current) setLoading(false); }
  }

  async function copy(path: string, line: number) {
    const current = generation.current;
    try { await navigator.clipboard.writeText(`${path}:${line}`); if (generation.current === current) { setCopied(`${path}:${line}`); setError(''); } }
    catch { if (generation.current === current) setError('Dateipfad konnte nicht kopiert werden.'); }
  }

  const currentInventory = inventory?.projectId === projectId ? inventory : null;
  const filtered = useMemo(() => currentInventory?.definitions.filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase('de-DE').includes(query.trim().toLocaleLowerCase('de-DE'))) ?? [], [currentInventory, query]);

  return <section className="theme-tokens" aria-label="CSS-Variablen im Projekt">
    <div className="theme-tokens-head"><div><h3>Projekt-Tokens</h3><p>Versionierte CSS-Variablen mit echter Fundstelle. Die Suche liest nur und führt keinen Projektcode aus.</p></div><button className="secondary-button" type="button" disabled={loading} onClick={() => void scan()}>{loading ? 'Suche…' : currentInventory ? 'Erneut suchen' : 'Tokens suchen'}</button></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {currentInventory ? <>
      <p className="theme-tokens-summary" role="status">{currentInventory.definitions.length} Definitionen aus {currentInventory.scannedFiles} CSS-Dateien{currentInventory.partial ? ' · unvollständig' : ''}.</p>
      {currentInventory.notes.length ? <ul className="theme-tokens-notes">{currentInventory.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {currentInventory.definitions.length ? <label className="theme-tokens-search">Nach Name oder Datei filtern<input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="--surface oder src/theme.css" /></label> : null}
      {filtered.length ? <ol className="theme-tokens-list">{filtered.map((item) => <li key={`${item.path}:${item.line}:${item.name}`}><div><strong><code>{item.name}</code></strong><code>{item.value}{item.valueTruncated ? '…' : ''}</code><small>{item.path}:{item.line}</small></div><button className="secondary-button" type="button" onClick={() => void copy(item.path, item.line)}>{copied === `${item.path}:${item.line}` ? 'Pfad kopiert' : 'Pfad kopieren'}</button></li>)}</ol> : <p className="theme-tokens-empty">{query ? 'Keine Treffer für diesen Filter.' : 'Keine passenden CSS-Variablen gefunden.'}</p>}
    </> : null}
    <p className="theme-tokens-limit">Dies sind Quelldefinitionen, keine berechneten Browserwerte. Doppelte Namen können in verschiedenen Selektoren andere Werte haben.</p>
  </section>;
}
