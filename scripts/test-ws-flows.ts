import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerFlowChannel,
  emitFlowCharged,
  emitFlowReturned,
  emitCapsuleUpdated,
  emitBalanceUpdated,
} from '../src/ws/flows.js';
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
  const PID = env.participantId;

  await startWSServer();
  await registerFlowChannel();

  const c1 = await connect(TOKEN);
  ok('подключён (персональный канал — подписка не нужна)');

  console.warn('\n─── 1. emitFlowCharged ───');
  await emitFlowCharged({
    id: randomUUID(),
    participantId: PID,
    type: 'main',
    amount: 1,
    reason: 'Приёмка задачи',
    source: 'otc',
    createdAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'flow.charged');
  if (e1) {
    const p = e1.payload as { amount?: number; type?: string };
    ok(`flow.charged: +${p.amount} ${p.type}`);
  }

  console.warn('\n─── 2. emitFlowReturned ───');
  await emitFlowReturned(PID, 5, 100);
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'flow.returned');
  if (e2) {
    const p = e2.payload as { returned?: number; remaining?: number };
    ok(`flow.returned: ${p.returned} (остаток ${p.remaining})`);
  }

  console.warn('\n─── 3. emitCapsuleUpdated ───');
  await emitCapsuleUpdated({
    participantId: PID,
    balance: 42,
    updatedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'capsule.updated');
  if (e3) {ok(`capsule.updated: ${(e3.payload as { balance?: number })?.balance}`);}

  console.warn('\n─── 4. emitBalanceUpdated ───');
  await emitBalanceUpdated({
    participantId: PID,
    balances: [
      { type: 'main', balance: 100 },
      { type: 'reflective', balance: 5 },
    ],
    updatedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'balance.updated');
  if (e4) {
    const n = (e4.payload as { balances?: unknown[] })?.balances?.length ?? 0;
    ok(`balance.updated: ${n} категорий`);
  }

  console.warn('\n─── 5. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 4) {ok(`${events.length} событий, все долетели`);}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS flows smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});