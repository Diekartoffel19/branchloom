import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TrelloBoardSummary, TrelloConnectionStatus } from '../shared/types';

const TRELLO_ID = /^[a-f0-9]{24}$/i;
const API_KEY = /^[a-z0-9]{16,128}$/i;
const API_TOKEN = /^[a-z0-9]{16,256}$/i;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

interface Credential { key: string; token: string; memberName: string }
interface Encryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validatedCredential(value: unknown): Credential {
  const item = record(value);
  if (!item || typeof item.key !== 'string' || !API_KEY.test(item.key) || typeof item.token !== 'string' || !API_TOKEN.test(item.token) || typeof item.memberName !== 'string') {
    throw new Error('Die lokale Trello-Verbindung ist beschädigt. Bitte trennen und neu verbinden.');
  }
  return { key: item.key, token: item.token, memberName: item.memberName };
}

/** A read-only Trello source. Credentials stay encrypted in the local app profile. */
export class TrelloConnection {
  private readonly file: string;

  constructor(dataDirectory: string, private readonly secure: Encryptor, private readonly request: typeof fetch = fetch) {
    this.file = join(dataDirectory, 'trello-connection.bin');
  }

  async status(): Promise<TrelloConnectionStatus> {
    if (!existsSync(this.file)) return { connected: false, memberName: null };
    const saved = await this.credential();
    return { connected: true, memberName: saved.memberName };
  }

  authorizationUrl(key: string): string {
    if (typeof key !== 'string' || !API_KEY.test(key)) throw new Error('Bitte einen gültigen Trello-API-Key eingeben.');
    const url = new URL('https://trello.com/1/authorize');
    url.searchParams.set('key', key);
    url.searchParams.set('name', 'Branchloom');
    url.searchParams.set('expiration', '30days');
    url.searchParams.set('scope', 'read');
    url.searchParams.set('response_type', 'token');
    return url.toString();
  }

  async connect(input: { key: string; token: string }): Promise<TrelloConnectionStatus> {
    if (!input || typeof input.key !== 'string' || !API_KEY.test(input.key)) throw new Error('Bitte einen gültigen Trello-API-Key eingeben.');
    if (typeof input.token !== 'string' || !API_TOKEN.test(input.token)) throw new Error('Bitte den von Trello angezeigten Token eingeben.');
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Sichere Windows-Speicherung ist gerade nicht verfügbar. Die Verbindung wurde nicht gespeichert.');
    const member = record(await this.get('/members/me', { fields: 'fullName,username' }, { key: input.key, token: input.token, memberName: '' }));
    if (!member || typeof member.id !== 'string' || !TRELLO_ID.test(member.id)) throw new Error('Trello hat das Konto nicht bestätigt.');
    const memberName = typeof member.fullName === 'string' && member.fullName.trim() ? member.fullName.trim().slice(0, 120)
      : typeof member.username === 'string' ? member.username.trim().slice(0, 120) : 'Trello-Konto';
    const credential: Credential = { key: input.key, token: input.token, memberName };
    let encrypted: Buffer;
    try { encrypted = await this.secure.encryptStringAsync(JSON.stringify(credential)); }
    catch { throw new Error('Trello-Zugang konnte nicht sicher gespeichert werden.'); }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
    return { connected: true, memberName };
  }

  async disconnect(): Promise<void> { await rm(this.file, { force: true }); }

  async boards(): Promise<TrelloBoardSummary[]> {
    const credential = await this.credential();
    const value = await this.get('/members/me/boards', { fields: 'name,closed', filter: 'open' }, credential);
    if (!Array.isArray(value) || value.length > 500) throw new Error('Trello hat zu viele oder ungültige Boards geliefert.');
    const boards = value.map(record);
    if (boards.some((board) => !board || typeof board.id !== 'string' || !TRELLO_ID.test(board.id) || typeof board.name !== 'string')) throw new Error('Trello hat eine ungültige Board-Liste geliefert.');
    return boards.filter((board) => board!.closed !== true).map((board) => ({ id: board!.id as string, name: (board!.name as string).slice(0, 200) }));
  }

  async boardJson(boardId: string): Promise<string> {
    if (typeof boardId !== 'string' || !TRELLO_ID.test(boardId)) throw new Error('Bitte ein gültiges Trello-Board wählen.');
    const credential = await this.credential();
    const base = `/boards/${boardId}`;
    const [boardValue, lists, labels] = await Promise.all([
      this.get(base, { fields: 'name' }, credential),
      this.get(`${base}/lists/all`, { fields: 'name' }, credential),
      this.get(`${base}/labels`, { fields: 'name', limit: '1000' }, credential),
    ]);
    const board = record(boardValue);
    if (!board || board.id !== boardId || typeof board.name !== 'string' || !Array.isArray(lists) || !Array.isArray(labels) || labels.length >= 1000) {
      throw new Error('Trello hat unvollständige Board-Daten geliefert. Nutze gegebenenfalls den JSON-Export.');
    }
    const cards: unknown[] = [];
    let before: string | null = null;
    while (true) {
      const page = await this.get(`${base}/cards/all`, { fields: 'name,desc,idList,closed,idLabels', limit: '1000', ...(before ? { before } : {}) }, credential);
      if (!Array.isArray(page)) throw new Error('Trello hat keine gültige Kartenliste geliefert.');
      cards.push(...page);
      if (cards.length > 5000) throw new Error('Mehr als 5.000 Karten: Bitte den Trello-JSON-Export verwenden.');
      if (page.length < 1000) break;
      const last = record(page.at(-1));
      const next = last?.id;
      if (typeof next !== 'string' || !TRELLO_ID.test(next) || next === before) throw new Error('Trello-Karten konnten nicht vollständig gelesen werden.');
      before = next;
    }
    const raw = JSON.stringify({ id: boardId, name: board.name, lists, labels, cards });
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Das Board ist größer als 8 MiB. Bitte den Trello-JSON-Export verwenden.');
    return raw;
  }

  private async credential(): Promise<Credential> {
    let encrypted: Buffer;
    try { encrypted = await readFile(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Trello ist noch nicht verbunden.');
      throw new Error('Die lokale Trello-Verbindung konnte nicht gelesen werden.');
    }
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Sichere Windows-Speicherung ist gerade nicht verfügbar.');
    try {
      const decrypted = await this.secure.decryptStringAsync(encrypted);
      return validatedCredential(JSON.parse(decrypted.result) as unknown);
    }
    catch { throw new Error('Die lokale Trello-Verbindung konnte nicht entschlüsselt werden. Bitte neu verbinden.'); }
  }

  private async get(path: string, params: Record<string, string>, credential: Credential): Promise<unknown> {
    const url = new URL(`https://api.trello.com/1${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.request(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `OAuth oauth_consumer_key="${credential.key}", oauth_token="${credential.token}"` },
        // A Trello endpoint must never send the credential-bearing request to a redirect target.
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Trello ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut.'); }
    if (response.status === 401 || response.status === 403) throw new Error('Trello-Zugriff abgelaufen, widerrufen oder nicht erlaubt. Bitte neu verbinden.');
    if (response.status === 429) throw new Error('Trello begrenzt derzeit Anfragen. Bitte später erneut versuchen.');
    if (!response.ok) throw new Error(`Trello-Anfrage fehlgeschlagen (HTTP ${response.status}).`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('Trello-Antwort ist größer als 8 MiB.');
    if (!response.body) throw new Error('Trello hat keine Antwortdaten geliefert.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Trello-Antwort ist größer als 8 MiB.'); }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } catch (error) {
      if (error instanceof Error && error.message.includes('größer als 8 MiB')) throw error;
      throw new Error('Trello-Antwort konnte nicht gelesen werden. Bitte erneut versuchen.');
    }
    try { return JSON.parse(raw) as unknown; }
    catch { throw new Error('Trello hat keine gültigen JSON-Daten geliefert.'); }
  }
}
