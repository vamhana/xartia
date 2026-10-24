import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { redis } from '../src/lib/redis.js';
import { startWSServer, stopWSServer } from '../src/ws/server.js';
import {
  registerTaskChannel,
  emitTaskAssigned,
  emitTaskStatusChanged,
  emitTaskSubmitted,
  emitTaskAccepted,
  emitTaskReturned,
} from '../src/ws/tasks.js';



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
  await registerTaskChannel();

  const c1 = await connect(TOKEN);
  c1.socket.send(JSON.stringify({ action: 'subscribe', channel: 'tasks' }));
  await new Promise((r) => setTimeout(r, 200));
  ok('подписан на tasks');

  const taskId = randomUUID();
  const dirId = randomUUID();
  const assigneeId = randomUUID();
  const task = {
    id: taskId,
    externalId: 'ЗДЧ-2026-10-08-001',
    directionId: dirId,
    planId: null,
    description: 'Проверить клапан',
    priority: 'standard' as const,
    status: 'assigned' as const,
    assignedTo: assigneeId,
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  console.warn('\n─── 1. emitTaskAssigned ───');
  await emitTaskAssigned(task, assigneeId);
  await new Promise((r) => setTimeout(r, 300));
  const e1 = c1.received.find((x) => x.event === 'task.assigned');
  if (e1) {ok(`task.assigned: ${(e1.payload as { task?: { externalId?: string } })?.task?.externalId}`);}

  console.warn('\n─── 2. emitTaskStatusChanged ───');
  await emitTaskStatusChanged({ ...task, status: 'in_progress' }, 'assigned');
  await new Promise((r) => setTimeout(r, 300));
  const e2 = c1.received.find((x) => x.event === 'task.status_changed');
  if (e2) {
    const p = e2.payload as { oldStatus?: string; newStatus?: string };
    ok(`status_changed: ${p.oldStatus} → ${p.newStatus}`);
  }

  console.warn('\n─── 3. emitTaskSubmitted ───');
  await emitTaskSubmitted({ ...task, status: 'submitted' });
  await new Promise((r) => setTimeout(r, 300));
  const e3 = c1.received.find((x) => x.event === 'task.submitted');
  if (e3) {ok('task.submitted');}

  console.warn('\n─── 4. emitTaskAccepted ───');
  await emitTaskAccepted({ ...task, status: 'accepted' });
  await new Promise((r) => setTimeout(r, 300));
  const e4 = c1.received.find((x) => x.event === 'task.accepted');
  if (e4) {ok('task.accepted');}

  console.warn('\n─── 5. emitTaskReturned ───');
  await emitTaskReturned({ ...task, status: 'returned' }, 'Не хватает фото');
  await new Promise((r) => setTimeout(r, 300));
  const e5 = c1.received.find((x) => x.event === 'task.returned');
  if (e5) {ok(`task.returned: reason="${(e5.payload as { reason?: string })?.reason}"`);}

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

  console.warn('\n✅ WS tasks smoke OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await stopWSServer(); } catch { /* ignore */ }
  try { await redis.quit(); } catch { /* ignore */ }
  process.exit(1);
});