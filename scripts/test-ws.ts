// scripts/test-ws.ts
// Полноценные W-модули: подключение, авторизация каналов, presence,
// доставка доменного события (task.assigned) и запрет чужого chat-канала.
//
// Запуск: pnpm tsx scripts/test-ws.ts <phone> <password>

import 'dotenv/config';

const API = process.env['API_URL'] ?? 'http://localhost:3000';
const WS = process.env['WS_URL'] ?? 'ws://localhost:3001/ws';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

async function call<T = unknown>(
  method: string, path: string, body?: unknown, token?: string,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (token) {headers['Authorization'] = `Bearer ${token}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${API}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

interface WsEvent { event: string; payload: unknown; ts?: number; channel?: string; }

/** Буфер событий на каждый сокет (у reconnect — свой). */
const buffers = new WeakMap<WebSocket, WsEvent[]>();

function waitFor(
  socket: WebSocket,
  predicate: (e: WsEvent) => boolean,
  timeoutMs = 8000,
): Promise<WsEvent> {
  return new Promise((resolve, reject) => {
    // Сообщения могли прийти до вызова waitFor — проверяем буфер сокета.
    const buf = buffers.get(socket) ?? [];
    const idx = buf.findIndex(predicate);
    if (idx >= 0) {
      const [buffered] = buf.splice(idx, 1);
      resolve(buffered!);
      return;
    }
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMsg);
      reject(new Error('timeout waiting for ws event'));
    }, timeoutMs);
    const onClose = (): void => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMsg);
      reject(new Error('socket closed before event'));
    };
    const onMsg = (ev: MessageEvent): void => {
      try {
        const parsed = JSON.parse(String(ev.data)) as WsEvent;
        if (predicate(parsed)) {
          clearTimeout(timer);
          socket.removeEventListener('message', onMsg);
          resolve(parsed);
        }
      } catch { /* ignore */ }
    };
    socket.addEventListener('message', onMsg);
    socket.addEventListener('close', onClose, { once: true });
  });
}

async function main(): Promise<void> {
  console.log('▶ W-модули: каналы, presence, события\n');

  const login = await call<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;
  const me = login.data.participant.id;

  const socket = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
  const pushEvent = (target: WebSocket, ev: MessageEvent): void => {
    const list = buffers.get(target) ?? [];
    try {
      list.push(JSON.parse(String(ev.data)) as WsEvent);
    } catch { /* ignore */ }
    buffers.set(target, list);
  };
  socket.addEventListener('message', (ev) => pushEvent(socket, ev));
  const connected = await waitFor(socket, (e) => e.event === 'connected');
  if ((connected.payload as { participantId?: string }).participantId === me) {
    ok('подключение авторизовано (participantId совпал)');
  } else {
    fail('connected без participantId');
  }

  // Подписка на глобальный канал задач.
  socket.send(JSON.stringify({ action: 'subscribe', channel: 'tasks', requestId: 'r1' }));
  await waitFor(socket, (e) => e.event === 'subscribed');
  ok('подписка на tasks подтверждена');

  const presence = await waitFor(socket, (e) => e.event === 'presence');
  const p = presence.payload as { participants?: string[]; count?: number };
  if (p.count && p.count >= 1 && p.participants?.includes(me)) {
    ok(`presence: ${p.count} участник(ов) в канале`);
  } else {
    fail(`presence некорректный: ${JSON.stringify(p)}`);
  }

  // Запрет чужого канала.
  socket.send(JSON.stringify({
    action: 'subscribe',
    channel: 'chat:00000000-0000-0000-0000-000000000000',
    requestId: 'r2',
  }));
  const denied = await waitFor(socket, (e) => e.event === 'error');
  const code = (denied.payload as { code?: string }).code;
  if (code === 'FORBIDDEN') { ok('чужой chat-канал запрещён (FORBIDDEN)'); }
  else { fail(`ожидали FORBIDDEN, получили ${code}`); }

  // Доменное событие: создаём и назначаем задачу — должен прийти task.assigned.
  let lastEventTs = 0;
  const task = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: (await call<{ data: Array<{ id: string; number: number }> }>(
      'GET', '/directions', undefined, token,
    )).data.data[0]?.id, description: `WS test ${Date.now()}`, priority: 'standard' },
    token,
  );
  if (task.status !== 201) { fail(`task → ${task.status}`); }
  else {
    const assigned = waitFor(socket, (e) => e.event === 'task.assigned');
    await call('POST', `/tasks/${task.data.id}/assign`, { participant_id: me }, token);
    try {
      const ev = await assigned;
      lastEventTs = ev.ts ?? 0;
      ok(`событие доставлено: ${ev.event}`);
    } catch {
      fail('task.assigned не дошёл за 8с');
    }
  }

  // Catch-up: после разрыва клиент присылает since и получает пропущенное.
  const lastTs = lastEventTs;
  socket.close();
  await new Promise((r) => setTimeout(r, 300));

  const socket2 = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
  socket2.addEventListener('message', (ev) => pushEvent(socket2, ev));
  await waitFor(socket2, (e) => e.event === 'connected');
  let catchupOk = false;
  for (let attempt = 1; attempt <= 3 && !catchupOk; attempt++) {
    socket2.send(JSON.stringify({
      action: 'subscribe',
      channel: 'tasks',
      requestId: `catchup-${attempt}`,
      since: Math.max(0, lastTs - 1),
    }));
    await waitFor(socket2, (e) => e.event === 'subscribed');
    try {
      const replayed = await waitFor(socket2, (e) => e.event === 'task.assigned', 4000);
      ok(`catch-up: пропущенное событие доставлено (${replayed.event})`);
      catchupOk = true;
    } catch {
      // повторяем: бэклог в Redis мог ещё не записаться
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!catchupOk) {fail('catch-up не доставил пропущенное событие');}
  socket2.close();

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    // Ничего не держим: сокет закрыт, процесс завершится сам.
  });
