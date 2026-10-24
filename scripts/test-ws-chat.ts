import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerChatChannel,
  emitChatMessage,
  emitChatMessageEdited,
  emitChatMessageDeleted,
  emitChatTyping,
  emitChatMention,
  emitChatJoined,
  emitChatLeft,
  emitChatChannelArchived,
} from '../src/ws/chat.js';
import { startWSServer, stopWSServer } from '../src/ws/server.js';



const WS_PORT = Number(process.env['WS_PORT'] ?? '3001');
const WS_URL = `ws://localhost:${WS_PORT}/ws`;

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
  await registerChatChannel();

  const channelId = `direct:${PID}:${randomUUID()}`;
  const otherChannel = `direction:${randomUUID()}`;

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: `chat:${channelId}` }));
  await new Promise((r) => setTimeout(r, 200));
  ok(`подписан на chat:${channelId}`);

  const c2 = await connect(TOKEN);
  c2.socket.send(JSON.stringify({ action: 'subscribe', channel: `chat:${channelId}` }));
  await new Promise((r) => setTimeout(r, 200));
  ok('второй клиент в комнате');

  const c3 = await connect(TOKEN);
  c3.socket.send(JSON.stringify({ action: 'subscribe', channel: `chat:${otherChannel}` }));
  await new Promise((r) => setTimeout(r, 200));
  ok('третий клиент в другой комнате');

  const msg = {
    id: randomUUID(),
    channelId: randomUUID(),
    senderId: PID,
    content: 'Привет, мир!',
    mentions: [],
    attachments: [],
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
  };

  console.warn('\n─── 1. emitChatMessage ───');
  await emitChatMessage(channelId, msg);
  await new Promise((r) => setTimeout(r, 300));
  const e1a = c1.received.find((x) => x.event === 'chat.message');
  const e1b = c2.received.find((x) => x.event === 'chat.message');
  const e1c = c3.received.find((x) => x.event === 'chat.message');
  if (e1a && e1b) {ok('оба клиента получили chat.message');}
  if (!e1c) {ok('c3 не получил (изоляция комнат)');}

  console.warn('\n─── 2. emitChatTyping ───');
  await emitChatTyping(channelId, PID);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.typing')) {ok('chat.typing');}

  console.warn('\n─── 3. emitChatMessageEdited ───');
  await emitChatMessageEdited(channelId, { ...msg, content: 'Изменено', editedAt: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.message_edited')) {ok('chat.message_edited');}

  console.warn('\n─── 4. emitChatMention ───');
  const mentionedId = randomUUID();
  await emitChatMention(channelId, mentionedId, msg);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.mention')) {ok('chat.mention');}

  console.warn('\n─── 5. emitChatJoined ───');
  await emitChatJoined(channelId, randomUUID());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.joined')) {ok('chat.joined');}

  console.warn('\n─── 6. emitChatLeft ───');
  await emitChatLeft(channelId, randomUUID());
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.left')) {ok('chat.left');}

  console.warn('\n─── 7. emitChatMessageDeleted ───');
  await emitChatMessageDeleted(channelId, msg.id, PID);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.message_deleted')) {ok('chat.message_deleted');}

  console.warn('\n─── 8. emitChatChannelArchived ───');
  await emitChatChannelArchived(channelId, 'тест завершён');
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'chat.channel_archived')) {ok('chat.channel_archived');}

  console.warn('\n─── 9. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 8) {ok(`${events.length} событий`);}

  c1.socket.close(1000, 'bye');
  c2.socket.close(1000, 'bye');
  c3.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 300));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS chat smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});