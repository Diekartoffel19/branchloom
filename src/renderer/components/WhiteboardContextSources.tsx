import { useEffect, useState } from 'react';
import type { WhiteboardNode } from '../../shared/types';
import { WHITEBOARD_CONTEXT_DRAG_TYPE } from '../whiteboard-context-drag';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const contextNode = (node: WhiteboardNode): boolean => node.reference?.kind === 'file' || node.reference?.kind === 'folder';
const displayPath = (node: WhiteboardNode): string => node.reference?.kind === 'file' || node.reference?.kind === 'folder' ? node.reference.path.replaceAll('\\', '/') : '';

export function WhiteboardContextSourceList({ nodes, disabled, onPrepare }: { nodes: WhiteboardNode[]; disabled: boolean; onPrepare: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const matching = nodes.filter((node) => contextNode(node) && `${node.title} ${displayPath(node)}`.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE')));
  return <>
    {nodes.length > 20 ? <label className="card-context-whiteboard-filter">Whiteboard-Quellen suchen<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Box oder Projektpfad" /></label> : null}
    {matching.length ? <ul className="card-context-whiteboard-list">{matching.slice(0, 30).map((node) => <li key={node.id}>
      <div className="card-context-whiteboard-source" draggable={!disabled} onDragStart={(event) => {
        if (disabled) { event.preventDefault(); return; }
        event.dataTransfer.setData(WHITEBOARD_CONTEXT_DRAG_TYPE, node.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}><strong>{node.title}</strong><small>{node.reference?.kind === 'folder' ? 'Ordner' : 'Datei'} · {displayPath(node)}</small></div>
      <button className="secondary-button small" type="button" disabled={disabled} onClick={() => onPrepare(node.id)}>Vorbereiten</button>
    </li>)}</ul> : <p className="section-copy">{query ? 'Keine passende Datei- oder Ordnerbox.' : 'Keine Whiteboard-Box mit Datei- oder Ordnerverknüpfung vorhanden.'}</p>}
    {matching.length > 30 ? <p className="section-copy">30 von {matching.length} Treffern. Suche nach Box oder Projektpfad.</p> : null}
  </>;
}

export function WhiteboardContextSources({ projectId, disabled, onPrepare }: { projectId: string; disabled: boolean; onPrepare: (id: string) => void }) {
  const [nodes, setNodes] = useState<WhiteboardNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { setNodes((await window.studio.whiteboard(projectId)).nodes.filter(contextNode)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { let live = true; setLoading(true); setNodes([]); setError('');
    void window.studio.whiteboard(projectId).then((board) => { if (live) setNodes(board.nodes.filter(contextNode)); })
      .catch((reason: unknown) => { if (live) setError(messageOf(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);
  return <div className="card-context-whiteboard-content">
    <p className="section-copy">Eine gespeicherte Datei- oder Ordnerbox ziehen oder per Tastatur vorbereiten. Erst „Bezug hinzufügen“ speichert den Projektpfad an der Karte. Ordnerinhalte werden nicht gelesen.</p>
    <button className="secondary-button small" type="button" disabled={loading} onClick={() => void load()}>Whiteboard neu laden</button>
    {loading ? <p className="section-copy" role="status">Whiteboard-Quellen werden geladen…</p> : <WhiteboardContextSourceList nodes={nodes} disabled={disabled} onPrepare={onPrepare} />}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;
}
