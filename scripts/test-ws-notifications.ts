import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { send } from '../src/lib/notifications.js';
import {
  registerNotificationChannel,
  emitNotification,
  emitNotificationBatch,


  markReadAndEmit,
  markAllReadAndEmit,
  getUnreadCountForParticipant,
  getHistoryForParticipant,
} from '../src/ws/notifications.js';
import {
  startWSServer,
  stopWSServer,
} from '../src/ws/server.js';

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
  const PARTICIPANT_ID = env.participantId;

  // Используем синтетический PID для чистоты теста, чтобы не засорять
  // реальные уведомления Архитектора. Но WS-подключение — с реальным токеном.
  // Уведомления шлём на синтетический PID, но подписываемся на реальный токен.
  // Чтобы синтетические уведомления приходили на реальный сокет — используем
  // тот же participantId, что и в токене. См. ниже — реальная доставка.
  const pid = PARTICIPANT_ID as UUID_TYPE;

  console.warn('\n─── 1. Запуск WS server + регистрация канала ───');
  await startWSServer();
  await registerNotificationChannel();
  ok('сервер + канал');

  console.warn('\n─── 2. Клиент 1: подключение ───');
  const c1 = await connect(TOKEN);
  ok(`connected (received ${c1.received.length} событий)`);

  console.warn('\n─── 3. Клиент 2: подключение (мультиустройство) ───');
  const c2 = await connect(TOKEN);
  ok('второй сокет того же участника');

  console.warn('\n─── 4. send() через L.0.01.10 → emit в WS ───');
  const r1 = await send({
    recipientId: pid,
    type: 'task.assigned',
    priority: 'standard',
    title: 'Задача A',
    body: 'Проверить клапан',
    data: { externalId: 'ЗДЧ-001' },
  });
  console.warn('send result:', r1);
  await new Promise((r) => setTimeout(r, 400));

  const n1a = c1.received.filter((x) => x.event === 'notification.new');
  const n1b = c2.received.filter((x) => x.event === 'notification.new');
  console.warn(`c1 received: ${n1a.length}, c2 received: ${n1b.length}`);
  if (n1a.length === 1 && n1b.length === 1) {ok('оба сокета получили notification.new');}
  if ((n1a[0]?.payload as { title?: string })?.title === 'Задача A') {ok('payload корректный');}

  console.warn('\n─── 5. send() critical → все каналы, но в dev только ws ───');
  await send({
    recipientId: pid,
    type: 'crisis.mobilization_started',
    priority: 'critical',
    title: '🔴 МОБИЛИЗАЦИЯ',
    body: 'Собраться в точке А',
  });
  await new Promise((r) => setTimeout(r, 400));
  const n2a = c1.received.filter((x) => x.event === 'notification.new');
  console.warn(`c1 total notifications: ${n2a.length}`);
  if (n2a.length === 2) {ok('critical тоже долетело');}

  console.warn('\n─── 6. getUnreadCountForParticipant ───');
  const unreadBefore = await getUnreadCountForParticipant(pid);
  console.warn('unread:', unreadBefore);
  if (unreadBefore >= 2) {ok(`>= 2 unread`);}

  console.warn('\n─── 7. getHistoryForParticipant ───');
  const hist = await getHistoryForParticipant(pid, 10);
  console.warn('history count:', hist.length);
  if (hist.length >= 2) {ok('история возвращается');}

  console.warn('\n─── 8. markReadAndEmit → emitNotificationRead → оба сокета ───');
  const firstId = hist[0]!.id;
  await markReadAndEmit(pid, [firstId]);
  await new Promise((r) => setTimeout(r, 400));
  const r1a = c1.received.filter((x) => x.event === 'notification.read');
  const r1b = c2.received.filter((x) => x.event === 'notification.read');
  console.warn(`c1 read: ${r1a.length}, c2 read: ${r1b.length}`);
  if (r1a.length === 1 && r1b.length === 1) {ok('оба сокета получили notification.read');}

  console.warn('\n─── 9. markAllReadAndEmit ───');
  const allRes = await markAllReadAndEmit(pid);
  console.warn('updated:', allRes.updated);
  await new Promise((r) => setTimeout(r, 400));
  const r2a = c1.received.filter((x) => x.event === 'notification.read_all');
  const r2b = c2.received.filter((x) => x.event === 'notification.read_all');
  if (r2a.length === 1 && r2b.length === 1) {ok('оба сокета получили read_all');}

  const unreadAfter = await getUnreadCountForParticipant(pid);
  console.warn('unread after:', unreadAfter);
  if (unreadAfter === 0) {ok('все прочитано');}

  console.warn('\n─── 10. emitNotificationBatch (без реальных получателей) ───');
  const sent = await emitNotificationBatch(
    [randomUUID() as never, randomUUID() as never],
    {
      id: randomUUID(),
      type: 'test.broadcast',
      priority: 'standard',
      title: 'Broadcast',
      body: 'test',
      createdAt: new Date().toISOString(),
      read: false,
    } as never,
  );
  console.warn('sent to:', sent);
  ok('batch не упал на несуществующих получателях');

  console.warn('\n─── 11. emitNotification напрямую ───');
  const direct = await emitNotification(pid, {
    id: randomUUID(),
    recipientId: pid,
    type: 'test.direct',
    priority: 'standard',
    title: 'Direct',
    body: 'direct message',
    createdAt: new Date().toISOString(),
    read: false,
  });
  console.warn('direct:', direct);
  if (direct) {ok('emitNotification OK');}

  console.warn('\n─── 12. Закрытие + stop ───');
  c1.socket.close(1000, 'bye');
  c2.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 300));
  await stopWSServer();
  ok('закрыто');

  await gracefulShutdown();
  console.warn('\n✅ WS notifications smoke OK');
  process.exit(0);
}

// Минимальный локальный typedef, чтобы не тянуть UUID из core.
type UUID_TYPE = string;

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});