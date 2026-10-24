import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerRegimeChannel,
  emitRegimeActivated,
  emitRegimeDeactivated,
  emitRegimeAudited,
  emitQuantumAccelerationActivated,
  emitInfoBlockadeActivated,
  emitInfoBlockadeLifted,
} from '../src/ws/regimes.js';
import { startWSServer, stopWSServer } from '../src/ws/server.js';



const WS_URL = 'ws://localhost:3001/ws';

function ok(m: string) { console.warn(`   ✓ ${m}`); }
function _fail(m: string) { console.warn(`   ✗ ${m}`); }

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
  await registerRegimeChannel();

  const c1 = await connect(TOKEN);

  // Подписываемся на канал 'regimes' явно (по дизайну W.0.01.01).
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'regimes' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на regimes');

  const regimeId = randomUUID();

  console.warn('\n─── 1. emitRegimeActivated ───');
  await emitRegimeActivated({
    id: regimeId,
    type: 'steel_bell',
    activatedAt: new Date().toISOString(),
    status: 'active',
    reason: 'тест',
  });
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'regime.activated');
  if (e1) {ok(`regime.activated: ${(e1.payload as { type?: string })?.type}`);}

  console.warn('\n─── 2. emitQuantumAccelerationActivated ───');
  await emitQuantumAccelerationActivated({
    critical: 60000,
    high: 3600000,
    standard: 10800000,
    background: 86400000,
  });
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'quantum_acceleration.activated');
  if (e2) {
    const acc = (e2.payload as { acceleratedDeadlines?: { critical?: number } })
      ?.acceleratedDeadlines;
    if (acc?.critical === 6000) {ok('critical 60000 → 6000');}
  }

  console.warn('\n─── 3. emitInfoBlockadeActivated ───');
  await emitInfoBlockadeActivated({
    id: randomUUID(),
    type: 'info_blockade',
    activatedAt: new Date().toISOString(),
    status: 'active',
    reason: 'gateway timeout',
  });
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'info_blockade.activated');
  if (e3) {ok('info_blockade.activated');}

  console.warn('\n─── 4. emitInfoBlockadeLifted ───');
  await emitInfoBlockadeLifted(regimeId, 'audit passed');
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'info_blockade.lifted');
  if (e4) {ok('info_blockade.lifted');}

  console.warn('\n─── 5. emitRegimeAudited ───');
  await emitRegimeAudited({
    regimeId,
    type: 'red_circuit',
    findings: ['просрочено на 2 дня'],
    auditedAt: new Date().toISOString(),
    nextAuditAt: null,
  });
  await new Promise((r) => setTimeout(r, 300));
  const e5 = c1.received.find((x) => x.event === 'regime.audited');
  if (e5) {ok('regime.audited');}

  console.warn('\n─── 6. emitRegimeDeactivated ───');
  await emitRegimeDeactivated(regimeId, 'steel_bell', 'угроза снята');
  await new Promise((r) => setTimeout(r, 300));
  const e6 = c1.received.find((x) => x.event === 'regime.deactivated');
  if (e6) {ok('regime.deactivated');}

  console.warn('\n─── 7. Полный список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length === 6) {ok(`6 событий, все долетели`);}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS regimes smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});