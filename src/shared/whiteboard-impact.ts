export interface WhiteboardDirectImporter {
  path: string;
  targetPath: string;
  specifier: string;
  line: number;
  sourceFingerprint: string;
}

/** A shortest, source-backed chain from an indirect importer to the selected reference. */
export interface WhiteboardTransitiveImporter {
  path: string;
  depth: number;
  chain: WhiteboardDirectImporter[];
}

export interface WhiteboardImpact {
  nodeId: string;
  referencePath: string;
  referenceKind: 'file' | 'folder';
  scannedFiles: number;
  importers: WhiteboardDirectImporter[];
  transitiveImporters: WhiteboardTransitiveImporter[];
  partial: boolean;
  notes: string[];
}
