// scripts/ensure-buckets.ts
// Создаёт бакеты S3/MinIO, если их нет (идемпотентно).
//
// Зачем: в CI и на чистой установке MinIO поднимается пустым, а загрузка
// артефакта отчёта требует бакет. Раньше это делал только ручной `mc mb`.
//
// Запуск: pnpm tsx scripts/ensure-buckets.ts

import 'dotenv/config';

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const endpoint = process.env['S3_ENDPOINT'];
const accessKeyId = process.env['S3_ACCESS_KEY'];
const secretAccessKey = process.env['S3_SECRET_KEY'];

const buckets = [
  process.env['S3_BUCKET_MEDIA'] ?? 'charter-media',
  process.env['S3_BUCKET_ARCHIVE'] ?? 'charter-archive',
  process.env['S3_BUCKET_GATEWAY'] ?? 'charter-gateway',
];

async function main(): Promise<void> {
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('   ✗ S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY не заданы');
    process.exitCode = 1;
    return;
  }

  const client = new S3Client({
    endpoint,
    region: process.env['S3_REGION'] ?? 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
  });

  for (const bucket of buckets) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      console.log(`   · ${bucket}: уже есть`);
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`   ✓ ${bucket}: создан`);
    }
  }
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
