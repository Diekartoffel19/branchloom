import type { WireframeArtboard, WireframeElement } from './card-wireframe';

/** Project-local source pattern. Inserting it creates detached copies, never linked instances. */
export interface WireframeComponent {
  id: string;
  projectId: string;
  name: string;
  sourceArtboard: WireframeArtboard;
  width: number;
  height: number;
  /** Coordinates are relative to the source selection's upper-left corner. */
  elements: WireframeElement[];
  createdAt: string;
}

export interface SaveWireframeComponentInput {
  projectId: string;
  cardId: string;
  name: string;
  sourceArtboard: WireframeArtboard;
  elements: WireframeElement[];
}

export function instantiateWireframeComponent(
  component: WireframeComponent,
  canvasWidth: number,
  canvasHeight: number,
  nextId: (kind: 'item' | 'group') => string,
): WireframeElement[] {
  if (!component.elements.length || canvasWidth < 24 || canvasHeight < 24) return [];
  const scale = Math.min(1, (canvasWidth - 32) / component.width, (canvasHeight - 32) / component.height);
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const projectedWidth = Math.min(canvasWidth, Math.max(24, Math.round(component.width * scale)));
  const projectedHeight = Math.min(canvasHeight, Math.max(24, Math.round(component.height * scale)));
  const originX = Math.round((canvasWidth - projectedWidth) / 2);
  const originY = Math.round((canvasHeight - projectedHeight) / 2);
  const groups = new Map<string, string>();
  return component.elements.map((item) => {
    const width = Math.min(canvasWidth, Math.max(24, Math.round(item.width * scale)));
    const height = Math.min(canvasHeight, Math.max(24, Math.round(item.height * scale)));
    const x = Math.min(canvasWidth - width, Math.max(0, originX + Math.round(item.x * scale)));
    const y = Math.min(canvasHeight - height, Math.max(0, originY + Math.round(item.y * scale)));
    const groupId = item.groupId ? groups.get(item.groupId) ?? nextId('group') : undefined;
    if (item.groupId && !groups.has(item.groupId)) groups.set(item.groupId, groupId!);
    return { ...item, id: nextId('item'), x, y, width, height, ...(groupId ? { groupId } : {}) };
  });
}

/** Returns null without touching the draft when the artboard has no room. */
export function appendWireframeComponent(
  existing: WireframeElement[],
  component: WireframeComponent,
  canvasWidth: number,
  canvasHeight: number,
  nextId: (kind: 'item' | 'group') => string,
): { elements: WireframeElement[]; inserted: WireframeElement[] } | null {
  if (existing.length + component.elements.length > 40) return null;
  const inserted = instantiateWireframeComponent(component, canvasWidth, canvasHeight, nextId);
  if (!inserted.length) return null;
  return { elements: [...existing, ...inserted], inserted };
}
