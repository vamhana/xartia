import 'dotenv/config';
import { getUploadUrl, getDownloadUrl, upload, download, headObject, deleteObject, healthCheck, getBucketFor } from '../src/lib/s3.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

async function main(): Promise<void> {
  console.log('Buckets:', {
    media: getBucketFor('media'),
    archive: getBucketFor('archive'),
    gateway: getBucketFor('gateway'),
  });

  console.log('\n─── healthCheck ───');
  const healthy = await healthCheck();
  console.log('healthy:', healthy);

  const key = 'test/s3-smoke.txt';
  const content = Buffer.from('hello charter ' + Date.now(), 'utf8');

  console.log('\n─── upload ───');
  const up = await upload(key, content, 'text/plain', 'media');
  console.log('uploaded:', up);

  console.log('\n─── headObject ───');
  const head = await headObject(key, 'media');
  console.log('head:', head);

  console.log('\n─── download ───');
  const down = await download(key, 'media');
  console.log('downloaded bytes:', down.length);
  console.log('matches:', down.toString('utf8') === content.toString('utf8'));

  console.log('\n─── getUploadUrl (presigned POST) ───');
  const upUrl = await getUploadUrl('test/presigned.txt', 'text/plain', 'media');
  console.log('url:', upUrl.url.slice(0, 60) + '...');
  console.log('fields keys:', Object.keys(upUrl.fields));

  console.log('\n─── getDownloadUrl (presigned GET) ───');
  const downUrl = await getDownloadUrl(key, 'media');
  console.log('url:', downUrl.slice(0, 80) + '...');

  console.log('\n─── deleteObject ───');
  await deleteObject(key, 'media');
  console.log('deleted');

  const afterDelete = await headObject(key, 'media');
  console.log('after delete (should be null):', afterDelete);

  console.log('\n✅ S3 smoke OK');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});