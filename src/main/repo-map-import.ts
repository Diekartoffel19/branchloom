import type { RepoMapImportResult, RepoMapProposal } from '../shared/repo-map';
import type { StudioStore } from './store';
import { proposeRepoMap } from './repo-map';
import { createWhiteboardEdge, createWhiteboardNode, whiteboardSnapshot } from './whiteboard';

export async function previewRepoMap(store: StudioStore, projectId: string): Promise<RepoMapProposal> {
  return proposeRepoMap(store.project(projectId).path);
}

/** Re-scan before committing; selection is all-or-nothing in one SQLite transaction. */
export async function acceptRepoMap(store: StudioStore, input: { projectId: string; fingerprint: string; nodeIds: string[] }): Promise<RepoMapImportResult> {
  if (!input || typeof input.projectId !== 'string' || typeof input.fingerprint !== 'string'
    || !Array.isArray(input.nodeIds) || input.nodeIds.length > 160 || input.nodeIds.some((id) => typeof id !== 'string')
    || new Set(input.nodeIds).size !== input.nodeIds.length) throw new Error('Repo-Auswahl ist ungültig.');
  const proposal = await previewRepoMap(store, input.projectId);
  if (input.fingerprint !== proposal.fingerprint) throw new Error('Die Git-Struktur hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
  const selected = new Set(input.nodeIds);
  if (selected.size === 0) throw new Error('Wähle mindestens eine Box für die Übernahme.');
  const byId = new Map(proposal.nodes.map((node) => [node.id, node]));
  if ([...selected].some((id) => !byId.has(id))) throw new Error('Repo-Auswahl enthält einen unbekannten Knoten. Bitte erneut prüfen.');

  return store.db.transaction(() => {
    const current = whiteboardSnapshot(store, input.projectId);
    const byReference = new Map(current.nodes.filter((node) => node.reference?.kind === 'folder' || node.reference?.kind === 'file')
      .map((node) => [`${node.reference!.kind}:${(node.reference as { path: string }).path.replaceAll('\\', '/')}`, node.id]));
    const mapping = new Map<string, string>();
    const existingEdges = new Set(current.edges.map((edge) => `${edge.sourceId}\0${edge.targetId}`));
    let createdNodes = 0; let reusedNodes = 0; let createdEdges = 0; let reusedEdges = 0;
    const xOffset = Math.max(0, ...current.nodes.map((node) => node.x + 240));
    for (const candidate of proposal.nodes) {
      if (!selected.has(candidate.id)) continue;
      const kind = candidate.kind === 'component-candidate' ? 'file' : 'folder';
      const key = `${kind}:${candidate.path}`;
      let id = byReference.get(key);
      if (id) reusedNodes += 1;
      else {
        const prefix = candidate.kind === 'component-candidate' ? 'Mögliche UI-Komponente' : candidate.kind === 'package' ? 'Paketordner' : 'Ordner';
        const node = createWhiteboardNode(store, { projectId: input.projectId, title: candidate.title,
          description: `${prefix}; Beleg: ${candidate.evidence.path}`, x: xOffset + candidate.x, y: candidate.y,
          reference: { kind, path: candidate.path } });
        id = node.id;
        byReference.set(key, id);
        createdNodes += 1;
      }
      mapping.set(candidate.id, id);
    }
    for (const candidate of proposal.edges) {
      const sourceId = mapping.get(candidate.sourceId);
      const targetId = mapping.get(candidate.targetId);
      if (!sourceId || !targetId) continue;
      const key = `${sourceId}\0${targetId}`;
      if (existingEdges.has(key)) { reusedEdges += 1; continue; }
      createWhiteboardEdge(store, { projectId: input.projectId, sourceId, targetId, label: 'enthält' });
      existingEdges.add(key);
      createdEdges += 1;
    }
    return { createdNodes, reusedNodes, createdEdges, reusedEdges };
  })();
}
