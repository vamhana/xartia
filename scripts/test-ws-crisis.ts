import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerCrisisChannel,
  emitMobilizationStarted,
  emitMobilizationConfirmed,
  emitMobilizationRefused,
  emitMobilizationCompleted,
  emitCrisisPlanActivated,
} from '../src/ws/crisis.js';
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
    console.warn('⚠️  Токен просрочен или отсутствует. Запусти: pnpm tsx scripts/get-test-token.ts');
    process.exit(1);
  }

  const env = await loadWsEnv();
  const TOKEN = env.token;

  await startWSServer();
  await registerCrisisChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'crisis' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на crisis');

  const mobId = randomUUID();
  const regimeId = randomUUID();

  console.warn('\n─── 1. emitMobilizationStarted ───');
  await emitMobilizationStarted(
    {
      id: mobId,
      regimeId,
      requiredCount: 50,
      confirmedCount: 0,
      refusedCount: 0,
      thresholdPercent: 60,
      status: 'active',
      createdAt: new Date().toISOString(),
      completedAt: null,
    },
    {
      planId: randomUUID(),
      title: 'Угроза северному сектору',
      points: [
        { lat: 55.75, lon: 37.62, label: 'Точка А', etaMinutes: 15 },
        { lat: 55.76, lon: 37.63, label: 'Точка Б', etaMinutes: 20 },
      ],
    },
  );
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'crisis.mobilization_started');
  if (e1) {
    const p = e1.payload as { mobilization?: { requiredCount?: number }; plan?: { points?: unknown[] } };
    ok(`mobilization_started: required=${p.mobilization?.requiredCount}, points=${p.plan?.points?.length}`);
  }

  console.warn('\n─── 2. emitMobilizationConfirmed ───');
  await emitMobilizationConfirmed(mobId, 25, 50, 50);
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'crisis.mobilization_confirmed');
  if (e2) {ok(`confirmed: ${(e2.payload as { confirmedCount?: number }).confirmedCount}/50`);}

  console.warn('\n─── 3. emitMobilizationRefused ───');
  await emitMobilizationRefused(mobId, 3, 6);
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'crisis.mobilization_refused');
  if (e3) {ok(`refused: ${(e3.payload as { refusedCount?: number }).refusedCount}`);}

  console.warn('\n─── 4. emitMobilizationCompleted ───');
  await emitMobilizationCompleted(mobId, {
    confirmedCount: 32,
    refusedCount: 3,
    totalParticipants: 50,
  });
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'crisis.mobilization_completed');
  if (e4) {ok('mobilization_completed');}

  console.warn('\n─── 5. emitCrisisPlanActivated ───');
  await emitCrisisPlanActivated(
    randomUUID(),
    'План мобилизации А',
    [{ lat: 55.75, lon: 37.62, label: 'Сбор' }],
  );
  await new Promise((r) => setTimeout(r, 300));
  const e5 = c1.received.find((x) => x.event === 'crisis.plan_activated');
  if (e5) {ok('crisis.plan_activated');}

  console.warn('\n─── 6. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length === 5) {ok('5 событий, все долетели');}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS crisis smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});