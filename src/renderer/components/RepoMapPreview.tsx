import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { RepoMapProposal } from '../../shared/repo-map';

interface Props { proposal: RepoMapProposal; busy: boolean; error: string; onClose: () => void; onAccept: (nodeIds: string[]) => void }
const kindLabel = { folder: 'Ordner', package: 'Paketordner', 'component-candidate': 'Mögliche UI-Komponente' } as const;

export function RepoMapPreview({ proposal, busy, error, onClose, onAccept }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposal.nodes.map((node) => node.id)));
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? [])];
    if (!items.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)!.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]!.focus(); }
  }

  return <div className="drawer-backdrop wb-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="wb-preview-panel" role="dialog" aria-modal="true" aria-label="Repo-Struktur prüfen" aria-busy={busy} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="drawer-header"><div><small>Whiteboard · Git-Index</small><h2>Repo-Struktur prüfen</h2></div><button type="button" className="icon-button" aria-label="Schließen" disabled={busy} onClick={onClose}><X size={19} /></button></header>
      <div className="wb-preview-content">
        <p>Aus {proposal.trackedFileCount} versionierten Pfaden wurden {proposal.nodes.length} Boxen und {proposal.edges.length} „enthält“-Verbindungen vorgeschlagen. Dateiinhalte wurden nicht gelesen. Mögliche UI-Komponenten beruhen nur auf ihrem Dateinamen.</p>
        {proposal.truncated ? <p className="wb-preview-warning" role="status">Die Vorschau wurde begrenzt. Nur die angezeigten Boxen können übernommen werden.</p> : null}
        {proposal.warnings.map((warning) => <p key={warning} className="wb-preview-warning">{warning}</p>)}
        <div className="wb-preview-toolbar"><span>{selected.size} von {proposal.nodes.length} ausgewählt</span><button type="button" className="secondary-button" disabled={busy || selected.size === proposal.nodes.length} onClick={() => setSelected(new Set(proposal.nodes.map((node) => node.id)))}>Alle wählen</button><button type="button" className="secondary-button" disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>Keine wählen</button></div>
        <div className="wb-preview-list" aria-label="Vorgeschlagene Boxen">{proposal.nodes.length ? proposal.nodes.map((node) => <label className="wb-preview-row" key={node.id}><input type="checkbox" checked={selected.has(node.id)} disabled={busy} onChange={(event) => setSelected((before) => { const next = new Set(before); if (event.target.checked) next.add(node.id); else next.delete(node.id); return next; })} /><span><strong>{node.title}</strong><small>{kindLabel[node.kind]} · {node.path}</small><small>Beleg: {node.evidence.path}</small></span></label>) : <p>Im Git-Index liegen keine geeigneten Pfade.</p>}</div>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <div className="wb-preview-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Abbrechen</button><button type="button" className="primary-button" disabled={busy || selected.size === 0} onClick={() => onAccept([...selected])}>{busy ? 'Übernehme…' : `${selected.size} Boxen übernehmen`}</button></div>
      </div>
    </section>
  </div>;
}
