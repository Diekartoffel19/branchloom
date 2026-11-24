import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { TrelloConnection } from '../../src/main/trello-connection';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const key = 'a'.repeat(32);
const token = 'b'.repeat(64);
const ids = { member: '111111111111111111111111', board: '222222222222222222222222', list: '333333333333333333333333', card: '444444444444444444444444' };

const secure = {
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: Buffer.from(value.toString().slice(7), 'base64').toString(), shouldReEncrypt: false })),
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-trello-live-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  return { root, store, project, column };
}

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function service(request?: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(url.origin).toBe('https://api.trello.com');
    expect(url.searchParams.has('key')).toBe(false);
    expect(url.searchParams.has('token')).toBe(false);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(String((init?.headers as Record<string, string>)?.Authorization)).toContain(`oauth_consumer_key="${key}"`);
    if (request) return request(url);
    if (url.pathname === '/1/members/me') return reply({ id: ids.member, fullName: 'Demo Person' });
    if (url.pathname === '/1/members/me/boards') return reply([{ id: ids.board, name: 'Demo Board', closed: false }]);
    if (url.pathname === `/1/boards/${ids.board}`) return reply({ id: ids.board, name: 'Demo Board' });
    if (url.pathname.endsWith('/lists/all')) return reply([{ id: ids.list, name: 'Backlog' }]);
    if (url.pathname.endsWith('/labels')) return reply([{ id: '555555555555555555555555', name: 'Test' }]);
    if (url.pathname.endsWith('/cards/all')) return reply([{ id: ids.card, idList: ids.list, idLabels: ['555555555555555555555555'], name: 'Synthetische Karte', desc: 'Prüfen', closed: false }]);
    throw new Error(`Unexpected path: ${url.pathname}`);
  });
  return { calls, fetcher: fetcher as typeof fetch };
}

describe('read-only Trello connection', () => {
  it('uses Trello read-only consent, validates credentials and stores only encrypted bytes', async () => {
    const { root, store } = fixture();
    const api = service();
    const connection = new TrelloConnection(root, secure, api.fetcher);
    const consent = new URL(connection.authorizationUrl(key));
    expect(consent.origin).toBe('https://trello.com');
    expect(consent.pathname).toBe('/1/authorize');
    expect(Object.fromEntries(consent.searchParams)).toEqual({ key, name: 'Branchloom', expiration: '30days', scope: 'read', response_type: 'token' });
    expect(consent.toString()).not.toContain(token);
    expect(() => connection.authorizationUrl(`${key}&return_url=https://outside.example/`)).toThrow('API-Key');
    await expect(connection.status()).resolves.toEqual({ connected: false, memberName: null });
    await expect(connection.connect({ key: 'bad', token })).rejects.toThrow('API-Key');
    await expect(connection.connect({ key, token: 'bad' })).rejects.toThrow('Token');
    await expect(connection.connect({ key, token })).resolves.toEqual({ connected: true, memberName: 'Demo Person' });
    const persisted = readFileSync(join(root, 'trello-connection.bin')).toString();
    expect(persisted).not.toContain(token);
    expect(persisted).not.toContain(key);
    const reopened = new TrelloConnection(root, secure, api.fetcher);
    await expect(reopened.status()).resolves.toEqual({ connected: true, memberName: 'Demo Person' });
    await expect(reopened.boards()).resolves.toEqual([{ id: ids.board, name: 'Demo Board' }]);
    await reopened.disconnect();
    await expect(reopened.status()).resolves.toEqual({ connected: false, memberName: null });
    await expect(reopened.boards()).rejects.toThrow('noch nicht verbunden');
    store.close();
  });

  it('reads a selected board into the existing safe preview and duplicate-aware import path', async () => {
    const { root, store, project, column } = fixture();
    const api = service();
    const connection = new TrelloConnection(root, secure, api.fetcher);
    await connection.connect({ key, token });
    const json = await connection.boardJson(ids.board);
    const preview = store.previewTrelloImport({ projectId: project.id, json });
    expect(preview).toMatchObject({ boardName: 'Demo Board', total: 1, eligible: 1, duplicates: 0 });
    expect(preview.cards[0]).toMatchObject({ sourceId: ids.card, listName: 'Backlog', labels: ['Test'] });
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    const accepted = store.acceptTrelloImport({ projectId: project.id, columnId: column.id, json: await connection.boardJson(ids.board), fingerprint: preview.fingerprint, sourceIds: [ids.card] });
    expect(accepted.created).toHaveLength(1);
    expect(store.previewTrelloImport({ projectId: project.id, json }).duplicates).toBe(1);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    const repeated = store.acceptTrelloImport({ projectId: project.id, columnId: column.id, json, fingerprint: preview.fingerprint, sourceIds: [ids.card] });
    expect(repeated).toMatchObject({ created: [], skippedDuplicateIds: [ids.card] });
    store.close();
  });

  it('does not import a board changed between preview and acceptance', async () => {
    const { root, store, project, column } = fixture();
    const api = service();
    const connection = new TrelloConnection(root, secure, api.fetcher);
    await connection.connect({ key, token });
    const json = await connection.boardJson(ids.board);
    const preview = store.previewTrelloImport({ projectId: project.id, json });
    const changed = JSON.stringify({ ...JSON.parse(json), cards: [{ ...JSON.parse(json).cards[0], desc: 'Changed' }] });
    expect(() => store.acceptTrelloImport({ projectId: project.id, columnId: column.id, json: changed, fingerprint: preview.fingerprint, sourceIds: [ids.card] })).toThrow('geändert');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();
  });

  it('shows revoked credentials, offline errors and rate limits without exposing the token', async () => {
    const { root, store } = fixture();
    const good = service();
    await new TrelloConnection(root, secure, good.fetcher).connect({ key, token });
    const denied = service(() => reply({ message: 'invalid token' }, 401));
    await expect(new TrelloConnection(root, secure, denied.fetcher).boards()).rejects.toThrow('widerrufen');
    const limited = service(() => reply({}, 429));
    await expect(new TrelloConnection(root, secure, limited.fetcher).boards()).rejects.toThrow('begrenzt');
    const offline = service(() => { throw new Error(`private ${token}`); });
    await expect(new TrelloConnection(root, secure, offline.fetcher).boards()).rejects.not.toThrow(token);
    await expect(new TrelloConnection(root, secure, offline.fetcher).boards()).rejects.toThrow('nicht erreichbar');
    store.close();
  });

  it('refuses to save a token when OS encryption is unavailable', async () => {
    const { root, store } = fixture();
    const unavailable = { ...secure, isAsyncEncryptionAvailable: async () => false };
    const api = service();
    await expect(new TrelloConnection(root, unavailable, api.fetcher).connect({ key, token })).rejects.toThrow('Sichere Windows-Speicherung');
    expect(api.calls).toHaveLength(0);
    expect(existsSync(join(root, 'trello-connection.bin'))).toBe(false);
    store.close();
  });

  it('refuses incomplete paginated results rather than silently dropping cards', async () => {
    const { root, store } = fixture();
    const good = service();
    await new TrelloConnection(root, secure, good.fetcher).connect({ key, token });
    const bad = service((url) => {
      if (url.pathname.endsWith('/cards/all')) return reply(Array.from({ length: 1000 }, () => ({ id: ids.card, name: 'same' })));
      if (url.pathname === `/1/boards/${ids.board}`) return reply({ id: ids.board, name: 'Demo' });
      return reply([]);
    });
    await expect(new TrelloConnection(root, secure, bad.fetcher).boardJson(ids.board)).rejects.toThrow('vollständig');
    store.close();
  });
});
