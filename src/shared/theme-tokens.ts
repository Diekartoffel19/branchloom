export interface ThemeTokenDefinition {
  name: string;
  value: string;
  valueTruncated: boolean;
  path: string;
  line: number;
  sourceFingerprint: string;
}

export interface ThemeTokenInventory {
  projectId: string;
  scannedFiles: number;
  definitions: ThemeTokenDefinition[];
  partial: boolean;
  notes: string[];
}
