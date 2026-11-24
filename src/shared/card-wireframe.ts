export const WIREFRAME_WIDTH = 960;
export const WIREFRAME_HEIGHT = 600;

export type WireframeElementKind = 'panel' | 'text' | 'button' | 'field';
export type WireframeElementTone = 'plain' | 'muted' | 'accent';

export interface WireframeElement {
  id: string;
  kind: WireframeElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  tone: WireframeElementTone;
}

export interface CardWireframe {
  projectId: string;
  cardId: string;
  title: string;
  elements: WireframeElement[];
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
}

export interface CardWireframeKey { projectId: string; cardId: string }
