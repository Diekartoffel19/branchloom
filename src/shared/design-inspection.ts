import type { ThemeTokenDefinition } from './theme-tokens';

export interface ThemePreviewInput {
  projectId: string;
  token: ThemeTokenDefinition;
  value: string;
}

export interface DesignSelection {
  id: string;
  projectId: string;
  sourceUrl: string;
  selector: string;
  tag: string;
  text: string;
  styles: Record<string, string>;
  tokens: Array<{ name: string; value: string }>;
  capturedAt: string;
}

export interface DesignInspectionState {
  projectId: string | null;
  sourceUrl: string | null;
  ready: boolean;
  armed: boolean;
  themePreview: { name: string; value: string; path: string; line: number } | null;
}
