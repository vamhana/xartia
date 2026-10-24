import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import {
  registerOtcChannel,
  emitReportSubmitted,
  emitDecisionMade,
  emitCrisisDecisionMade,
  emitAppealFiled,
  emitQueueUpdated,
} from '../src/ws/otc.js';
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
  await registerOtcChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'otc' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на otc');

  const dirId = randomUUID();
  const reportId = randomUUID();
  const taskId = randomUUID();
  const decisionId = randomUUID();
  const assignedTo = randomUUID();

  console.warn('\n─── 1. emitReportSubmitted ───');
  await emitReportSubmitted({
    reportId,
    taskId,
    taskExternalId: 'ЗДЧ-2026-10-08-001',
    directionId: dirId,
    authorId: assignedTo,
    type: 'photo',
    createdAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'otc.report_submitted');
  if (e1) {ok('otc.report_submitted');}

  console.warn('\n─── 2. emitDecisionMade (accepted) ───');
  await emitDecisionMade({
    decisionId,
    reportId,
    taskId,
    taskExternalId: 'ЗДЧ-2026-10-08-001',
    directionId: dirId,
    otcId: randomUUID(),
    verdict: 'accepted',
    comment: null,
    assignedTo,
    decidedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'otc.decision_made');
  if (e2) {ok(`decision_made: verdict=${(e2.payload as { verdict?: string })?.verdict}`);}

  console.warn('\n─── 3. emitCrisisDecisionMade ───');
  await emitCrisisDecisionMade({
    decisionId: randomUUID(),
    reportId: randomUUID(),
    taskId: randomUUID(),
    taskExternalId: 'ЗДЧ-CRISIS-001',
    directionId: dirId,
    otcId: randomUUID(),
    verdict: 'crisis_protocol',
    comment: 'Принято в кризисном режиме',
    assignedTo,
    decidedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'otc.crisis_decision');
  if (e3) {ok('otc.crisis_decision');}

  console.warn('\n─── 4. emitAppealFiled ───');
  await emitAppealFiled({
    appealId: randomUUID(),
    decisionId,
    participantId: assignedTo,
    directionId: dirId,
    reason: 'Решение принято необъективно',
    filedAt: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'otc.appeal_filed');
  if (e4) {ok('otc.appeal_filed');}

  console.warn('\n─── 5. emitQueueUpdated ───');
  await emitQueueUpdated(dirId, 7);
  await new Promise((r) => setTimeout(r, 300));
  const e5 = c1.received.find((x) => x.event === 'otc.queue_updated');
  if (e5) {ok(`queue_updated: size=${(e5.payload as { queueSize?: number })?.queueSize}`);}

  console.warn('\n─── 6. Список событий ───');
  const events = c1.received
    .map((x) => x.event)
    .filter((e) => !['connected', 'subscribed', 'pong'].includes(e));
  console.warn(events);
  if (events.length >= 5) {ok(`${events.length} событий, все долетели`);}

  c1.socket.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  await stopWSServer();
  await redis.quit();

  console.warn('\n✅ WS otc smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});