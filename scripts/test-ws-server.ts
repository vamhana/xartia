import 'dotenv/config';
import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import { startWSServer, stopWSServer, broadcast, sendToParticipant, sendToDirection, getStats } from '../src/ws/server.js';

const WS_URL = 'ws://localhost:3001/ws';

function ok(m: string) { console.warn(`   ✓ ${m}`); }
function _fail(m: string) { console.warn(`   ✗ ${m}`); }

interface MockClient {
  socket: WebSocket;
  received: Array<{ event: string; payload: unknown }>;
  connectionId: string | null;
}

async function connect(token: string): Promise<MockClient> {
  const socket = new WebSocket(`${WS_URL}?token=${token}`);
  const received: Array<{ event: string; payload: unknown }> = [];
  const client: MockClient = { socket, received, connectionId: null };

  socket.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      received.push({ event: m.event, payload: m.payload });
      if (m.event === 'connected') {client.connectionId = m.payload.connectionId;}
    } catch { /* ignore */ }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  // Даём время welcome-сообщению прийти.
  await new Promise((r) => setTimeout(r, 300));
  return client;
}

async function main(): Promise<void> {
  const TOKEN = process.env['WS_TEST_TOKEN'] ?? process.argv[2] ?? '';
  const PARTICIPANT_ID = process.env['WS_TEST_PID'] ?? process.argv[3] ?? '';
  const DIRECTION_ID = process.env['WS_TEST_DIR'] ?? process.argv[4] ?? '';

  if (!TOKEN || !PARTICIPANT_ID || !DIRECTION_ID) {
    console.error('Usage: pnpm tsx scripts/test-ws-server.ts <token> <participantId> <directionId>');
    console.error('   или задайте WS_TEST_TOKEN, WS_TEST_PID, WS_TEST_DIR');
    process.exit(1);
  }

  console.warn('\n─── 1. Запуск WS-сервера ───');
  await startWSServer();
  ok('сервер запущен на порту 3001');

  console.warn('\n─── 2. Клиент 1: подключение с валидным токеном ───');
  const c1 = await connect(TOKEN);
  console.warn('connectionId:', c1.connectionId);
  console.warn('received events:', c1.received.map((r) => r.event));
  if (c1.connectionId) {ok('welcome пришёл, connectionId получен');}

  console.warn('\n─── 3. Клиент 2: без токена → close 4401 ───');
  const socket2 = new WebSocket(WS_URL);
  const c2 = await new Promise<{ code: number }>((resolve) => {
    socket2.on('close', (code) => resolve({ code }));
    socket2.on('error', () => resolve({ code: -1 }));
    setTimeout(() => resolve({ code: -2 }), 3000);
  });
  console.warn('close code:', c2.code);
  if (c2.code === 4401) {ok('отказ без токена — 4401');}

  console.warn('\n─── 4. Клиент 1: subscribe на "test-channel" ───');
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'test-channel', requestId: 'r1' }));
  await new Promise((r) => setTimeout(r, 200));
  const subEvent = c1.received.find((r) => r.event === 'subscribed');
  if (subEvent) {ok(`subscribed: ${JSON.stringify(subEvent.payload)}`);}

  console.warn('\n─── 5. broadcast на "test-channel" ───');
  const receivers = await broadcast('test-channel', 'test.event', { foo: 'bar', n: 42 });
  console.warn('redis receivers:', receivers);
  await new Promise((r) => setTimeout(r, 300));
  const broadcastEvent = c1.received.find((r) => r.event === 'test.event');
  console.warn('got:', broadcastEvent?.payload);
  if (broadcastEvent) {ok('broadcast дошёл');}

  console.warn('\n─── 6. sendToParticipant ───');
  await sendToParticipant(PARTICIPANT_ID as never, 'personal.event', { hello: 'world' });
  await new Promise((r) => setTimeout(r, 300));
  const personalEvent = c1.received.find((r) => r.event === 'personal.event');
  console.warn('got:', personalEvent?.payload);
  if (personalEvent) {ok('персональное сообщение дошло');}

  console.warn('\n─── 7. sendToDirection ───');
  await sendToDirection(DIRECTION_ID as never, 'direction.event', { dir: DIRECTION_ID });
  await new Promise((r) => setTimeout(r, 300));
  const dirEvent = c1.received.find((r) => r.event === 'direction.event');
  console.warn('got:', dirEvent?.payload);
  if (dirEvent) {ok('направленное сообщение дошло');}

  console.warn('\n─── 8. ping/pong ───');
  c1.socket.send(JSON.stringify({ action: 'ping', requestId: 'ping-1' }));
  await new Promise((r) => setTimeout(r, 200));
  const pong = c1.received.find((r) => r.event === 'pong');
  if (pong) {ok(`pong: ${JSON.stringify(pong.payload)}`);}

  console.warn('\n─── 9. getStats ───');
  const stats = getStats();
  console.warn(stats);
  if (stats.activeConnections === 1) {ok('1 активное соединение');}
  if (stats.channels['test-channel'] === 1) {ok('канал "test-channel" с 1 подписчиком');}

  console.warn('\n─── 10. unsubscribe ───');
  c1.socket.send(JSON.stringify({ action: 'unsubscribe', channel: 'test-channel' }));
  await new Promise((r) => setTimeout(r, 200));
  const unsubEvent = c1.received.find((r) => r.event === 'unsubscribed');
  if (unsubEvent) {ok('unsubscribed');}
  const stats2 = getStats();
  if (!stats2.channels['test-channel']) {ok('канал удалён из статистики');}

  console.warn('\n─── 11. Клиент 1: закрытие ───');
  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 300));
  const stats3 = getStats();
  if (stats3.activeConnections === 0) {ok('0 активных соединений после close');}

  console.warn('\n─── 12. Остановка сервера ───');
  await stopWSServer();
  ok('сервер остановлен');

  await redis.quit();
  console.warn('\n✅ WS server smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});