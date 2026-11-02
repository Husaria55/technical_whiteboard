import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { config as baseConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db.js';
import { buildApp } from '../src/app.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-test-'));
const config = {
  ...baseConfig,
  dataDir: tmp,
  sqlitePath: path.join(tmp, 'db.sqlite'),
  filesDir: path.join(tmp, 'files'),
  databaseUrl: '',
  logLevel: 'warn',
  publicDir: path.join(tmp, 'none'),
};
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let base = '';

before(async () => {
  db = await openDb(config);
  ({ app } = await buildApp(config, db));
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function api(method: string, url: string, body?: unknown, cookie?: string) {
  const res = await fetch(`http://${base}${url}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

function connect(boardId: string, query: string, cookie?: string) {
  const doc = new Y.Doc();
  const WS = class extends WebSocket {
    constructor(url: string) {
      super(url, cookie ? { headers: { cookie } } : undefined);
    }
  };
  const provider = new WebsocketProvider(`ws://${base}/api/boards/${boardId}`, 'ws' + query, doc, {
    WebSocketPolyfill: WS as never,
  });
  const synced = new Promise<void>((resolve) => provider.once('sync', () => resolve()));
  return { doc, provider, synced };
}

const close = (c: ReturnType<typeof connect>) => {
  c.provider.awareness.destroy();
  c.provider.destroy();
  c.doc.destroy();
};

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('auth, boards, sharing and realtime sync', async () => {
  const reg = await api('POST', '/api/auth/register', { email: 'T@x.io', name: 'Teacher', password: 'secret123' });
  assert.equal(reg.status, 200);
  const cookie = reg.cookie!;
  assert.equal((await api('GET', '/api/auth/me', undefined, cookie)).json.user.email, 't@x.io');
  assert.equal((await api('POST', '/api/auth/login', { email: 't@x.io', password: 'wrong' })).status, 401);

  const created = await api('POST', '/api/boards', { title: 'Algebra' }, cookie);
  const board = created.json.board;
  assert.equal(board.role, 'owner');

  // Anonymous access requires a token.
  assert.equal((await api('GET', `/api/boards/${board.id}`)).status, 401);
  assert.equal((await api('GET', `/api/boards/${board.id}?t=${board.viewToken}`)).json.board.role, 'viewer');
  assert.equal((await api('GET', `/api/boards/${board.id}?t=${board.editToken}`)).json.board.role, 'editor');
  assert.equal((await api('GET', `/api/boards/${board.id}?t=${board.editToken}`)).json.board.editToken, undefined);

  // Realtime: owner and editor sync; viewer changes are ignored.
  const owner = connect(board.id, '', cookie);
  const editor = connect(board.id, `?t=${board.editToken}`);
  const viewer = connect(board.id, `?t=${board.viewToken}`);
  await Promise.all([owner.synced, editor.synced, viewer.synced]);
  owner.doc.getMap('objects').set('a', { type: 'stroke' });
  await waitFor(() => editor.doc.getMap('objects').has('a') && viewer.doc.getMap('objects').has('a'));
  editor.doc.getMap('objects').set('b', { type: 'rect' });
  await waitFor(() => owner.doc.getMap('objects').has('b'));
  viewer.doc.getMap('objects').set('c', { type: 'hack' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(owner.doc.getMap('objects').has('c'), false);

  // Revoking the edit link disconnects guests.
  const shared = await api('POST', `/api/boards/${board.id}/share`, { kind: 'edit', enabled: false }, cookie);
  assert.equal(shared.json.board.editToken, null);
  assert.equal((await api('GET', `/api/boards/${board.id}?t=${board.editToken}`)).status, 401);
  for (const c of [owner, editor, viewer]) close(c);

  // Duplicate keeps content; rename; delete.
  const dup = await api('POST', `/api/boards/${board.id}/duplicate`, undefined, cookie);
  const copy = connect(dup.json.board.id, '', cookie);
  await copy.synced;
  assert.ok(copy.doc.getMap('objects').has('a'));
  close(copy);
  assert.equal((await api('PATCH', `/api/boards/${board.id}`, { title: 'Geometry' }, cookie)).json.board.title, 'Geometry');
  assert.equal((await api('GET', '/api/boards', undefined, cookie)).json.boards.length, 2);
  assert.equal((await api('DELETE', `/api/boards/${board.id}`, undefined, cookie)).status, 200);
  assert.equal((await api('GET', '/api/boards', undefined, cookie)).json.boards.length, 1);
});

test('image upload accepts images only', async () => {
  const reg = await api('POST', '/api/auth/register', { email: 'u@x.io', name: 'U', password: 'secret123' });
  const board = (await api('POST', '/api/boards', {}, reg.cookie)).json.board;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = async (data: Buffer, name: string) => {
    const form = new FormData();
    form.append('file', new Blob([data]), name);
    const res = await fetch(`http://${base}/api/boards/${board.id}/files?t=${board.editToken}`, { method: 'POST', body: form });
    return { status: res.status, json: await res.json() };
  };
  const ok = await upload(png, 'a.png');
  assert.equal(ok.status, 200);
  const file = await fetch(`http://${base}${ok.json.url}`);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal((await upload(Buffer.from('<svg onload=alert(1)>'), 'x.svg')).status, 415);
});
