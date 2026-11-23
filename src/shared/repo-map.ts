export type RepoMapNodeKind = 'folder' | 'package' | 'component-candidate';

export interface RepoMapEvidence {
  kind: 'tracked-path' | 'package-manifest' | 'component-convention';
  path: string;
}

export interface RepoMapNode {
  id: string;
  kind: RepoMapNodeKind;
  path: string;
  title: string;
  x: number;
  y: number;
  evidence: RepoMapEvidence;
}

export interface RepoMapEdge {
  sourceId: string;
  targetId: string;
  kind: 'contains';
  evidence: RepoMapEvidence;
}

export interface RepoMapProposal {
  fingerprint: string;
  source: 'git-index';
  trackedFileCount: number;
  mappedFileCount: number;
  truncated: boolean;
  warnings: string[];
  nodes: RepoMapNode[];
  edges: RepoMapEdge[];
}

export interface RepoMapImportResult {
  createdNodes: number;
  reusedNodes: number;
  createdEdges: number;
  reusedEdges: number;
}
