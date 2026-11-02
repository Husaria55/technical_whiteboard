import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import type { Config } from './config.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'tw_session';

export interface User {
  id: string;
  email: string;
  name: string;
}

export const newId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export async function createSession(db: Db, config: Config, userId: string): Promise<string> {
  const token = newId(32);
  const expires = Date.now() + config.sessionDays * 24 * 3600 * 1000;
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), userId, expires]);
  return token;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

export async function userFromToken(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const row = await db.get<User & { expires_at: number }>(
    `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await destroySession(db, token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 24 * 3600,
  });
}

export function requestUser(db: Db) {
  return (req: FastifyRequest) => userFromToken(db, req.cookies[SESSION_COOKIE]);
}
