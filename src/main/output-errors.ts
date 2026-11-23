import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Card, CommandTerminal, Session } from '../shared/types';
import type { CreateOutputErrorCard, OutputErrorCandidate, OutputErrorPreview, OutputErrorSourceKind } from '../shared/output-errors';
import type { StudioStore } from './store';

const MAX_OUTPUT = 50_000;
const MAX_CANDIDATES = 20;
const MAX_REPRODUCTION = 2_000;
const errorLine = /^(?:\[stderr\]\s*)?(?:error\b|fatal\b|exception\b|failed\b|npm err!|[\w.]+error:)/i;

export function installOutputErrors(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS output_error_cards (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('session','command')),
    source_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    PRIMARY KEY(source_kind, source_id, candidate_id)
  );`);
}

function cleanOutput(output: string): string {
  return output.slice(-MAX_OUTPUT)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** Only recognizable error lines from saved output become selectable; no model invents a candidate. */
export function outputErrorCandidates(output: string): OutputErrorCandidate[] {
  const lines = cleanOutput(output).split(/\r\n|\r|\n/);
  const found: OutputErrorCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const message = lines[index]!.trim().replace(/\s+/g, ' ');
    if (message.length < 12 || message.length > 400 || !errorLine.test(message)) continue;
    found.push({ id: createHash('sha256').update(`${index}:${message}`).digest('hex'), line: index + 1, message });
    if (found.length > MAX_CANDIDATES) found.shift();
  }
  return found;
}

function sourceFor(store: StudioStore, projectId: string, sourceKind: OutputErrorSourceKind, sourceId: string): { output: string; endedAt: string; label: string } {
  store.project(projectId);
  if (sourceKind === 'session') {
    const session: Session = store.sessionForProject(projectId, sourceId);
    if (session.state === 'running' || !session.endedAt) throw new Error('Laufende Agentenausgabe zuerst abschließen.');
    const card = store.card(session.cardId);
    return { output: session.output, endedAt: session.endedAt, label: `Agentenlauf auf Karte „${card.title}“` };
  }
  if (sourceKind === 'command') {
    const terminal: CommandTerminal = store.commandTerminal(sourceId);
    if (terminal.projectId !== projectId) throw new Error('Terminal gehört nicht zu diesem Projekt.');
    if (terminal.state === 'running' || !terminal.endedAt) throw new Error('Laufendes Befehlsterminal zuerst abschließen.');
    return { output: terminal.output, endedAt: terminal.endedAt, label: terminal.shell === 'powershell' ? 'PowerShell-Befehlsterminal' : 'cmd-Befehlsterminal' };
  }
  throw new Error('Unbekannte Ausgabequelle.');
}

export function previewOutputErrors(store: StudioStore, input: { projectId: string; sourceKind: OutputErrorSourceKind; sourceId: string }): OutputErrorPreview {
  if (!input || typeof input.projectId !== 'string' || typeof input.sourceId !== 'string' || input.sourceId.length > 200) throw new Error('Ungültige Ausgabequelle.');
  const source = sourceFor(store, input.projectId, input.sourceKind, input.sourceId);
  return { sourceKind: input.sourceKind, sourceId: input.sourceId, sourceLabel: source.label, endedAt: source.endedAt, candidates: outputErrorCandidates(source.output) };
}

export function createOutputErrorCard(store: StudioStore, input: CreateOutputErrorCard): Card {
  if (!input || typeof input.columnId !== 'string' || typeof input.candidateId !== 'string' || !/^[a-f0-9]{64}$/.test(input.candidateId)
    || typeof input.reproduction !== 'string' || input.reproduction.length > MAX_REPRODUCTION || input.reproduction.includes('\0')) throw new Error('Ungültiger Fehlerkarten-Auftrag.');
  return store.db.transaction(() => {
    const preview = previewOutputErrors(store, input);
    const candidate = preview.candidates.find((item) => item.id === input.candidateId);
    if (!candidate) throw new Error('Fehlerstelle nicht mehr vorhanden. Ausgabe erneut prüfen.');
    const existing = store.db.prepare('SELECT card_id FROM output_error_cards WHERE source_kind = ? AND source_id = ? AND candidate_id = ?')
      .get(input.sourceKind, input.sourceId, input.candidateId) as { card_id: string } | undefined;
    if (existing) return store.card(existing.card_id);
    const column = store.column(input.columnId);
    if (column.projectId !== input.projectId) throw new Error('Die gewählte Spalte gehört zu einem anderen Projekt.');
    if (column.name.trim().toLocaleLowerCase('de-DE') === 'to do' && store.projectQueue(input.projectId).state === 'running') {
      throw new Error('Die laufende To-do-Warteschlange könnte diese Karte sofort starten. Pausiere sie oder wähle eine andere Spalte.');
    }
    const reproduction = input.reproduction.trim();
    const card = store.createCard({ projectId: input.projectId, columnId: input.columnId,
      title: `Fehler aus Ausgabe: ${candidate.message.slice(0, 115)}`,
      description: [
        `Beobachtet in gespeicherter lokaler Ausgabe: ${preview.sourceLabel}.`,
        `Quelltyp: ${input.sourceKind === 'session' ? 'Karten-Agentenlauf' : 'Befehlsterminal'}`,
        `Quell-ID: ${input.sourceId}`,
        `Beendet: ${preview.endedAt}`,
        `Zeile im begrenzten Ausgabeauszug: ${candidate.line}`,
        `Fehler: ${candidate.message}`,
        reproduction ? `Reproduktion: ${reproduction}` : 'Reproduktion: noch nicht beschrieben.',
        'Prüfkriterium: Ursache und Ablauf anhand der Originalausgabe prüfen; Fehler reproduzieren und danach erneut testen.',
      ].join('\n') });
    store.db.prepare('INSERT INTO output_error_cards (project_id, source_kind, source_id, candidate_id, card_id) VALUES (?, ?, ?, ?, ?)')
      .run(input.projectId, input.sourceKind, input.sourceId, input.candidateId, card.id);
    return card;
  })();
}
