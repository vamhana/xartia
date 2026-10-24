import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerBalanceChannel,
  emitAnomalyDetected,
  emitAnomalyResolved,
  emitMetaRequest,
  emitNormativeSpeedsUpdated,
  emitCompetenceRisk,
  emitExcessCapacity,
  emitPulseUpdated,
} from '../src/ws/balance.js';
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
  await registerBalanceChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'balance' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на balance');

  console.warn('\n─── 1. emitAnomalyDetected ───');
  const dirId = randomUUID();
  await emitAnomalyDetected({
    id: randomUUID(), type: 'speed', directionId: dirId, severity: 7,
    status: 'new', metaRequestId: null,
    details: { avg_ms: 5000, norm_ms: 3000 },
    createdAt: new Date().toISOString(), resolvedAt: null,
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.anomaly')) {ok('balance.anomaly');}

  console.warn('\n─── 2. emitAnomalyResolved ───');
  await emitAnomalyResolved(randomUUID(), dirId, 'speed', randomUUID());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.anomaly_resolved')) {ok('balance.anomaly_resolved');}

  console.warn('\n─── 3. emitMetaRequest ───');
  await emitMetaRequest(randomUUID(), randomUUID(), [randomUUID(), randomUUID()]);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.meta_request')) {ok('balance.meta_request');}

  console.warn('\n─── 4. emitNormativeSpeedsUpdated ───');
  await emitNormativeSpeedsUpdated(3);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.norms_updated')) {ok('balance.norms_updated');}

  console.warn('\n─── 5. emitCompetenceRisk ───');
  await emitCompetenceRisk(
    {
      id: randomUUID(), directionId: dirId, status: 'active',
      reason: 'Систематические просрочки', verifiedBy: randomUUID(),
      validFrom: new Date().toISOString(), validTo: null,
    },
    'added',
    randomUUID(),
  );
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.competence_risk')) {ok('balance.competence_risk');}

  console.warn('\n─── 6. emitExcessCapacity ───');
  await emitExcessCapacity(0.55);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.excess_capacity')) {ok('balance.excess_capacity');}

  console.warn('\n─── 7. emitPulseUpdated ───');
  await emitPulseUpdated(dirId, { open_signals: 3, active_tasks: 8, overdue_tasks: 1 });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'balance.pulse_updated')) {ok('balance.pulse_updated');}

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

  console.warn('\n✅ WS balance smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});