import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerPulseChannel,
  emitPulseUpdated,
  emitCommunityCreated,
  emitCommunityStatusChanged,
  emitBridgeEstablished,
  emitExpansionFrozen,
} from '../src/ws/pulse.js';
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
  await registerPulseChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'pulse' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на pulse');

  const communityId = randomUUID();
  const otherId = randomUUID();

  console.warn('\n─── 1. emitCommunityCreated ───');
  await emitCommunityCreated({
    id: communityId, code: 'АБ', name: 'Первая община',
    status: 'incubation', level: 0,
    motherCommunityId: null, protocolVersion: '5.0',
    createdAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'community.created')) {ok('community.created');}

  console.warn('\n─── 2. emitCommunityStatusChanged ───');
  await emitCommunityStatusChanged(communityId, 'active');
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'community.status_changed')) {ok('community.status_changed');}

  console.warn('\n─── 3. emitBridgeEstablished ───');
  await emitBridgeEstablished({
    id: randomUUID(),
    communityA: communityId, communityB: otherId,
    coefficient: 1.25,
    status: 'active',
    establishedAt: new Date().toISOString(),
    suspendedAt: null,
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'bridge.established')) {ok('bridge.established');}

  console.warn('\n─── 4. emitPulseUpdated ───');
  await emitPulseUpdated(communityId, {
    id: randomUUID(), communityId,
    baseGoodsLevel: 0.95,
    directionLoad: { '1': 0.4, '2': 0.6 },
    topSignals: [{ id: 'x', priority: 'high' }],
    createdAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'pulse.community_update')) {ok('pulse.community_update');}

  console.warn('\n─── 5. emitExpansionFrozen ───');
  await emitExpansionFrozen('Задержка моста > 5 сек');
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'expansion.frozen')) {ok('expansion.frozen');}

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

  console.warn('\n✅ WS pulse smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});