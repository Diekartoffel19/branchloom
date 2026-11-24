import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignInspectionState } from '../../shared/design-inspection';
import type { ThemeTokenDefinition, ThemeTokenInventory } from '../../shared/theme-tokens';
import './theme-tokens.css';

export function ThemeTokensPanel({ projectId, previewState, onPreviewState }: { projectId: string; previewState: DesignInspectionState; onPreviewState: (state: DesignInspectionState) => void }) {
  const [inventory, setInventory] = useState<ThemeTokenInventory | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [selected, setSelected] = useState<ThemeTokenDefinition | null>(null);
  const [previewValue, setPreviewValue] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setInventory(null); setQuery(''); setLoading(false); setError(''); setCopied(''); setSelected(null); setPreviewValue(''); setPreviewError('');
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

  async function applyPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || previewBusy || !previewReady) return;
    setPreviewBusy(true); setPreviewError('');
    try { onPreviewState(await window.studio.designInspectionApplyThemePreview({ projectId, token: selected, value: previewValue })); }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPreviewBusy(false); }
  }

  async function resetPreview() {
    if (previewBusy || !previewReady) return;
    setPreviewBusy(true); setPreviewError('');
    try { onPreviewState(await window.studio.designInspectionResetThemePreview(projectId)); }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPreviewBusy(false); }
  }

  function chooseToken(item: ThemeTokenDefinition) {
    setSelected(item);
    setPreviewValue(/^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:0|[1-9][0-9]?)(?:\.[0-9]{1,2})?px)$/.test(item.value) ? item.value : '');
    setPreviewError('');
  }

  const currentInventory = inventory?.projectId === projectId ? inventory : null;
  const previewReady = previewState.ready && previewState.projectId === projectId;
  const activePreview = previewReady ? previewState.themePreview : null;
  const filtered = useMemo(() => currentInventory?.definitions.filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase('de-DE').includes(query.trim().toLocaleLowerCase('de-DE'))) ?? [], [currentInventory, query]);

  return <section className="theme-tokens" aria-label="CSS-Variablen im Projekt">
    <div className="theme-tokens-head"><div><h3>Projekt-Tokens</h3><p>Versionierte CSS-Variablen mit echter Fundstelle. Die Suche liest nur und führt keinen Projektcode aus.</p></div><button className="secondary-button" type="button" disabled={loading} onClick={() => void scan()}>{loading ? 'Suche…' : currentInventory ? 'Erneut suchen' : 'Tokens suchen'}</button></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {currentInventory ? <>
      <p className="theme-tokens-summary" role="status">{currentInventory.definitions.length} Definitionen aus {currentInventory.scannedFiles} {currentInventory.scannedFiles === 1 ? 'CSS-Datei' : 'CSS-Dateien'}{currentInventory.partial ? ' · unvollständig' : ''}.</p>
      {currentInventory.notes.length ? <ul className="theme-tokens-notes">{currentInventory.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {currentInventory.definitions.length ? <label className="theme-tokens-search">Nach Name oder Datei filtern<input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="--surface oder src/theme.css" /></label> : null}
      {filtered.length ? <ol className="theme-tokens-list">{filtered.map((item) => <li key={`${item.path}:${item.line}:${item.name}`}>
        <div><strong><code>{item.name}</code></strong><code>{item.value}{item.valueTruncated ? '…' : ''}</code><small>{item.path}:{item.line}</small></div>
        <div className="theme-tokens-actions">
          <button className="secondary-button" type="button" onClick={() => void copy(item.path, item.line)}>{copied === `${item.path}:${item.line}` ? 'Pfad kopiert' : 'Pfad kopieren'}</button>
          <button className="secondary-button" type="button" disabled={!previewReady || previewBusy} onClick={() => chooseToken(item)}>Testen</button>
        </div>
      </li>)}</ol> : <p className="theme-tokens-empty">{query ? 'Keine Treffer für diesen Filter.' : 'Keine passenden CSS-Variablen gefunden.'}</p>}
      {selected ? <form className="theme-tokens-preview" onSubmit={(event) => void applyPreview(event)}>
        <div><strong><code>{selected.name}</code> testen</strong><small>{selected.path}:{selected.line} · Nur in der offenen lokalen Vorschau</small></div>
        <label>Neuer Wert<input type="text" maxLength={32} value={previewValue} onChange={(event) => setPreviewValue(event.target.value)} placeholder="#b89976 oder 12px" disabled={!previewReady || previewBusy || !!activePreview} /></label>
        <div className="theme-tokens-actions">
          <button className="primary-button" type="submit" disabled={!previewReady || previewBusy || !previewValue.trim() || !!activePreview}>Vorschau anwenden</button>
          <button className="secondary-button" type="button" disabled={!previewReady || previewBusy || !activePreview} onClick={() => void resetPreview()}>Zurücksetzen</button>
        </div>
        {activePreview ? <p role="status">Aktiv: <code>{activePreview.name}: {activePreview.value}</code>. Beim Schließen der Vorschau verfällt die Änderung.</p> : null}
        {previewError ? <p className="inline-error" role="alert">{previewError}</p> : null}
      </form> : activePreview ? <div className="theme-tokens-preview">
        <p role="status">Aktiv: <code>{activePreview.name}: {activePreview.value}</code></p>
        <button className="secondary-button" type="button" disabled={!previewReady || previewBusy} onClick={() => void resetPreview()}>Zurücksetzen</button>
        {previewError ? <p className="inline-error" role="alert">{previewError}</p> : null}
      </div> : null}
    </> : null}
    <p className="theme-tokens-limit">Dies sind Quelldefinitionen, keine berechneten Browserwerte. Die Vorschau akzeptiert nur Hex-Farben und Radien in px; sie ändert keine Datei. Ob ein Element sichtbar reagiert, hängt von der CSS-Kaskade ab.</p>
  </section>;
}
