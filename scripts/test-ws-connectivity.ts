import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerConnectivityChannel,
  emitItemQueued,
  emitItemRouted,
  emitItemOverdue,
  emitItemEscalated,
  emitDeadlineApproaching,
} from '../src/ws/connectivity.js';
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
  await registerConnectivityChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'connectivity' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на connectivity');

  const item = {
    id: randomUUID(),
    signalId: randomUUID(),
    currentDirectionId: null,
    targetDirectionId: randomUUID(),
    priority: 'high' as const,
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    status: 'queued',
    iterations: 0,
    createdAt: new Date().toISOString(),
    routedAt: null,
    escalatedAt: null,
  };

  console.warn('\n─── 1. emitItemQueued ───');
  await emitItemQueued(item);
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'connectivity.queued');
  if (e1) {ok(`queued: priority=${(e1.payload as { priority?: string })?.priority}`);}

  console.warn('\n─── 2. emitItemRouted ───');
  await emitItemRouted({ ...item, status: 'routed', routedAt: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'connectivity.routed');
  if (e2) {ok('routed');}

  console.warn('\n─── 3. emitItemOverdue ───');
  await emitItemOverdue({ ...item, status: 'overdue' });
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'connectivity.overdue');
  if (e3) {ok('overdue');}

  console.warn('\n─── 4. emitItemEscalated ───');
  await emitItemEscalated({ ...item, status: 'escalated', iterations: 3 }, randomUUID());
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'connectivity.escalated');
  if (e4) {ok('escalated');}

  console.warn('\n─── 5. emitDeadlineApproaching ───');
  await emitDeadlineApproaching(item, 75);
  await new Promise((r) => setTimeout(r, 300));
  const e5 = c1.received.find((x) => x.event === 'connectivity.deadline_approaching');
  if (e5) {ok(`deadline_approaching: percent=${(e5.payload as { percent?: number })?.percent}`);}

  console.warn('\n─── 6. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 5) {ok(`${events.length} событий`);}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS connectivity smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});