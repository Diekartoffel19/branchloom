import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, type Connection, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import { FolderTree, Link2, Plus, Trash2 } from 'lucide-react';
import type { ProjectSnapshot, WhiteboardNode, WhiteboardReference, WhiteboardSnapshot } from '../../shared/types';
import type { RepoMapProposal, RepoMapImportResult } from '../../shared/repo-map';
import { RepoMapPreview } from './RepoMapPreview';
import '@xyflow/react/dist/style.css';
import './whiteboard.css';

type EditDraft = { title: string; description: string; referenceKind: 'none' | 'card' | 'folder' | 'file'; cardId: string; folderPath: string };
const emptyDraft = (): EditDraft => ({ title: '', description: '', referenceKind: 'none', cardId: '', folderPath: '' });
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const draftOf = (node: WhiteboardNode): EditDraft => ({ title: node.title, description: node.description,
  referenceKind: node.reference?.kind ?? 'none', cardId: node.reference?.kind === 'card' ? node.reference.cardId : '', folderPath: node.reference?.kind === 'folder' || node.reference?.kind === 'file' ? node.reference.path : '' });

function referenceOf(draft: EditDraft): WhiteboardReference | null {
  if (draft.referenceKind === 'card') return { kind: 'card', cardId: draft.cardId };
  if (draft.referenceKind === 'folder' || draft.referenceKind === 'file') return { kind: draft.referenceKind, path: draft.folderPath };
  return null;
}

export function WhiteboardView({ snapshot, onOpenCard }: { snapshot: ProjectSnapshot; onOpenCard: (id: string) => void }) {
  const projectId = snapshot.project.id;
  const [board, setBoard] = useState<WhiteboardSnapshot>({ nodes: [], edges: [] });
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapProposal, setMapProposal] = useState<RepoMapProposal | null>(null);
  const [mapError, setMapError] = useState('');
  const [mapBusy, setMapBusy] = useState(false);
  const [mapResult, setMapResult] = useState<RepoMapImportResult | null>(null);
  const flowApi = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const latestProjectId = useRef(projectId);
  latestProjectId.current = projectId;

  const reload = useCallback(async () => {
    const next = await window.studio.whiteboard(projectId);
    setBoard(next);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setSelected(null);
    setSelectedEdge(null);
    setBoard({ nodes: [], edges: [] });
    setMapProposal(null); setMapError(''); setMapResult(null); setMapBusy(false);
    window.studio.whiteboard(projectId).then((next) => { if (live) setBoard(next); })
      .catch((reason: unknown) => { if (live) setError(message(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);

  useEffect(() => {
    setFlowNodes(board.nodes.map((item) => ({ id: item.id, position: { x: item.x, y: item.y }, data: {
      label: <div className="wb-node-content"><strong>{item.title}</strong>{item.description ? <span>{item.description}</span> : null}
        {item.reference?.kind === 'card' ? <small>Karte · {snapshot.cards.find((card) => card.id === (item.reference as { kind: 'card'; cardId: string }).cardId)?.title ?? 'entfernt'}</small> : null}
        {item.reference?.kind === 'folder' ? <small>Ordner · {item.reference.path}</small> : null}
        {item.reference?.kind === 'file' ? <small>Datei · {item.reference.path}</small> : null}</div>,
    }, className: `wb-node${item.reference ? ' wb-node-linked' : ''}` })));
  }, [board.nodes, snapshot.cards]);

  useEffect(() => {
    if (!flowNodes.length) return;
    const frame = requestAnimationFrame(() => { void flowApi.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [projectId, flowNodes.length]);

  const flowEdges = useMemo<Edge[]>(() => board.edges.map((item) => ({ id: item.id, source: item.sourceId, target: item.targetId, label: item.label || undefined,
    type: 'smoothstep', className: 'wb-edge' })), [board.edges]);
  const selectedNode = board.nodes.find((item) => item.id === selected) ?? null;
  const edge = board.edges.find((item) => item.id === selectedEdge) ?? null;

  useEffect(() => { setDraft(selectedNode ? draftOf(selectedNode) : emptyDraft()); }, [selectedNode?.id]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true); setError('');
    try { await action(); await reload(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  function addNode() {
    void run(async () => {
      const index = board.nodes.length;
      const created = await window.studio.createWhiteboardNode({ projectId, title: 'Neue Box', x: (index % 3) * 260, y: Math.floor(index / 3) * 180 });
      setSelected(created.id);
      setSelectedEdge(null);
    });
  }

  function connect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    void run(() => window.studio.createWhiteboardEdge({ projectId, sourceId: connection.source!, targetId: connection.target! }));
  }

  function saveNode() {
    if (!selectedNode) return;
    void run(() => window.studio.updateWhiteboardNode({ projectId, id: selectedNode.id, title: draft.title, description: draft.description, reference: referenceOf(draft) }));
  }

  function deleteNode() {
    if (!selectedNode || !window.confirm(`Box „${selectedNode.title}“ und ihre Verbindungen entfernen?`)) return;
    void run(async () => { await window.studio.deleteWhiteboardNode({ projectId, id: selectedNode.id }); setSelected(null); });
  }

  async function previewMap() {
    setMapBusy(true); setMapError(''); setMapResult(null); setError('');
    try {
      const proposal = await window.studio.previewRepoMap(projectId);
      if (latestProjectId.current === projectId) setMapProposal(proposal);
    } catch (reason) { if (latestProjectId.current === projectId) setError(message(reason)); }
    finally { if (latestProjectId.current === projectId) setMapBusy(false); }
  }

  async function acceptMap(nodeIds: string[]) {
    if (!mapProposal || mapBusy) return;
    setMapBusy(true); setMapError('');
    try {
      const result = await window.studio.acceptRepoMap({ projectId, fingerprint: mapProposal.fingerprint, nodeIds });
      if (latestProjectId.current !== projectId) return;
      await reload();
      setMapResult(result); setMapProposal(null);
    } catch (reason) { if (latestProjectId.current === projectId) setMapError(message(reason)); }
    finally { if (latestProjectId.current === projectId) setMapBusy(false); }
  }

  return <div className="wb-view">
    <div className="view-header wb-heading"><div><h2>Architektur-Whiteboard</h2><p>Boxen mit Karten oder echten Projektordnern verknüpfen. Änderungen werden lokal gespeichert.</p></div>
      <div className="wb-heading-actions"><button className="secondary-button" type="button" disabled={busy || loading || mapBusy} onClick={() => void previewMap()}><FolderTree size={16} /> {mapBusy && !mapProposal ? 'Prüfe Repo…' : 'Repo-Struktur vorschlagen'}</button><button className="primary-button" type="button" disabled={busy || loading} onClick={addNode}><Plus size={16} /> Box hinzufügen</button></div></div>
    {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" aria-label="Fehler schließen" onClick={() => setError('')}>×</button></div> : null}
    {mapResult ? <p className="wb-import-result" role="status">Repo-Struktur übernommen: {mapResult.createdNodes} neue Boxen, {mapResult.reusedNodes} vorhandene Boxen, {mapResult.createdEdges} neue Verbindungen.</p> : null}
    <div className="wb-workspace">
      <div className="wb-canvas" aria-label="Architektur-Canvas">
        {loading ? <div className="wb-loading">Whiteboard wird geladen…</div> : <ReactFlow nodes={flowNodes} edges={flowEdges} onNodesChange={onNodesChange} onConnect={connect}
          onInit={(instance) => { flowApi.current = instance; }}
          onNodeDragStop={(_event, node) => { void run(() => window.studio.updateWhiteboardNode({ projectId, id: node.id, x: node.position.x, y: node.position.y })); }}
          onNodeClick={(_event, node) => { setSelected(node.id); setSelectedEdge(null); }}
          onEdgeClick={(_event, clicked) => { setSelectedEdge(clicked.id); setSelected(null); }}
          onPaneClick={() => { setSelected(null); setSelectedEdge(null); }}
          nodesConnectable={!busy} nodesDraggable={!busy} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          deleteKeyCode={null} selectionKeyCode="Shift" attributionPosition="bottom-left">
          <Background color="var(--border)" gap={24} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable maskColor="var(--surface-2)" />
        </ReactFlow>}
        {!loading && board.nodes.length === 0 ? <div className="wb-empty"><strong>Noch keine Architekturboxen.</strong><span>Füge eine Box hinzu, verknüpfe eine Karte oder einen Ordner und ziehe anschließend Verbindungen.</span></div> : null}
      </div>
      <aside className="wb-inspector" aria-label="Whiteboard-Details">
        {selectedNode ? <><h3>Box bearbeiten</h3><label>Titel<input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Beschreibung<textarea maxLength={2000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>Verknüpfung<select value={draft.referenceKind} onChange={(event) => setDraft({ ...draft, referenceKind: event.target.value as EditDraft['referenceKind'] })}><option value="none">Keine</option><option value="card">Karte</option><option value="folder">Projektordner</option><option value="file">Projektdatei</option></select></label>
          {draft.referenceKind === 'card' ? <label>Karte<select value={draft.cardId} onChange={(event) => setDraft({ ...draft, cardId: event.target.value })}><option value="">Karte auswählen</option>{snapshot.cards.map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label> : null}
          {draft.referenceKind === 'folder' || draft.referenceKind === 'file' ? <label>Relativer {draft.referenceKind === 'file' ? 'Datei' : 'Ordner'}pfad<input value={draft.folderPath} onChange={(event) => setDraft({ ...draft, folderPath: event.target.value })} placeholder={draft.referenceKind === 'file' ? 'src/renderer/App.tsx' : 'src/renderer'} /></label> : null}
          <div className="wb-actions"><button className="primary-button" type="button" disabled={busy || !draft.title.trim()} onClick={saveNode}>Speichern</button>
            {selectedNode.reference?.kind === 'card' && snapshot.cards.some((card) => card.id === (selectedNode.reference as { kind: 'card'; cardId: string }).cardId) ? <button className="secondary-button" type="button" onClick={() => onOpenCard((selectedNode.reference as { kind: 'card'; cardId: string }).cardId)}>Karte öffnen</button> : null}
            <button className="secondary-button wb-danger" type="button" disabled={busy} onClick={deleteNode}><Trash2 size={14} /> Entfernen</button></div></>
        : edge ? <><h3>Verbindung</h3><p>{board.nodes.find((item) => item.id === edge.sourceId)?.title} → {board.nodes.find((item) => item.id === edge.targetId)?.title}</p><button className="secondary-button wb-danger" type="button" disabled={busy} onClick={() => void run(async () => { await window.studio.deleteWhiteboardEdge({ projectId, id: edge.id }); setSelectedEdge(null); })}><Trash2 size={14} /> Verbindung entfernen</button></>
        : <><h3>Verbinden</h3><p>Ziehe eine Linie zwischen Boxen oder wähle beide hier aus.</p><label>Von<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Box auswählen</option>{board.nodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Nach<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Box auswählen</option>{board.nodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <button className="secondary-button" type="button" disabled={busy || !sourceId || !targetId || sourceId === targetId} onClick={() => void run(() => window.studio.createWhiteboardEdge({ projectId, sourceId, targetId }))}><Link2 size={14} /> Verbinden</button></>}
      </aside>
    </div>
    {mapProposal ? <RepoMapPreview proposal={mapProposal} busy={mapBusy} error={mapError} onClose={() => { setMapProposal(null); setMapError(''); }} onAccept={(ids) => void acceptMap(ids)} /> : null}
  </div>;
}
