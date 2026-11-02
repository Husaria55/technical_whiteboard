import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';

export type Row = Record<string, unknown>;
export type Param = string | number | null | Uint8Array;

/**
 * Minimal database abstraction over SQLite (node:sqlite) and PostgreSQL.
 * SQL is written with `?` placeholders and portable types only.
 */
export interface Db {
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<number>;
  close(): Promise<void>;
  kind: 'sqlite' | 'postgres';
}

const schema = (blob: string) => [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    edit_token TEXT,
    view_token TEXT,
    ydoc ${blob}
  )`,
  `CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id)`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    mime TEXT NOT NULL,
    size BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS files_board ON files(board_id)`,
];

function normalizeRow(row: Row): Row {
  for (const [k, v] of Object.entries(row)) {
    // pg returns BIGINT as string; sqlite may return bigint.
    if (typeof v === 'bigint') row[k] = Number(v);
    else if (typeof v === 'string' && (k.endsWith('_at') || k === 'size') && /^\d+$/.test(v)) row[k] = Number(v);
  }
  return row;
}

async function openSqlite(file: string): Promise<Db> {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const stmt of schema('BLOB')) db.exec(stmt);
  return {
    kind: 'sqlite',
    async all<T>(sql: string, params: Param[] = []) {
      return db.prepare(sql).all(...params).map((r) => normalizeRow(r as Row)) as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      const row = db.prepare(sql).get(...params);
      return row ? (normalizeRow(row as Row) as T) : undefined;
    },
    async run(sql: string, params: Param[] = []) {
      return Number(db.prepare(sql).run(...params).changes);
    },
    async close() {
      db.close();
    },
  };
}

async function openPostgres(url: string): Promise<Db> {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url });
  for (const stmt of schema('BYTEA')) await pool.query(stmt);
  const convert = (sql: string) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const toPg = (params: Param[]) => params.map((p) => (p instanceof Uint8Array ? Buffer.from(p) : p));
  return {
    kind: 'postgres',
    async all<T>(sql: string, params: Param[] = []) {
      const res = await pool.query(convert(sql), toPg(params));
      return res.rows.map(normalizeRow) as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      const res = await pool.query(convert(sql), toPg(params));
      return res.rows[0] ? (normalizeRow(res.rows[0]) as T) : undefined;
    },
    async run(sql: string, params: Param[] = []) {
      const res = await pool.query(convert(sql), toPg(params));
      return res.rowCount ?? 0;
    },
    async close() {
      await pool.end();
    },
  };
}

export async function openDb(config: Pick<Config, 'databaseUrl' | 'sqlitePath'>): Promise<Db> {
  return config.databaseUrl ? openPostgres(config.databaseUrl) : openSqlite(config.sqlitePath);
}
