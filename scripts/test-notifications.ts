// scripts/test-notifications.ts
import 'dotenv/config';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { loadWsEnv } from './lib/ws-env.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface Client { token: string; participantId: string }

async function req<T>(
  c: Client,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: T;
  try { data = JSON.parse(text) as T; } catch { data = text as unknown as T; }
  return { status: res.status, data };
}

function ok(m: string) { console.log(`  ✓ ${m}`); }
function fail(m: string) { console.error(`  ✗ ${m}`); process.exitCode = 1; }

async function main() {
  console.log('▶ A.1.96.01 notifications smoke test\n');

  const env = await loadWsEnv();
  const arch: Client = { token: env.token, participantId: env.participantId };

  // 1. GET /notifications/preferences
  const prefs = await req<{ preferences: Record<string, boolean> }>(
    arch, 'GET', '/notifications/preferences',
  );
  console.log(`  prefs: ${JSON.stringify(prefs.data.preferences)}`);
  if (prefs.status === 200) {ok('GET /notifications/preferences');}
  else {fail(`GET prefs → ${prefs.status}`);}

  // 2. PUT /notifications/preferences
  const put = await req<{ preferences: Record<string, boolean> }>(
    arch, 'PUT', '/notifications/preferences',
    { email: true, telegram: false, ws: false }, // ws: false → принудительно true
  );
  console.log(`  put → ws=${put.data.preferences?.ws}`);
  if (put.data.preferences?.ws === true) {ok('PUT prefs (ws принудительно true)');}
  else {fail(`PUT prefs → ws=${put.data.preferences?.ws}`);}

  // 3. POST /notifications/devices
  const reg = await req<{ device_id: string }>(
    arch, 'POST', '/notifications/devices',
    { device_token: 'test-token-abc-123', platform: 'ios' },
  );
  if (reg.status === 201) {ok('POST /notifications/devices');}
  else {fail(`POST device → ${reg.status}`);}

  // 4. GET /notifications/devices
  const devs = await req<{ devices: Array<{ token: string; platform: string }> }>(
    arch, 'GET', '/notifications/devices',
  );
  console.log(`  devices: ${devs.data.devices?.length ?? 0}`);
  if ((devs.data.devices?.length ?? 0) >= 1) {ok('GET /notifications/devices');}
  else {fail('devices пусты');}

  // 5. POST /notifications/test (ws)
  const test = await req<{ sent: boolean; delivered: string[] }>(
    arch, 'POST', '/notifications/test', { channel: 'ws' },
  );
  console.log(`  test ws: sent=${test.data.sent}, delivered=${test.data.delivered?.join(',')}`);
  ok('POST /notifications/test');

  // 6. GET /notifications/history — должны увидеть test.notification
  const hist = await req<{ data: Array<{ type: string }>; meta: { total: number } }>(
    arch, 'GET', '/notifications/history?page=1&per_page=10',
  );
  console.log(`  history total: ${hist.data.meta?.total}`);
  const hasTest = hist.data.data?.some((h) => h.type === 'test.notification');
  if (hasTest) {ok('GET /notifications/history (есть test.notification)');}
  else {fail('test.notification не найден в истории');}

  // 7. DELETE /notifications/devices/:token
  const encoded = encodeURIComponent('test-token-abc-123');
  const del = await req(arch, 'DELETE', `/notifications/devices/${encoded}`);
  if (del.status === 204) {ok('DELETE device → 204');}
  else {fail(`DELETE device → ${del.status}`);}

  // 8. DELETE повторно → 404
  const del2 = await req(arch, 'DELETE', `/notifications/devices/${encoded}`);
  if (del2.status === 404) {ok('DELETE повторно → 404');}
  else {fail(`DELETE repeat → ${del2.status}`);}

  // 9. Без токена → 401
  const noAuth = await fetch(`${BASE}/notifications/preferences`);
  if (noAuth.status === 401) {ok('no token → 401');}
  else {fail(`no token → ${noAuth.status}`);}

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());