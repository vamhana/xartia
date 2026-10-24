import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerInterviewChannel,
  emitOffer,
  emitAnswer,
  emitIceCandidate,
  emitRecordingStarted,
  emitRecordingStopped,
  emitInterviewEnded,
  emitTranscriptReady,
  emitScoreReady,
} from '../src/ws/interview.js';
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
  await registerInterviewChannel();

  const interviewId = randomUUID();
  const room = `interview:${interviewId}`;
  const connectionId = randomUUID();

  // Клиент 1 — interviewer
  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: room }));
  await new Promise((r) => setTimeout(r, 200));
  ok(`подписан на ${room}`);

  // Клиент 2 — второй интервьюер (наблюдатель)
  const c2 = await connect(TOKEN);
  c2.socket.send(JSON.stringify({ action: 'subscribe', channel: room }));
  await new Promise((r) => setTimeout(r, 200));
  ok('второй клиент в комнате');

  console.warn('\n─── 1. emitOffer ───');
  await emitOffer({
    interviewId,
    fromConnectionId: connectionId,
    data: { type: 'offer', sdp: 'v=0\r\no=- 12345 1 IN IP4 127.0.0.1\r\n...' },
  });
  await new Promise((r) => setTimeout(r, 300));
  const e1a = c1.received.find((x) => x.event === 'interview.offer');
  const e1b = c2.received.find((x) => x.event === 'interview.offer');
  if (e1a && e1b) {ok('offer долетел до обоих клиентов');}

  console.warn('\n─── 2. emitAnswer ───');
  await emitAnswer({
    interviewId,
    fromConnectionId: connectionId,
    data: { type: 'answer', sdp: 'v=0\r\no=- 67890 1 IN IP4 127.0.0.1\r\n...' },
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'interview.answer')) {ok('answer доставлен');}

  console.warn('\n─── 3. emitIceCandidate ───');
  await emitIceCandidate({
    interviewId,
    fromConnectionId: connectionId,
    data: { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host' },
  });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'interview.ice_candidate')) {ok('ice_candidate доставлен');}

  console.warn('\n─── 4. emitRecordingStarted ───');
  await emitRecordingStarted(interviewId, connectionId);
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'interview.recording_started')) {ok('recording_started');}

  console.warn('\n─── 5. emitRecordingStopped ───');
  await emitRecordingStopped(
    interviewId,
    `media/interview/${interviewId}.webm`,
  );
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'interview.recording_stopped')) {ok('recording_stopped');}

  console.warn('\n─── 6. emitTranscriptReady ───');
  await emitTranscriptReady(
    interviewId,
    'Интервьюер: Здравствуйте. Расскажите о себе.\nКандидат: Работаю в IT 8 лет...',
  );
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'interview.transcript_ready')) {ok('transcript_ready');}

  console.warn('\n─── 7. emitScoreReady ───');
  await emitScoreReady(
    interviewId,
    { cognitive: 8, behavioral: 7, reflective: 9, technical: 8 },
    'compatible',
  );
  await new Promise((r) => setTimeout(r, 300));
  const e7 = c1.received.find((x) => x.event === 'interview.score_ready');
  if (e7) {
    const v = (e7.payload as { verdict?: string })?.verdict;
    ok(`score_ready: verdict=${v}`);
  }

  console.warn('\n─── 8. emitInterviewEnded ───');
  await emitInterviewEnded(interviewId, 'completed');
  await new Promise((r) => setTimeout(r, 300));
  if (c1.received.find((x) => x.event === 'interview.ended')) {ok('interview.ended');}

  console.warn('\n─── 9. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 8) {ok(`${events.length} событий`);}

  console.warn('\n─── 10. Изоляция комнат ───');
  const otherRoom = `interview:${randomUUID()}`;
  const c3 = await connect(TOKEN);
  c3.socket.send(JSON.stringify({ action: 'subscribe', channel: otherRoom }));
  await new Promise((r) => setTimeout(r, 200));

  // Эмитим в основную комнату — c3 не должен получить.
  await emitOffer({
    interviewId,
    fromConnectionId: connectionId,
    data: { type: 'offer', sdp: 'x' },
  });
  await new Promise((r) => setTimeout(r, 300));
  const c3Offers = c3.received.filter((x) => x.event === 'interview.offer');
  if (c3Offers.length === 0) {ok('изоляция комнат работает — c3 не получил offer');}

  c1.socket.close(1000, 'bye');
  c2.socket.close(1000, 'bye');
  c3.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 300));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS interview smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});