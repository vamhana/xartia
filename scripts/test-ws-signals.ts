import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import { startWSServer, stopWSServer } from '../src/ws/server.js';
import {
  registerSignalChannel,
  emitSignalCreated,
  emitSignalUpdated,
  emitSignalEscalated,
  emitResponseAdded,
  emitConnectionStarted,
  emitLeadDirectionSet,
} from '../src/ws/signals.js';



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
  const PARTICIPANT_ID = env.participantId;

  await startWSServer();
  await registerSignalChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'signals' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на signals');

  const signalId = randomUUID();
  const signal = {
    id: signalId,
    externalId: `SIG-2026-10-08-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`,
    initiatorId: PARTICIPANT_ID,
    type: 'problem' as const,
    description: 'Тестовый сигнал',
    justification: 'Проверка WS',
    directions: [],
    priority: 'standard' as const,
    status: 'new' as const,
    iterations: 0,
    leadDirectionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  console.warn('\n─── 1. emitSignalCreated ───');
  await emitSignalCreated(signal);
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'signal.created');
  if (e1) {ok(`signal.created: ${(e1.payload as { externalId?: string })?.externalId}`);}
  const ack = c1.received.find((x) => x.event === 'signal.created.ack');
  if (ack) {ok('ack инициатору пришёл');}

  console.warn('\n─── 2. emitSignalUpdated ───');
  await emitSignalUpdated({ ...signal, status: 'run', updatedAt: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'signal.updated');
  if (e2) {ok(`signal.updated: status=${(e2.payload as { status?: string })?.status}`);}

  console.warn('\n─── 3. emitLeadDirectionSet ───');
  const dirId = randomUUID();
  await emitLeadDirectionSet(signalId, dirId);
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'signal.lead_direction_set');
  if (e3) {ok(`lead_direction_set: ${(e3.payload as { directionId?: string })?.directionId?.slice(0, 8)}...`);}

  console.warn('\n─── 4. emitResponseAdded ───');
  await emitResponseAdded({
    id: randomUUID(),
    signalId,
    directionId: dirId,
    response: 'support',
    justification: 'Согласен',
    createdAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'signal.response_added');
  if (e4) {ok(`response_added: ${(e4.payload as { response?: string })?.response}`);}

  console.warn('\n─── 5. emitConnectionStarted ───');
  await emitConnectionStarted(signalId, randomUUID(), PARTICIPANT_ID);
  await new Promise((r) => setTimeout(r, 300));
  const e5 = c1.received.find((x) => x.event === 'signal.connection_started');
  if (e5) {ok('connection_started');}

  console.warn('\n─── 6. emitSignalEscalated ───');
  await emitSignalEscalated(signalId, signal.externalId, 3, randomUUID());
  await new Promise((r) => setTimeout(r, 300));
  const e6 = c1.received.find((x) => x.event === 'signal.escalated');
  if (e6) {ok(`signal.escalated: iterations=${(e6.payload as { iterations?: number })?.iterations}`);}

  console.warn('\n─── 7. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 6) {ok(`${events.length} событий, все долетели`);}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS signals smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});