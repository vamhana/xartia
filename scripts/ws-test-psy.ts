// scripts/ws-test-psy.ts
// E2E-проверка WS-канала psy (W.2.14.01).
//
// 1. Логинится Архитектором и получает свежий access-токен.
// 2. Открывает WebSocket на ws://localhost:3001/ws?token=...
// 3. Ждёт 'connected' → подписывается на канал 'psy'.
// 4. Через HTTP делает POST /psy/sessions (создание сессии).
// 5. Ждёт WS-событие 'psy.session.scheduled' с нужным sessionId.
// 6. Делает POST /psy/wellbeing (self-service) и ждёт 'psy.wellbeing.recorded'.
// 7. Закрывает WS.
//
// Запуск: pnpm tsx scripts/ws-test-psy.ts [phone] [password]
// Параметры по умолчанию берутся из .env (ARCHITECT_PHONE/PASSWORD).

import 'dotenv/config';

import WebSocket from 'ws';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';
const WS_URL  = process.env['WS_URL']  ?? 'ws://localhost:3001';
const PHONE   = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const PASSWORD = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'];

if (!PASSWORD) {
  console.error('Usage: pnpm tsx scripts/ws-test-psy.ts <phone> <password>');
  process.exit(1);
}

// ─── Утилиты ─────────────────────────────────────────────────────

function ok(msg: string): void   { console.log(`   ✓ ${msg}`); }

function info(msg: string): void { console.log(`   · ${msg}`); }

async function login(): Promise<{
  access_token: string;
  participant: { id: string; direction_id: string };
}> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{
    access_token: string;
    participant: { id: string; direction_id: string };
  }>;
}

async function apiPost<T>(
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`POST ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return data as T;
}

// Ожидание WS-события с таймаутом.
function waitForEvent(
  ws: WebSocket,
  event: string,
  predicate?: (payload: unknown) => boolean,
  timeoutMs = 5000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timeout waiting for ${event} (${timeoutMs}ms)`));
    }, timeoutMs);

    function onMessage(raw: Buffer): void {
      let msg: { event: string; payload: unknown };
      try {
        msg = JSON.parse(raw.toString('utf8')) as { event: string; payload: unknown };
      } catch {
        return;
      }
      if (msg.event !== event) { return; }
      if (predicate && !predicate(msg.payload)) { return; }
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg.payload);
    }

    ws.on('message', onMessage);
  });
}

// ─── Основной сценарий ───────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Login
  const { access_token, participant } = await login();
  console.log(`✅ Logged in: ${participant.id} (direction=${participant.direction_id})`);

  // 2. Открыть WS
  const wsUrl = `${WS_URL}/ws?token=${encodeURIComponent(access_token)}`;
  console.log(`→ WS connect: ${WS_URL}/ws?token=…`);
  const ws = new WebSocket(wsUrl);

  // 3. Дождаться 'connected' — sanity, что auth прошёл
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
  const connected = await waitForEvent(ws, 'connected');
  ok(`WS connected: ${JSON.stringify(connected).slice(0, 80)}…`);

  // 4. Подписаться на канал psy
  ws.send(JSON.stringify({ action: 'subscribe', channel: 'psy', requestId: 'sub-1' }));
  await waitForEvent(ws, 'subscribed', (p) =>
    typeof p === 'object' && p !== null && (p as { channel?: string }).channel === 'psy',
  );
  ok('subscribed: psy');

  // 5. Триггер: создать сессию → ждём psy.session.scheduled
  const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
  const sessionPromise = waitForEvent(
    ws,
    'psy.session.scheduled',
    (p) => {
      const payload = p as { participantId?: string; type?: string };
      return payload.participantId === participant.id && payload.type === 'onboarding';
    },
    6000,
  );

  const session = await apiPost<{ id: string; status: string }>(
    '/psy/sessions',
    access_token,
    {
      participant_id: participant.id,
      type: 'onboarding',
      scheduled_at: scheduledAt,
    },
  );
  info(`POST /psy/sessions → ${session.id} [${session.status}]`);

  const schedPayload = await sessionPromise;
  ok(`WS event 'psy.session.scheduled': ${JSON.stringify(schedPayload).slice(0, 120)}…`);

  // 6. Триггер: записать wellbeing → ждём psy.wellbeing.recorded
  const wellbeingPromise = waitForEvent(
    ws,
    'psy.wellbeing.recorded',
    (p) => {
      const payload = p as { participantId?: string; score?: number };
      return payload.participantId === participant.id && payload.score === 7;
    },
    6000,
  );

  await apiPost('/psy/wellbeing', access_token, {
    participant_id: participant.id,
    score: 7,
  });
  const wbPayload = await wellbeingPromise;
  ok(`WS event 'psy.wellbeing.recorded': ${JSON.stringify(wbPayload).slice(0, 120)}…`);

  // 7. Завершить сессию → ждём psy.session.completed
  const completePromise = waitForEvent(
    ws,
    'psy.session.completed',
    (p) => (p as { id?: string }).id === session.id,
    6000,
  );
  await apiPost(`/psy/sessions/${session.id}/complete`, access_token, {
    notes: 'WS smoke-test',
  });
  const completePayload = await completePromise;
  ok(`WS event 'psy.session.completed': ${JSON.stringify(completePayload).slice(0, 120)}…`);

  // Готово
  ws.close(1000, 'test done');
  console.log('\n✅ WS-канал psy: полный цикл прошёл');
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});