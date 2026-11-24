import { useEffect, useState } from 'react';
import type { DesignSelection } from '../../shared/design-inspection';
import { DESIGN_CONTEXT_DRAG_TYPE } from '../design-context-drag';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function DesignContextSourceList({ selections, disabled, onPrepare }: { selections: DesignSelection[]; disabled: boolean; onPrepare: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const matching = selections.filter((item) => `${item.tag} ${item.selector} ${item.sourceUrl}`.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE')));
  return <>
    {selections.length > 10 ? <label className="card-context-whiteboard-filter">Design-Belege suchen<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Element oder lokale Route" /></label> : null}
    {matching.length ? <ul className="card-context-whiteboard-list">{matching.map((item) => <li key={item.id}>
      <div className="card-context-whiteboard-source" draggable={!disabled} onDragStart={(event) => {
        if (disabled) { event.preventDefault(); return; }
        event.dataTransfer.setData(DESIGN_CONTEXT_DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}><strong>{item.tag} · {item.selector}</strong><small>{item.sourceUrl}</small></div>
      <button className="secondary-button small" type="button" disabled={disabled} onClick={() => onPrepare(item.id)}>Vorbereiten</button>
    </li>)}</ul> : <p className="section-copy">{query ? 'Kein passender gespeicherter Beleg.' : 'Noch kein Design-Elementbeleg in diesem Projekt gespeichert.'}</p>}
  </>;
}

export function DesignContextSources({ projectId, disabled, onPrepare }: { projectId: string; disabled: boolean; onPrepare: (id: string) => void }) {
  const [selections, setSelections] = useState<DesignSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { setSelections(await window.studio.designSelections(projectId)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { let live = true; setSelections([]); setLoading(true); setError('');
    void window.studio.designSelections(projectId).then((items) => { if (live) setSelections(items); })
      .catch((reason: unknown) => { if (live) setError(messageOf(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);
  return <div className="card-context-whiteboard-content">
    <p className="section-copy">Gespeicherten Beleg ziehen oder per Tastatur vorbereiten. Notiz ergänzen und erst mit „Bezug hinzufügen“ an der Karte speichern. Die Seite wird nicht geöffnet.</p>
    <button className="secondary-button small" type="button" disabled={loading} onClick={() => void load()}>Design-Belege neu laden</button>
    {loading ? <p className="section-copy" role="status">Design-Belege werden geladen…</p> : <DesignContextSourceList selections={selections} disabled={disabled} onPrepare={onPrepare} />}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;
}
