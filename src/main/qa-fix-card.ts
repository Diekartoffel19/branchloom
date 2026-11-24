import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Card, CardQaReport } from '../shared/types';
import type { CreateQaFixCard, QaFixCardPreview } from '../shared/qa-fix-card';
import { cardQaReports } from './card-qa';
import type { StudioStore } from './store';

const compact = (text: string, max: number): string => text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function installQaFixCards(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS qa_fix_cards (
    report_id TEXT PRIMARY KEY REFERENCES card_qa_reports(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE
  );`);
}

function source(store: StudioStore, input: { projectId: string; sourceCardId: string; reportId: string }): { card: Card; report: CardQaReport } {
  if (!input || typeof input.projectId !== 'string' || typeof input.sourceCardId !== 'string' || typeof input.reportId !== 'string'
    || input.projectId.length > 200 || input.sourceCardId.length > 200 || input.reportId.length > 200) throw new Error('Ungültige QA-Quelle.');
  store.project(input.projectId);
  const card = store.card(input.sourceCardId);
  if (card.projectId !== input.projectId) throw new Error('QA-Karte gehört zu einem anderen Projekt.');
  if (card.archivedAt) throw new Error('Archivierte Quellkarte zuerst wiederherstellen.');
  const report = cardQaReports(store, card.id).find((item) => item.id === input.reportId);
  if (!report || report.projectId !== input.projectId || report.cardId !== card.id) throw new Error('QA-Bericht ist nicht mehr auf dieser Karte gespeichert.');
  if (report.status !== 'failed' && report.status !== 'error') throw new Error('Nur fehlgeschlagene oder nicht abgeschlossene QA-Berichte ergeben eine Fixkarte.');
  return { card, report };
}

function tokenFor(report: CardQaReport): string {
  return createHash('sha256').update(JSON.stringify({ id: report.id, cardId: report.cardId, projectId: report.projectId,
    requestedUrl: report.requestedUrl, endedAt: report.endedAt, status: report.status, diagnostics: report.diagnostics, note: report.note })).digest('hex');
}

function sourceLine(report: CardQaReport, card: Card): string {
  return `Quelle: lokaler QA-Bericht ${report.id} auf Karte „${compact(card.title, 120)}“.`;
}

export function previewQaFixCard(store: StudioStore, input: { projectId: string; sourceCardId: string; reportId: string }): QaFixCardPreview {
  const { card, report } = source(store, input);
  const path = new URL(report.requestedUrl).pathname;
  const title = `QA-Fehler auf ${compact(path, 105) || '/'}`;
  const findings = report.diagnostics.slice(0, 3).map((item) => `- ${item.kind === 'console' ? 'Konsole' : 'Laden'}: ${compact(item.message, 300)}`);
  const description = [
    `Route: ${compact(report.requestedUrl, 500)}`,
    `Prüfung: ${report.endedAt}`,
    `Status: ${report.status === 'failed' ? 'Fehler gefunden' : 'nicht abgeschlossen'}`,
    ...(findings.length ? findings : [report.note ? `Hinweis: ${compact(report.note, 300)}` : 'Hinweis: Bericht auf der Quellkarte prüfen.']),
    'Reproduktion: bitte ergänzen.',
    'Prüfkriterium: Fehler reproduzieren, beheben und diese Route erneut lokal prüfen.',
  ].join('\n');
  return { reportId: report.id, sourceCardId: card.id, token: tokenFor(report), title, description };
}

export function createQaFixCard(store: StudioStore, input: CreateQaFixCard): Card {
  if (!input || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)
    || typeof input.columnId !== 'string' || typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.length > 200
    || typeof input.description !== 'string' || input.description.length > 5_000 || input.description.includes('\0')) throw new Error('Ungültiger Fixkarten-Entwurf.');
  return store.db.transaction(() => {
    const { card: sourceCard, report } = source(store, input);
    if (tokenFor(report) !== input.token) throw new Error('QA-Bericht hat sich geändert. Entwurf erneut vorbereiten.');
    const existing = store.db.prepare('SELECT card_id FROM qa_fix_cards WHERE report_id = ? AND project_id = ?').get(report.id, input.projectId) as { card_id: string } | undefined;
    if (existing) return store.card(existing.card_id);
    const column = store.column(input.columnId);
    if (column.projectId !== input.projectId) throw new Error('Zielspalte gehört zu einem anderen Projekt.');
    if (column.autoStart) throw new Error('Zielspalte startet Agenten automatisch. Wähle eine manuelle Spalte.');
    if (column.name.trim().toLocaleLowerCase('de-DE') === 'to do' && store.projectQueue(input.projectId).state === 'running') {
      throw new Error('Die laufende To-do-Warteschlange könnte diese Karte starten. Pausiere sie oder wähle eine andere Spalte.');
    }
    const origin = sourceLine(report, sourceCard);
    const body = input.description.trim();
    const card = store.createCard({ projectId: input.projectId, columnId: input.columnId, title: input.title,
      description: `${body}${body ? '\n\n' : ''}${origin}` });
    store.db.prepare('INSERT INTO qa_fix_cards (report_id, project_id, card_id) VALUES (?, ?, ?)').run(report.id, input.projectId, card.id);
    return card;
  })();
}
