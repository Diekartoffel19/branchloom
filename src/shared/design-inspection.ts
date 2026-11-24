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
}
