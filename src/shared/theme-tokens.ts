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

export interface ThemeTokenEditPreview {
  projectId: string;
  token: ThemeTokenDefinition;
  value: string;
  before: string;
  after: string;
  reviewToken: string;
}

export interface ThemeTokenEditResult {
  projectId: string;
  before: string;
  after: string;
  token: ThemeTokenDefinition;
  previousValue: string;
}
