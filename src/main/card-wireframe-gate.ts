import type { StudioStore } from './store';
import { cardWireframe } from './card-wireframe';

/** The card setting is explicit. A saved draft alone never authorizes a coding agent. */
export function wireframeStartBlockReason(store: StudioStore, cardId: string): string | null {
  const card = store.card(cardId);
  if (!card.wireframeRequired) return null;
  const document = cardWireframe(store, { projectId: card.projectId, cardId });
  if (document && document.approvedRevision === document.revision) return null;
  return 'Diese Karte verlangt vor einem Agentenstart einen gespeicherten, aktuell freigegebenen Wireframe. Öffne die Karte im Designbereich, speichere den Entwurf und gib ihn ausdrücklich frei.';
}

export function assertCardWireframeReady(store: StudioStore, cardId: string): void {
  const reason = wireframeStartBlockReason(store, cardId);
  if (reason) throw new Error(reason);
}
