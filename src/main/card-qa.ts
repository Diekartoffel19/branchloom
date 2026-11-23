import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import type { BrowserDiagnostic, CardQaReport } from '../shared/types';
import { diagnosticSource, isLocalDevUrl, normalizeBrowserAddress } from './browser-policy';
import type { StudioStore } from './store';

const MAX_FINDINGS = 20;
const MAX_REPORTS = 20;
const LOAD_TIMEOUT_MS = 15_000;
const SETTLE_MS = 900;
const activeCards = new Set<string>();

type ReportRow = { id: string; card_id: string; project_id: string; requested_url: string; final_url: string | null; started_at: string; ended_at: string; status: CardQaReport['status']; diagnostics_json: string; note: string | null };
const reportFromRow = (row: ReportRow): CardQaReport => ({ id: row.id, cardId: row.card_id, projectId: row.project_id, requestedUrl: row.requested_url, finalUrl: row.final_url, startedAt: row.started_at, endedAt: row.ended_at, status: row.status, diagnostics: JSON.parse(row.diagnostics_json) as BrowserDiagnostic[], note: row.note });

export function installCardQa(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS card_qa_reports (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requested_url TEXT NOT NULL, final_url TEXT, started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL, status TEXT NOT NULL, diagnostics_json TEXT NOT NULL, note TEXT
  ); CREATE INDEX IF NOT EXISTS card_qa_reports_card ON card_qa_reports(card_id, ended_at DESC);`);
}

export function normalizeCardQaUrl(value: string): string {
  if (typeof value !== 'string') throw new Error('Gib die lokale Vorschau-Adresse ein.');
  const url = normalizeBrowserAddress(value);
  if (!isLocalDevUrl(url)) throw new Error('Auto-QA erlaubt nur localhost, 127.0.0.1 oder [::1].');
  return url;
}

export function cardQaReports(store: StudioStore, cardId: string): CardQaReport[] {
  store.card(cardId);
  return (store.db.prepare(`SELECT * FROM card_qa_reports WHERE card_id = ? ORDER BY ended_at DESC, rowid DESC LIMIT ${MAX_REPORTS}`).all(cardId) as ReportRow[]).map(reportFromRow);
}

function persist(store: StudioStore, report: CardQaReport): CardQaReport {
  store.db.transaction(() => {
    store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(report.id, report.cardId, report.projectId, report.requestedUrl, report.finalUrl, report.startedAt, report.endedAt, report.status, JSON.stringify(report.diagnostics), report.note);
    store.db.prepare(`DELETE FROM card_qa_reports WHERE card_id = ? AND id NOT IN (
      SELECT id FROM card_qa_reports WHERE card_id = ? ORDER BY ended_at DESC, rowid DESC LIMIT ${MAX_REPORTS})`).run(report.cardId, report.cardId);
  })();
  return report;
}

/** An explicit page-load QA pass in a fresh in-memory browser partition. Branchloom itself does not run an agent or write to the checkout; page JavaScript may call its own local server. */
export async function runCardQa(store: StudioStore, input: { cardId: string; url: string }): Promise<CardQaReport> {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const url = normalizeCardQaUrl(input.url);
  if (activeCards.has(card.id)) throw new Error('Für diese Karte läuft bereits eine QA-Prüfung.');
  activeCards.add(card.id);
  const startedAt = new Date().toISOString();
  const diagnostics: BrowserDiagnostic[] = [];
  const origin = new URL(url).origin;
  const pushFinding = (kind: BrowserDiagnostic['kind'], rawMessage: string, rawSource: string, line: number | null): void => {
    const message = rawMessage.trim().slice(0, 2_000);
    if (!message) return;
    const sourceUrl = diagnosticSource(rawSource);
    if (diagnostics.some((item) => item.kind === kind && item.message === message && item.sourceUrl === sourceUrl && item.line === line)) return;
    diagnostics.push({ id: randomUUID(), kind, message, pageUrl: diagnosticSource(url)!, sourceUrl, line: Number.isSafeInteger(line) && line !== null && line > 0 ? line : null, capturedAt: new Date().toISOString() });
    if (diagnostics.length > MAX_FINDINGS) diagnostics.shift();
  };
  let qaWindow: BrowserWindow | null = null;
  let timeout: NodeJS.Timeout | null = null;
  let finalUrl: string | null = null;
  let note: string | null = null;
  let status: CardQaReport['status'] = 'error';
  try {
    qaWindow = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      webviewTag: false, backgroundThrottling: false, partition: `branchloom-qa-${randomUUID()}`,
    } });
    const contents = qaWindow.webContents;
    const qaSession = contents.session;
    qaSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    qaSession.setPermissionCheckHandler(() => false);
    qaSession.on('will-download', (event) => event.preventDefault());
    qaSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allowed = false;
      try { allowed = new URL(details.url).origin === origin; } catch { /* blocked */ }
      if (!allowed) pushFinding('load', 'Anfrage außerhalb der lokalen Vorschau-Origin blockiert.', details.url, null);
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event: Electron.Event & { url: string }): void => {
      let allowed = false;
      try { allowed = new URL(event.url).origin === origin; } catch { /* blocked */ }
      if (!allowed) {
        pushFinding('load', 'Navigation außerhalb der lokalen Vorschau-Origin blockiert.', event.url, null);
        event.preventDefault();
      }
    };
    contents.on('will-navigate', restrictNavigation);
    contents.on('will-redirect', restrictNavigation);
    contents.on('console-message', (event) => { if (event.level === 'error') pushFinding('console', event.message, event.sourceId, event.lineNumber); });
    contents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3) pushFinding('load', `${description} (${code})`, failedUrl, null);
    });
    await Promise.race([
      contents.loadURL(url),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Lokale Vorschau antwortete nicht innerhalb von 15 Sekunden.')), LOAD_TIMEOUT_MS); }),
    ]);
    if (timeout) { clearTimeout(timeout); timeout = null; }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const loaded = contents.getURL();
    finalUrl = diagnosticSource(loaded);
    if (!loaded || new URL(loaded).origin !== origin) {
      status = 'error'; note = 'Die Vorschau wurde nicht auf der erwarteten lokalen Origin geladen.';
    } else {
      status = diagnostics.length ? 'failed' : 'passed';
    }
  } catch (reason) {
    note = (reason instanceof Error ? reason.message : String(reason)).replaceAll(url, diagnosticSource(url)!);
    if (note.length > 2_000) note = note.slice(0, 2_000);
    status = 'error';
  } finally {
    if (timeout) clearTimeout(timeout);
    if (qaWindow && !qaWindow.isDestroyed()) qaWindow.destroy();
    activeCards.delete(card.id);
  }
  return persist(store, { id: randomUUID(), cardId: card.id, projectId: card.projectId, requestedUrl: diagnosticSource(url)!, finalUrl, startedAt, endedAt: new Date().toISOString(), status, diagnostics, note });
}
