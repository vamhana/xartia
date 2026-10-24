// L.0.01.07 — S3-клиент
// Загрузка медиа отчётов, видео-интервью, архивных документов.
// Presigned URL для прямой загрузки с клиента. Изолированные бакеты для Шлюза.

import { Readable } from 'node:stream';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AppError } from '../core/errors.js';
import type { ISODateTime } from '../core/types.js';

import { logger } from './logger.js';

// -------- Типы --------

export type S3Scope = 'media' | 'archive' | 'gateway';

export interface UploadUrlResult {
  url: string;
  fields: Record<string, string>;
  key: string;
}

export interface HeadObjectResult {
  size: number;
  contentType: string;
  lastModified: ISODateTime;
}

export interface S3ObjectInfo {
  key: string;
  size: number;
  lastModified: ISODateTime;
}

// -------- Конфигурация --------

const ENDPOINT = process.env['S3_ENDPOINT'];
const REGION = process.env['S3_REGION'] ?? 'us-east-1';
const ACCESS_KEY = process.env['S3_ACCESS_KEY'];
const SECRET_KEY = process.env['S3_SECRET_KEY'];
// MinIO требует path-style. AWS S3 — virtual-hosted. По умолчанию — path-style
// (безопаснее для dev; в prod можно явно выставить S3_FORCE_PATH_STYLE=false).
const FORCE_PATH_STYLE = process.env['S3_FORCE_PATH_STYLE'] !== 'false';

if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) {
  throw new AppError(
    'CONFIG',
    'S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY must be set',
    500,
  );
}

const BUCKETS: Record<S3Scope, string> = {
  media: process.env['S3_BUCKET_MEDIA'] ?? 'charter-media',
  archive: process.env['S3_BUCKET_ARCHIVE'] ?? 'charter-archive',
  gateway: process.env['S3_BUCKET_GATEWAY'] ?? 'charter-gateway',
};

export const s3Client: S3Client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: FORCE_PATH_STYLE,
});

// -------- Константы --------

const DEFAULT_UPLOAD_TTL_SEC = 15 * 60;     // 15 минут
const DEFAULT_DOWNLOAD_TTL_SEC = 15 * 60;   // 15 минут
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 ГБ (видео)
const MAX_LIST_LIMIT = 1000;

// -------- Валидация ключа --------

function assertValidKey(key: string): void {
  if (!key || key.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'S3 key must not be empty', 422);
  }
  if (key.startsWith('/')) {
    throw new AppError('VALIDATION_ERROR', 'S3 key must not start with "/"', 422);
  }
  if (key.includes('..')) {
    throw new AppError('VALIDATION_ERROR', 'S3 key must not contain ".."', 422);
  }
  if (key.length > 1024) {
    throw new AppError('VALIDATION_ERROR', 'S3 key too long', 422);
  }
}

// -------- Presigned URL для загрузки --------

export async function getUploadUrl(
  key: string,
  contentType: string,
  scope: S3Scope = 'media',
  expiresInSec: number = DEFAULT_UPLOAD_TTL_SEC,
): Promise<UploadUrlResult> {
  assertValidKey(key);
  if (!contentType || contentType.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'contentType is required', 422);
  }
  const bucket = getBucketFor(scope);

  try {
    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: bucket,
      Key: key,
      Expires: expiresInSec,
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: {
        'Content-Type': contentType,
      },
    });
    return { url, fields, key };
  } catch (e) {
    logger.error({ err: e, key, scope }, 's3: getUploadUrl failed');
    throw new AppError('S3_ERROR', 'Failed to generate upload URL', 500);
  }
}

// -------- Presigned URL для скачивания --------

export async function getDownloadUrl(
  key: string,
  scope: S3Scope = 'media',
  expiresInSec: number = DEFAULT_DOWNLOAD_TTL_SEC,
): Promise<string> {
  assertValidKey(key);
  const bucket = getBucketFor(scope);

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresInSec });
  } catch (e) {
    logger.error({ err: e, key, scope }, 's3: getDownloadUrl failed');
    throw new AppError('S3_ERROR', 'Failed to generate download URL', 500);
  }
}

// -------- Прямые серверные операции --------

export async function upload(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  scope: S3Scope = 'media',
): Promise<{ url: string; size: number }> {
  assertValidKey(key);
  const bucket = getBucketFor(scope);
  const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body);

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { url: `s3://${bucket}/${key}`, size: buffer.length };
  } catch (e) {
    logger.error({ err: e, key, scope }, 's3: upload failed');
    throw new AppError('S3_ERROR', 'Failed to upload object', 500);
  }
}

export async function download(
  key: string,
  scope: S3Scope = 'media',
): Promise<Buffer> {
  assertValidKey(key);
  const bucket = getBucketFor(scope);

  try {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!res.Body) {
      throw new AppError('NOT_FOUND', `S3 object not found: ${key}`, 404);
    }
    return await streamToBuffer(res.Body as Readable);
  } catch (e) {
    if (e instanceof AppError) {throw e;}
    logger.error({ err: e, key, scope }, 's3: download failed');
    throw new AppError('S3_ERROR', 'Failed to download object', 500);
  }
}

export async function deleteObject(
  key: string,
  scope: S3Scope = 'media',
): Promise<void> {
  assertValidKey(key);
  const bucket = getBucketFor(scope);

  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (e) {
    logger.error({ err: e, key, scope }, 's3: deleteObject failed');
    throw new AppError('S3_ERROR', 'Failed to delete object', 500);
  }
}

export async function listObjects(
  prefix: string,
  scope: S3Scope = 'media',
  limit: number = MAX_LIST_LIMIT,
): Promise<S3ObjectInfo[]> {
  const bucket = getBucketFor(scope);

  try {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: Math.min(limit, MAX_LIST_LIMIT),
      }),
    );
    return (res.Contents ?? []).map((item) => ({
      key: item.Key ?? '',
      size: item.Size ?? 0,
      lastModified: (item.LastModified ?? new Date()).toISOString(),
    }));
  } catch (e) {
    logger.error({ err: e, prefix, scope }, 's3: listObjects failed');
    throw new AppError('S3_ERROR', 'Failed to list objects', 500);
  }
}

export async function headObject(
  key: string,
  scope: S3Scope = 'media',
): Promise<HeadObjectResult | null> {
  assertValidKey(key);
  const bucket = getBucketFor(scope);

  try {
    const res = await s3Client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      size: res.ContentLength ?? 0,
      contentType: res.ContentType ?? 'application/octet-stream',
      lastModified: (res.LastModified ?? new Date()).toISOString(),
    };
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey') {return null;}
    logger.error({ err: e, key, scope }, 's3: headObject failed');
    throw new AppError('S3_ERROR', 'Failed to head object', 500);
  }
}

export async function copyObject(
  sourceKey: string,
  destKey: string,
  sourceScope: S3Scope = 'media',
  destScope: S3Scope = 'media',
): Promise<void> {
  assertValidKey(sourceKey);
  assertValidKey(destKey);
  const sourceBucket = getBucketFor(sourceScope);
  const destBucket = getBucketFor(destScope);

  try {
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        CopySource: `${sourceBucket}/${sourceKey}`,
        Key: destKey,
      }),
    );
  } catch (e) {
    logger.error({ err: e, sourceKey, destKey }, 's3: copyObject failed');
    throw new AppError('S3_ERROR', 'Failed to copy object', 500);
  }
}

// -------- Bucket по scope --------

export function getBucketFor(scope: S3Scope): string {
  return BUCKETS[scope];
}

// -------- Health-check --------

export async function healthCheck(): Promise<boolean> {
  try {
    await s3Client.send(
      new ListObjectsV2Command({
        Bucket: getBucketFor('media'),
        MaxKeys: 1,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

// -------- Утилиты --------

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}