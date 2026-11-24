export const WIREFRAME_WIDTH = 960;
export const WIREFRAME_HEIGHT = 600;
export const WIREFRAME_ARTBOARDS = {
  desktop: { label: 'Desktop', width: WIREFRAME_WIDTH, height: WIREFRAME_HEIGHT },
  tablet: { label: 'Tablet', width: 768, height: 1024 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
} as const;
export type WireframeArtboard = keyof typeof WIREFRAME_ARTBOARDS;
export type WireframeVariant = Exclude<WireframeArtboard, 'desktop'>;

export type WireframeElementKind = 'panel' | 'text' | 'button' | 'field';
export type WireframeElementTone = 'plain' | 'muted' | 'accent';

/** Optional overrides keep older drafts and their approvals unchanged. Colors are opaque hex values. */
export interface WireframeElementStyle {
  fill?: string;
  stroke?: string;
  textColor?: string;
  radius?: number;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700;
}

export interface WireframeElement {
  id: string;
  kind: WireframeElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  tone: WireframeElementTone;
  style?: WireframeElementStyle;
}

export interface CardWireframe {
  projectId: string;
  cardId: string;
  title: string;
  elements: WireframeElement[];
  artboards: Partial<Record<WireframeVariant, WireframeElement[]>>;
  revision: number;
  approvedRevision: number | null;
  updatedAt: string;
}

export interface SaveCardWireframeInput {
  projectId: string;
  cardId: string;
  expectedRevision: number;
  title: string;
  elements: WireframeElement[];
  /** Omission by older callers preserves already saved variants. */
  artboards?: Partial<Record<WireframeVariant, WireframeElement[]>>;
}

export interface CardWireframeKey { projectId: string; cardId: string }

/** Unsaved proposal from an explicitly started read-only CLI call. */
export interface WireframeProposal { title: string; elements: WireframeElement[]; sourceCardUpdatedAt: string }
