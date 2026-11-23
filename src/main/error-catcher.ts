import type { BrowserDiagnostic, Card } from '../shared/types';
import type { StudioStore } from './store';

/** A diagnostic remains ephemeral until the user explicitly makes a local task from it. */
export function createDiagnosticCard(store: StudioStore, input: { projectId: string; columnId: string; reproduction: string }, diagnostic: BrowserDiagnostic): Card {
  return store.db.transaction(() => {
    store.project(input.projectId);
    const column = store.column(input.columnId);
    if (column.projectId !== input.projectId) throw new Error('Die gewählte Spalte gehört zu einem anderen Projekt.');
    if (column.name.trim().toLocaleLowerCase('de-DE') === 'to do' && store.projectQueue(input.projectId).state === 'running') {
      throw new Error('Die laufende To-do-Warteschlange könnte diese Karte sofort starten. Pausiere sie oder wähle eine andere Spalte.');
    }
    const reproduction = input.reproduction.trim();
    if (reproduction.length > 2_000) throw new Error('Die Reproduktionsschritte sind zu lang.');
    const title = `Browserfehler: ${diagnostic.message.split(/\r?\n/u)[0]!.slice(0, 115)}`;
    const description = [
      'Beobachtet im eingebetteten Browser (lokaler Dev-Server).',
      `Quelle: ${diagnostic.kind === 'console' ? 'Konsolenfehler' : 'Ladefehler'}`,
      `Zeitpunkt: ${diagnostic.capturedAt}`,
      `Seite: ${diagnostic.pageUrl}`,
      diagnostic.sourceUrl ? `Datei: ${diagnostic.sourceUrl}${diagnostic.line ? `:${diagnostic.line}` : ''}` : null,
      `Fehler: ${diagnostic.message}`,
      reproduction ? `Reproduktion: ${reproduction}` : 'Reproduktion: noch nicht beschrieben.',
      'Prüfkriterium: Fehler reproduzieren, beheben und den betroffenen Ablauf erneut prüfen.',
    ].filter(Boolean).join('\n');
    return store.createCard({ projectId: input.projectId, columnId: input.columnId, title, description });
  })();
}
