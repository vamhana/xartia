// scripts/test-files.ts
import 'dotenv/config';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { loadWsEnv } from './lib/ws-env.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface Client { token: string; participantId: string }

async function req(
  c: Client,
  method: string,
  path: string,
  body?: unknown,
  opts: { redirect?: 'manual' | 'follow' } = { redirect: 'manual' },
): Promise<{ status: number; headers: Headers; data: unknown; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: opts.redirect ?? 'manual',
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, data, text };
}

function ok(m: string) { console.log(`  ✓ ${m}`); }
function fail(m: string) { console.error(`  ✗ ${m}`); process.exitCode = 1; }

async function main() {
  console.log('▶ A.1.91.01 files smoke test\n');

  const env = await loadWsEnv();
  const arch: Client = { token: env.token, participantId: env.participantId };

  // 1. POST /files/upload-url — тип report
  const fakeTaskId = crypto.randomUUID();
  const fakeReportId = crypto.randomUUID();

  const up = await req(arch, 'POST', '/files/upload-url', {
    task_id: fakeTaskId,
    report_id: fakeReportId,
    type: 'report',
    extension: 'txt',
    content_type: 'text/plain',
  });
  if (up.status !== 200) {
    fail(`POST /files/upload-url → ${up.status}`);
    console.log(JSON.stringify(up.data, null, 2));
    return;
  }
  const upData = up.data as { url: string; fields: Record<string, string>; key: string };
  console.log(`  key: ${upData.key}`);
  console.log(`  url: ${upData.url.slice(0, 60)}...`);
  console.log(`  fields: ${Object.keys(upData.fields).join(', ')}`);
  if (upData.key.startsWith('media/')) {ok('POST /files/upload-url');}
  else {fail(`key format unexpected: ${upData.key}`);}

  // 2. Реальная загрузка в MinIO через presigned POST
  const form = new FormData();
  // ВАЖНО: Content-Type уже есть в upData.fields (presigned constraint).
  // Не добавляем его второй раз — MinIO отклонит подпись.
  for (const [k, v] of Object.entries(upData.fields)) {
    form.append(k, v);
  }
  // Файл ДОЛЖЕН быть последним полем. Blob без type — чтобы fetch
  // не добавил свой Content-Type на file-часть в обход подписи.
  form.append('file', new Blob([`hello ${Date.now()}`]), 'test.txt');

  const minioRes = await fetch(upData.url, { method: 'POST', body: form });
  console.log(`  minio upload: ${minioRes.status}`);
  if (minioRes.ok) {
    ok('presigned POST upload');
  } else {
    const body = await minioRes.text();
    fail(`minio upload → ${minioRes.status}: ${body.slice(0, 300)}`);
    return;
  }

  // 3. GET /files/:key → 302
  const encoded = encodeURIComponent(upData.key);
  const dl = await req(arch, 'GET', `/files/${encoded}`);
  console.log(`  GET /files/:key → ${dl.status}, location=${dl.headers.get('location')?.slice(0, 50)}...`);
  if (dl.status === 302) {ok('GET /files/:key → 302');}
  else {fail(`GET /files/:key → ${dl.status}`);}

  // 4. Реально скачаем через presigned URL
  const location = dl.headers.get('location');
  if (location) {
    const getRes = await fetch(location);
    const content = await getRes.text();
    console.log(`  download: ${getRes.status}, body: ${content.slice(0, 30)}...`);
    if (getRes.ok) {ok('presigned GET download');}
    else {fail(`download → ${getRes.status}`);}
  }

  // 5. GET /files/:key/meta
  const meta = await req(arch, 'GET', `/files/${encoded}/meta`);
  if (meta.status === 200) {
    const m = meta.data as { size: number; content_type: string; uploaded_at: string };
    console.log(`  meta: size=${m.size}, ct=${m.content_type}`);
    ok('GET /files/:key/meta');
  } else {fail(`meta → ${meta.status}`);}

  // 6. GET /files/medias/:task_id
  const list = await req(arch, 'GET', `/files/medias/${fakeTaskId}`);
  const listData = list.data as { data: Array<{ key: string; url: string }> };
  console.log(`  list: ${listData.data?.length ?? 0} files`);
  if (list.status === 200 && (listData.data?.length ?? 0) >= 1) {ok('GET /files/medias/:task_id');}
  else {fail(`list → ${list.status}, count=${listData.data?.length}`);}

  // 7. GET /files/archive/:doc_id — несуществующий → 404
  const docRes = await req(arch, 'GET', `/files/archive/${crypto.randomUUID()}`);
  if (docRes.status === 404) {ok('GET /files/archive/:doc_id → 404');}
  else {fail(`archive → ${docRes.status}`);}

  // 8. DELETE /files/:key
  const del = await req(arch, 'DELETE', `/files/${encoded}`);
  if (del.status === 204) {ok('DELETE /files/:key → 204');}
  else {fail(`DELETE → ${del.status}`);}

  // 9. DELETE повторно → 404
  const del2 = await req(arch, 'DELETE', `/files/${encoded}`);
  if (del2.status === 404) {ok('DELETE повторно → 404');}
  else {fail(`DELETE repeat → ${del2.status}`);}

  // 10. Без токена → 401
  const noAuth = await fetch(`${BASE}/files/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'chat', extension: 'txt' }),
  });
  if (noAuth.status === 401) {ok('no token → 401');}
  else {fail(`no token → ${noAuth.status}`);}

  // 11. Невалидное тело → 422
  const bad = await req(arch, 'POST', '/files/upload-url', {
    type: 'report',
    extension: 'txt',
    // task_id и report_id отсутствуют
  });
  if (bad.status === 422) {ok('invalid body → 422');}
  else {fail(`invalid body → ${bad.status}`);}

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());