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

interface WsEvent { event: string; payload: unknown; }

const received: WsEvent[] = [];

function waitFor(
  socket: WebSocket,
  predicate: (e: WsEvent) => boolean,
  timeoutMs = 8000,
): Promise<WsEvent> {
  return new Promise((resolve, reject) => {
    // Сообщения могли прийти до вызова waitFor — проверяем буфер.
    const buffered = received.find(predicate);
    if (buffered) {
      received.splice(received.indexOf(buffered), 1);
      resolve(buffered);
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
  socket.addEventListener('message', (ev) => {
    try {
      received.push(JSON.parse(String(ev.data)) as WsEvent);
    } catch { /* ignore */ }
  });
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
      ok(`событие доставлено: ${ev.event}`);
    } catch {
      fail('task.assigned не дошёл за 8с');
    }
  }

  socket.close();
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
