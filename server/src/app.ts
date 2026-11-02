import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { openStorage, sniffImageMime } from './storage.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  newId,
  requestUser,
  setSessionCookie,
  verifyPassword,
  type User,
} from './auth.js';
import { getBoard, listBoards, publicBoard, resolveRole, type BoardRow, type Role } from './boards.js';
import { CollabServer } from './collab.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function str(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${field} is required`);
  if (value.length > max) throw new HttpError(400, `${field} is too long`);
  return value.trim();
}

export async function buildApp(config: Config, db: Db): Promise<{ app: FastifyInstance; collab: CollabServer }> {
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy, bodyLimit: 1024 * 1024 });
  const storage = await openStorage(config);
  const collab = new CollabServer(db);
  const getUser = requestUser(db);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.status(status).send({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  const requireUser = async (req: FastifyRequest): Promise<User> => {
    const user = await getUser(req);
    if (!user) throw new HttpError(401, 'Not signed in');
    return user;
  };

  const boardAccess = async (req: FastifyRequest, id: string, minimum: Role = 'viewer') => {
    const board = await getBoard(db, id);
    if (!board) throw new HttpError(404, 'Board not found');
    const user = await getUser(req);
    const token = (req.query as { t?: string }).t;
    const role = resolveRole(board, user, token);
    if (!role) throw new HttpError(user ? 403 : 401, 'You do not have access to this board');
    const rank: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
    if (rank[role] < rank[minimum]) throw new HttpError(403, 'Insufficient permissions');
    return { board, role, user };
  };

  // ---------- Config & auth ----------

  app.get('/api/config', async () => ({ allowRegistration: config.allowRegistration }));

  const authLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    if (!config.allowRegistration) throw new HttpError(403, 'Registration is disabled on this server');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = str(body.email, 'Email').toLowerCase();
    const name = str(body.name, 'Name', 80);
    const password = str(body.password, 'Password', 200);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Invalid email address');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (await db.get('SELECT id FROM users WHERE email = ?', [email])) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    const user: User = { id: newId(), email, name };
    await db.run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
      user.id,
      email,
      name,
      await hashPassword(password),
      Date.now(),
    ]);
    setSessionCookie(reply, config, await createSession(db, config, user.id));
    return { user };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = str(body.email, 'Email').toLowerCase();
    const password = str(body.password, 'Password');
    const row = await db.get<User & { password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE email = ?',
      [email],
    );
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(401, 'Wrong email or password');
    }
    setSessionCookie(reply, config, await createSession(db, config, row.id));
    return { user: { id: row.id, email: row.email, name: row.name } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: await getUser(req) }));

  // ---------- Boards ----------

  app.get('/api/boards', async (req) => {
    const user = await requireUser(req);
    return { boards: (await listBoards(db, user.id)).map((b) => publicBoard(b, 'owner')) };
  });

  const insertBoard = async (ownerId: string, title: string, ydoc: Uint8Array | null) => {
    const now = Date.now();
    const board: BoardRow = {
      id: newId(12),
      owner_id: ownerId,
      title,
      created_at: now,
      updated_at: now,
      edit_token: newId(18),
      view_token: newId(18),
    };
    await db.run(
      'INSERT INTO boards (id, owner_id, title, created_at, updated_at, edit_token, view_token, ydoc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [board.id, ownerId, title, now, now, board.edit_token, board.view_token, ydoc],
    );
    return board;
  };

  app.post('/api/boards', async (req) => {
    const user = await requireUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' && body.title.trim() ? str(body.title, 'Title') : 'Untitled board';
    return { board: publicBoard(await insertBoard(user.id, title, null), 'owner') };
  });

  app.get<{ Params: { id: string } }>('/api/boards/:id', async (req) => {
    const { board, role, user } = await boardAccess(req, req.params.id);
    return { board: publicBoard(board, role), user };
  });

  app.patch<{ Params: { id: string } }>('/api/boards/:id', async (req) => {
    const { board } = await boardAccess(req, req.params.id, 'owner');
    const title = str((req.body as Record<string, unknown> | undefined)?.title, 'Title');
    await db.run('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), board.id]);
    return { board: publicBoard({ ...board, title }, 'owner') };
  });

  app.post<{ Params: { id: string } }>('/api/boards/:id/duplicate', async (req) => {
    const { board, user } = await boardAccess(req, req.params.id, 'owner');
    let state = collab.currentState(board.id);
    if (!state) {
      const row = await db.get<{ ydoc: Uint8Array | null }>('SELECT ydoc FROM boards WHERE id = ?', [board.id]);
      state = row?.ydoc ? new Uint8Array(row.ydoc) : null;
    }
    const copy = await insertBoard(user!.id, `${board.title} (copy)`, state);
    return { board: publicBoard(copy, 'owner') };
  });

  app.delete<{ Params: { id: string } }>('/api/boards/:id', async (req) => {
    const { board } = await boardAccess(req, req.params.id, 'owner');
    await collab.drop(board.id);
    // Files are shared between a board and its duplicates, so only remove
    // files no other board references in its document.
    await db.run('DELETE FROM boards WHERE id = ?', [board.id]);
    await removeOrphanFiles(board.id);
    return { ok: true };
  });

  /** Enables/regenerates or disables a share link. */
  app.post<{ Params: { id: string } }>('/api/boards/:id/share', async (req) => {
    const { board } = await boardAccess(req, req.params.id, 'owner');
    const body = (req.body ?? {}) as { kind?: string; enabled?: boolean };
    if (body.kind !== 'edit' && body.kind !== 'view') throw new HttpError(400, 'kind must be "edit" or "view"');
    const column = body.kind === 'edit' ? 'edit_token' : 'view_token';
    const token = body.enabled === false ? null : newId(18);
    await db.run(`UPDATE boards SET ${column} = ? WHERE id = ?`, [token, board.id]);
    collab.kickGuests(board.id);
    const updated = (await getBoard(db, board.id))!;
    return { board: publicBoard(updated, 'owner') };
  });

  // ---------- Files ----------

  app.post<{ Params: { id: string } }>('/api/boards/:id/files', async (req) => {
    const { board } = await boardAccess(req, req.params.id, 'editor');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    const data = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'File is too large');
    const mime = sniffImageMime(data);
    if (!mime) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images are supported');
    const id = newId(18);
    await storage.put(id, data, mime);
    await db.run('INSERT INTO files (id, board_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)', [
      id,
      board.id,
      mime,
      data.length,
      Date.now(),
    ]);
    return { id, url: `/api/files/${id}` };
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply: FastifyReply) => {
    // File ids are unguessable random 144-bit values, shared only inside board documents.
    const row = await db.get<{ mime: string }>('SELECT mime FROM files WHERE id = ?', [req.params.id]);
    if (!row) throw new HttpError(404, 'File not found');
    const stream = await storage.get(req.params.id);
    if (!stream) throw new HttpError(404, 'File not found');
    reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(stream);
  });

  async function removeOrphanFiles(boardId: string) {
    const files = await db.all<{ id: string }>('SELECT id FROM files WHERE board_id = ?', [boardId]);
    if (files.length === 0) return;
    // Duplicated boards keep referencing the original board's files: hand
    // those over to a board that still uses them instead of deleting.
    const others = await db.all<{ id: string; ydoc: Uint8Array | null }>('SELECT id, ydoc FROM boards WHERE ydoc IS NOT NULL');
    for (const f of files) {
      const needle = Buffer.from(f.id);
      const user = others.find((o) => Buffer.from(o.ydoc!).includes(needle));
      if (user) {
        await db.run('UPDATE files SET board_id = ? WHERE id = ?', [user.id, f.id]);
        continue;
      }
      await storage.delete(f.id);
      await db.run('DELETE FROM files WHERE id = ?', [f.id]);
    }
  }

  // ---------- WebSocket collaboration ----------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  app.server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = url.pathname.match(/^\/api\/boards\/([A-Za-z0-9_-]+)\/ws$/);
    if (!match) {
      socket.destroy();
      return;
    }
    try {
      const board = await getBoard(db, match[1]!);
      const cookies = app.parseCookie(req.headers.cookie ?? '');
      const user = await requestUser(db)({ cookies } as unknown as FastifyRequest);
      const token = url.searchParams.get('t') ?? undefined;
      const role = board ? resolveRole(board, user, token) : null;
      if (!board || !role) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void collab.handleConnection(ws, board.id, role, token);
      });
    } catch (err) {
      app.log.error(err);
      socket.destroy();
    }
  });

  app.addHook('onClose', async () => {
    await collab.flushAll();
    wss.close();
  });

  // ---------- Static client ----------

  if (fs.existsSync(path.join(config.publicDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      // Hashed build assets never change; the HTML shell must always be fresh.
      setHeaders: (reply: FastifyReply, filePath: string) => {
        reply.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.status(404).send({ error: 'Not found' });
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return { app, collab };
}
