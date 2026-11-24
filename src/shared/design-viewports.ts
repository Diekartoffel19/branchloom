export type DesignViewportSize = 'desktop' | 'tablet' | 'mobile';

export interface DesignViewportCapture {
  size: DesignViewportSize;
  width: number;
  height: number;
  sourceUrl: string;
  capturedAt: string | null;
  image: string | null;
  error: string | null;
}

export interface DesignViewportResult {
  projectId: string;
  sourceUrl: string;
  captures: DesignViewportCapture[];
}
