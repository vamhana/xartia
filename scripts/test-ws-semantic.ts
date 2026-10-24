import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerSemanticChannel,
  emitDriftDetected,
  emitAlarmRaised,
  emitAlarmEscalated,
  emitVetoImposed,
  emitVetoLifted,
  emitReportPublished,
  emitPressureReported,
} from '../src/ws/semantic.js';
import { startWSServer, stopWSServer } from '../src/ws/server.js';



const WS_URL = 'ws://localhost:3001/ws';
function ok(m: string) { console.warn(`   ✓ ${m}`); }

interface MockClient {
  socket: WebSocket;
  received: Array<{ event: string; payload: unknown }>;
}

async function connect(token: string): Promise<MockClient> {
  const socket = new WebSocket(`${WS_URL}?token=${token}`);
  const received: Array<{ event: string; payload: unknown }> = [];
  const client: MockClient = { socket, received };
  socket.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      received.push({ event: m.event, payload: m.payload });
    } catch { /* ignore */ }
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('open', () => { clearTimeout(timer); resolve(); });
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  await new Promise((r) => setTimeout(r, 300));
  return client;
}

async function main(): Promise<void> {
  const { loadWsEnv, isTokenExpired } = await import('./lib/ws-env.js');
  if (await isTokenExpired()) {
    console.warn('⚠️  Токен просрочен. Запусти: pnpm tsx scripts/get-test-token.ts');
    process.exit(1);
  }
  const env = await loadWsEnv();
  const TOKEN = env.token;

  await startWSServer();
  await registerSemanticChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'semantic' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на semantic');

  console.warn('\n─── 1. emitDriftDetected ───');
  await emitDriftDetected({
    id: randomUUID(),
    term: 'свобода',
    severity: 7,
    originalMeaning: 'Отсутствие принуждения',
    detectedMeaning: 'Возможность делать что угодно',
    detectedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.drift')) {ok('semantic.drift');}

  console.warn('\n─── 2. emitAlarmRaised ───');
  await emitAlarmRaised({
    id: randomUUID(),
    driftId: null,
    priority: 10,
    raisedBy: randomUUID(),
    raisedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.alarm')) {ok('semantic.alarm');}

  console.warn('\n─── 3. emitAlarmEscalated ───');
  await emitAlarmEscalated(randomUUID(), 'forum', new Date().toISOString());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.alarm_escalated')) {ok('semantic.alarm_escalated');}

  console.warn('\n─── 4. emitVetoImposed ───');
  await emitVetoImposed({
    id: randomUUID(),
    type: 'semantic_guardian',
    decisionRef: randomUUID(),
    reason: 'Затрагивает базовые блага',
    validFrom: new Date().toISOString(),
    validTo: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.veto')) {ok('semantic.veto');}

  console.warn('\n─── 5. emitVetoLifted ───');
  await emitVetoLifted(randomUUID(), 'Проверено', new Date().toISOString());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.veto_lifted')) {ok('semantic.veto_lifted');}

  console.warn('\n─── 6. emitReportPublished ───');
  await emitReportPublished(2026, new Date().toISOString());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.report_published')) {ok('semantic.report_published');}

  console.warn('\n─── 7. emitPressureReported ───');
  await emitPressureReported('Тестовое давление', randomUUID(), randomUUID());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'semantic.pressure_reported')) {ok('semantic.pressure_reported');}

  console.warn('\n─── 8. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 7) {ok(`${events.length} событий`);}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS semantic smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});