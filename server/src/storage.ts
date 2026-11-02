import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from './config.js';

/** Blob storage for uploaded files (images, rendered PDF pages). */
export interface Storage {
  put(id: string, data: Buffer, mime: string): Promise<void>;
  get(id: string): Promise<Readable | null>;
  delete(id: string): Promise<void>;
}

const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('invalid file id');
  return id;
};

function localStorage(dir: string): Storage {
  fs.mkdirSync(dir, { recursive: true });
  const file = (id: string) => path.join(dir, safeId(id));
  return {
    async put(id, data) {
      await fs.promises.writeFile(file(id), data);
    },
    async get(id) {
      try {
        await fs.promises.access(file(id));
        return fs.createReadStream(file(id));
      } catch {
        return null;
      }
    },
    async delete(id) {
      await fs.promises.rm(file(id), { force: true });
    },
  };
}

async function s3Storage(cfg: Config['s3']): Promise<Storage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } =
    await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.accessKeyId ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
  }
  return {
    async put(id, data, mime) {
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: safeId(id), Body: data, ContentType: mime }));
    },
    async get(id) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: safeId(id) }));
        return res.Body as Readable;
      } catch {
        return null;
      }
    },
    async delete(id) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: safeId(id) }));
    },
  };
}

export async function openStorage(config: Config): Promise<Storage> {
  return config.storage === 's3' ? s3Storage(config.s3) : localStorage(config.filesDir);
}

/** Detects allowed image types from magic bytes; never trust the client-provided type. */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return 'image/gif';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export { Readable };
