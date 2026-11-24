export interface WhiteboardDirectImporter {
  path: string;
  targetPath: string;
  specifier: string;
  line: number;
  sourceFingerprint: string;
}

export interface WhiteboardImpact {
  nodeId: string;
  referencePath: string;
  referenceKind: 'file' | 'folder';
  scannedFiles: number;
  importers: WhiteboardDirectImporter[];
  partial: boolean;
  notes: string[];
}
