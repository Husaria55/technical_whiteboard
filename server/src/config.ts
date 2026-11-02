import path from 'node:path';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? './data');

export const config = {
  host: env.HOST ?? '0.0.0.0',
  port: int(env.PORT, 3000),
  dataDir,
  /** PostgreSQL connection string. When empty, SQLite is used. */
  databaseUrl: env.DATABASE_URL ?? '',
  sqlitePath: env.SQLITE_PATH ?? path.join(dataDir, 'whiteboard.db'),
  storage: (env.STORAGE ?? 'local') as 'local' | 's3',
  filesDir: env.FILES_DIR ?? path.join(dataDir, 'files'),
  s3: {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? 'whiteboard',
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, true),
  },
  allowRegistration: bool(env.ALLOW_REGISTRATION, true),
  maxUploadBytes: int(env.MAX_UPLOAD_MB, 25) * 1024 * 1024,
  cookieSecure: bool(env.COOKIE_SECURE, false),
  trustProxy: bool(env.TRUST_PROXY, false),
  sessionDays: int(env.SESSION_DAYS, 30),
  publicDir: path.resolve(env.PUBLIC_DIR ?? path.join(import.meta.dirname, '../../client/dist')),
  logLevel: env.LOG_LEVEL ?? 'info',
};

export type Config = typeof config;
