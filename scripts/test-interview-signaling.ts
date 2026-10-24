// scripts/test-interview-signaling.ts (I.9.04.44)
// Волна 5: WS signaling (W.0.01.01 case 'signal' + W.2.13.01 emit*).
// Требует запущенных: API (pnpm dev) и WS-сервер (pnpm dev:ws).
//
// Автодискавери: если WS_URL не задан в .env, скрипт пробует
// localhost:3001 / 3000 / 3002 и проверяет /health/live + /ws/stats.
//
// UI-компоненты TaskCard / VideoCall проверяются вручную в браузере —
// Playwright вне скоупа проекта.
//
// Запуск: pnpm tsx scripts/test-interview-signaling.ts <phone> <password>

import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { WebSocket } from 'ws';

const env = globalThis.process.env;
const API = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

// ─── HTTP ───────────────────────────────────────────────────────

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

// ─── WS endpoint discovery ──────────────────────────────────────

async function probe(url: string, timeoutMs = 800): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

interface WSEndpointInfo {
  wsUrl: string;
  source: string;
}

async function resolveWSEndpoint(): Promise<WSEndpointInfo | null> {
  const explicit = env['WS_URL'];
  if (explicit) {
    return { wsUrl: explicit, source: 'WS_URL env' };
  }

  const candidates = [
    'localhost:3001',
    'localhost:3000',
    'localhost:3002',
  ];

  for (const host of candidates) {
    const httpBase = `http://${host}`;
    const live = await probe(`${httpBase}/health/live`);
    if (!live) {continue;}

    const stats = await probe(`${httpBase}/ws/stats`);
    if (stats) {
      return {
        wsUrl: `ws://${host}/ws`,
        source: `auto-discovered (${host})`,
      };
    }
    // health/live отвечает, но /ws/stats — нет. Значит, не WS-сервер.
    console.log(
      `   · ${host}/health/live — ok, но /ws/stats — 404 (не WS-сервер)`,
    );
  }

  return null;
}

// ─── Counter ────────────────────────────────────────────────────

let OK = 0;
let FAIL = 0;

function ok(m: string): void {
  OK++;
  console.log(`   ✓ ${m}`);
}
function fail(m: string): void {
  FAIL++;
  console.log(`   ✗ ${m}`);
}
function expectEq<T>(a: T, b: T, m: string): boolean {
  if (a === b) {
    ok(m);
    return true;
  }
  fail(`${m} — ожидали ${String(b)}, получили ${String(a)}`);
  return false;
}
function expectTrue(c: boolean, m: string): boolean {
  if (c) {
    ok(m);
    return true;
  }
  fail(m);
  return false;
}
function summarize(): void {
  const total = OK + FAIL;
  console.log(`\n─── Итог: ${OK}/${total} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {globalThis.process.exitCode = 1;}
}

// ─── WS helpers ─────────────────────────────────────────────────

interface WSMessage {
  event: string;
  payload: unknown;
}

function parseMessage(raw: unknown): WSMessage | null {
  try {
    let s: string;
    if (typeof raw === 'string') {s = raw;}
    else if (Buffer.isBuffer(raw)) {s = raw.toString('utf8');}
    else if (Array.isArray(raw))
      {s = Buffer.concat(raw as Buffer[]).toString('utf8');}
    else if (raw instanceof ArrayBuffer)
      {s = Buffer.from(raw).toString('utf8');}
    else {return null;}
    return JSON.parse(s) as WSMessage;
  } catch {
    return null;
  }
}

interface OpenedWS {
  ws: WebSocket;
  connectionId: string;
  welcome: Record<string, unknown>;
}

function openWS(
  wsBase: string,
  token: string,
  timeoutMs = 5000,
): Promise<OpenedWS> {
  const sep = wsBase.includes('?') ? '&' : '?';
  const url = `${wsBase}${sep}token=${encodeURIComponent(token)}`;

  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      rejectPromise(new Error(`WS connect timeout (${timeoutMs}ms) — ${url}`));
    }, timeoutMs);

    const onMsg = (data: unknown): void => {
      const msg = parseMessage(data);
      if (!msg) {return;}
      if (msg.event === 'connected') {
        clearTimeout(timeout);
        ws.off('message', onMsg);
        const p = msg.payload as { connectionId?: string };
        if (typeof p.connectionId !== 'string') {
          rejectPromise(new Error('welcome: no connectionId'));
          return;
        }
        resolvePromise({
          ws,
          connectionId: p.connectionId,
          welcome: p as Record<string, unknown>,
        });
      }
    };
    const onErr = (e: Error): void => {
      clearTimeout(timeout);
      ws.off('message', onMsg);
      rejectPromise(new Error(`${e.message} — ${url}`));
    };
    const onClose = (code: number): void => {
      clearTimeout(timeout);
      ws.off('message', onMsg);
      rejectPromise(
        new Error(`WS closed before welcome (code ${code}) — ${url}`),
      );
    };

    ws.on('message', onMsg);
    ws.on('error', onErr);
    ws.on('close', onClose);
  });
}

function nextEvent(
  ws: WebSocket,
  eventName: string,
  timeoutMs = 3000,
): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      ws.off('message', onMsg);
      rejectPromise(
        new Error(`timeout waiting for ${eventName} (${timeoutMs}ms)`),
      );
    }, timeoutMs);

    const onMsg = (data: unknown): void => {
      const msg = parseMessage(data);
      if (!msg) {return;}
      if (msg.event === eventName) {
        clearTimeout(timeout);
        ws.off('message', onMsg);
        resolvePromise(msg.payload);
      }
    };
    ws.on('message', onMsg);
  });
}

async function subscribe(ws: WebSocket, channel: string): Promise<void> {
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      ws.off('message', onMsg);
      rejectPromise(new Error('subscribe timeout'));
    }, 3000);

    const onMsg = (data: unknown): void => {
      const msg = parseMessage(data);
      if (!msg) {return;}
      if (msg.event === 'subscribed') {
        const p = msg.payload as { channel?: string };
        if (p.channel === channel) {
          clearTimeout(timeout);
          ws.off('message', onMsg);
          resolvePromise();
        }
      } else if (msg.event === 'error') {
        clearTimeout(timeout);
        ws.off('message', onMsg);
        const p = msg.payload as { message?: string };
        rejectPromise(new Error(p.message ?? 'subscribe error'));
      }
    };
    ws.on('message', onMsg);
  });

  ws.send(JSON.stringify({ action: 'subscribe', channel }));
  await done;
}

function sendSignal(
  ws: WebSocket,
  channel: string,
  event: string,
  payload: unknown,
): void {
  ws.send(JSON.stringify({ action: 'signal', channel, event, payload }));
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const phone = globalThis.process.argv[2] ?? '+79001234567';
  const password = globalThis.process.argv[3];
  if (!password) {
    console.error(
      'Usage: pnpm tsx scripts/test-interview-signaling.ts <phone> <password>',
    );
    console.error('NOTE: WS-сервер должен быть запущен: pnpm dev:ws');
    globalThis.process.exit(1);
  }

  // 1. Login
  const login = await req<{
    access_token: string;
    participant: { id: string };
  }>('POST', '/auth/login', { phone, password });
  console.log(`\n─── POST /auth/login ─── [${login.status}]`);
  console.log(JSON.stringify({ ok: login.status === 200 }));
  if (login.status !== 200) {
    fail('POST /auth/login');
    return;
  }
  TOKEN = login.data.access_token;
  console.log(`✅ Logged in: ${login.data.participant.id}`);

  // 2. Wave 5 — компоненты на диске
  console.log('\n─── Wave 5: file existence ───');
  for (const p of [
    'src/web/components/tasks/TaskCard.tsx',
    'src/web/components/ui/VideoCall.tsx',
  ]) {
    if (existsSync(resolve(p))) {ok(`file exists: ${p}`);}
    else {fail(`file missing: ${p}`);}
  }

  // 3. WS endpoint
  console.log('\n─── WS endpoint discovery ───');
  const ep = await resolveWSEndpoint();
  if (!ep) {
    fail('WS-сервер не найден на 3001/3000/3002 (по /health/live + /ws/stats)');
    console.log('\n💡 Проверь:');
    console.log(
      '   1) WS-сервер запущен? `pnpm dev:ws` (или `pnpm tsx src/ws/server.ts`)',
    );
    console.log(
      '   2) Какой порт? `netstat -ano | findstr :3001` — если занят чужим процессом — освободи',
    );
    console.log(
      '   3) В .env: WS_PORT (по умолчанию 3001) и WS_URL (если пробрасываешь)',
    );
    console.log(
      '   4) `curl http://localhost:3001/health/live` — должен вернуть {"status":"ok","service":"ws"}',
    );
    summarize();
    return;
  }
  console.log(`   · ${ep.wsUrl}  (source: ${ep.source})`);

  // 4. Два WS-соединения
  console.log('\n─── WS connect: interviewer + candidate ───');
  const interviewer = await openWS(ep.wsUrl, TOKEN);
  const candidate = await openWS(ep.wsUrl, TOKEN);
  console.log(`   · interviewer connectionId: ${interviewer.connectionId}`);
  console.log(`   · candidate connectionId: ${candidate.connectionId}`);
  expectTrue(
    interviewer.connectionId !== candidate.connectionId,
    'разные connectionId',
  );
  expectTrue(
    typeof interviewer.welcome['role'] === 'string',
    'welcome содержит role',
  );

  // 5. Подписка
  console.log('\n─── subscribe interview:* ───');
  const interviewId = randomUUID();
  const channel = `interview:${interviewId}`;
  await subscribe(interviewer.ws, channel);
  await subscribe(candidate.ws, channel);
  ok(`оба подписаны на interview:${interviewId.slice(0, 8)}…`);

  // 6. Offer
  console.log('\n─── signaling: offer (interviewer → candidate) ───');
  {
    const received = nextEvent(candidate.ws, 'interview.offer');
    sendSignal(interviewer.ws, channel, 'offer', {
      type: 'offer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n',
    });
    const payload = (await received) as {
      interviewId?: string;
      fromConnectionId?: string;
      offer?: { sdp?: string };
    };
    expectEq(payload.interviewId, interviewId, 'offer.interviewId');
    expectEq(
      payload.fromConnectionId,
      interviewer.connectionId,
      'offer.fromConnectionId = interviewer',
    );
    expectTrue(
      typeof payload.offer?.sdp === 'string',
      'offer.sdp — строка',
    );
  }

  // 7. Echo
  console.log('\n─── signaling: echo (own offer в тот же канал) ───');
  {
    const received = nextEvent(interviewer.ws, 'interview.offer');
    sendSignal(interviewer.ws, channel, 'offer', {
      type: 'offer',
      sdp: 'echo',
    });
    const payload = (await received) as { fromConnectionId?: string };
    expectEq(
      payload.fromConnectionId,
      interviewer.connectionId,
      'эхо: fromConnectionId = interviewer (broadcast)',
    );
  }

  // 8. Answer
  console.log('\n─── signaling: answer (candidate → interviewer) ───');
  {
    const received = nextEvent(interviewer.ws, 'interview.answer');
    sendSignal(candidate.ws, channel, 'answer', {
      type: 'answer',
      sdp: 'v=0...',
    });
    const payload = (await received) as {
      fromConnectionId?: string;
    };
    expectEq(
      payload.fromConnectionId,
      candidate.connectionId,
      'answer.fromConnectionId = candidate',
    );
  }

  // 9. ICE
  console.log('\n─── signaling: ice_candidate (candidate → interviewer) ───');
  {
    const received = nextEvent(interviewer.ws, 'interview.ice_candidate');
    sendSignal(candidate.ws, channel, 'ice_candidate', {
      candidate:
        'candidate:1 1 UDP 2122260223 192.168.1.1 50000 typ host',
      sdpMLineIndex: 0,
    });
    const payload = (await received) as {
      fromConnectionId?: string;
    };
    expectEq(
      payload.fromConnectionId,
      candidate.connectionId,
      'ice.fromConnectionId = candidate',
    );
  }

  // 10. Error paths
  console.log('\n─── signaling: error paths ───');
  {
    const received = nextEvent(interviewer.ws, 'error');
    sendSignal(interviewer.ws, 'bad:channel', 'offer', {});
    const payload = (await received) as { code?: string };
    expectEq(payload.code, 'BAD_CHANNEL', 'bad:channel → BAD_CHANNEL');
  }
  {
    const otherChannel = `interview:${randomUUID()}`;
    const received = nextEvent(interviewer.ws, 'error');
    sendSignal(interviewer.ws, otherChannel, 'offer', {});
    const payload = (await received) as { code?: string };
    expectEq(
      payload.code,
      'NOT_SUBSCRIBED',
      'не подписан → NOT_SUBSCRIBED',
    );
  }
  {
    const received = nextEvent(interviewer.ws, 'error');
    sendSignal(interviewer.ws, channel, 'unknown_xyz', {});
    const payload = (await received) as { code?: string };
    expectEq(payload.code, 'BAD_EVENT', 'unknown_xyz → BAD_EVENT');
  }

  // 11. Cleanup
  interviewer.ws.close(1000, 'test done');
  candidate.ws.close(1000, 'test done');
  ok('WS-соединения закрыты');

  console.log('\n✅ Полный цикл WS signaling замкнут');
  console.log(
    'ℹ️  UI-проверки (TaskCard / VideoCall) выполняются вручную в браузере:',
  );
  console.log('   • /tasks и /council/daily-plan → TaskCard');
  console.log('   • /interview/<id> → WaitingRoom → модалка VideoCall');
  console.log(
    '   • 2 профиля (interviewer + candidate) → handshake, remote stream',
  );
  console.log('   • Record → upload в S3');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) {console.error(e.stack);}
    console.error(
      '\n⚠ Если 404 на /ws — проверь что на этом порту именно WS-сервер:',
    );
    console.error(
      '   curl http://localhost:3001/health/live  → {"status":"ok","service":"ws"}',
    );
    console.error(
      '   curl http://localhost:3001/ws/stats     → {"activeConnections":N,...}',
    );
  })
  .finally(() => {
    summarize();
    setTimeout(
      () => globalThis.process.exit(globalThis.process.exitCode ?? 0),
      100,
    );
  });