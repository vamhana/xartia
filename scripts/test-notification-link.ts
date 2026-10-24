// scripts/test-notification-link.ts
// Smoke-тест «уведомление → переход к событию».
//
// Проверяет то, ради чего существует колокольчик: у события назначения задачи
// есть ссылка (data.link), по которой фронт открывает задачу, и отметка
// «прочитано» действительно сохраняется.
//
// Запуск: pnpm tsx scripts/test-notification-link.ts <phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  data?: { link?: string; taskId?: string };
  read: boolean;
}

function ok(msg: string): void {
  console.log(`   ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`   ✗ ${msg}`);
  process.exitCode = 1;
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (token) {headers['Authorization'] = `Bearer ${token}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

async function main(): Promise<void> {
  console.log('▶ Уведомление → переход к событию\n');

  const login = await call<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;
  const me = login.data.participant.id;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  // Назначение самому себе: достаточно, чтобы получить уведомление,
  // и не требует второго участника.
  const task = await call<{ id: string; externalId: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: 'Проверка уведомления со ссылкой', priority: 'standard' },
    token,
  );
  if (task.status !== 201) { fail(`create task → ${task.status}`); return; }

  const assigned = await call(
    'POST', `/tasks/${task.data.id}/assign`, { participant_id: me }, token,
  );
  if (assigned.status !== 200) { fail(`assign → ${assigned.status}`); return; }
  ok(`задача ${task.data.externalId} назначена`);

  const hist = await call<{ data: NotificationRecord[] }>(
    'GET', '/notifications/history?page=1&per_page=20', undefined, token,
  );
  const note = hist.data.data.find(
    (n) => n.type === 'task.assigned' && n.data?.taskId === task.data.id,
  );
  if (!note) { fail('уведомление о назначении не найдено'); return; }
  ok(`уведомление: «${note.title}»`);

  const link = note.data?.link;
  if (typeof link === 'string' && link.includes(`/tasks/${task.data.id}`)) {
    ok(`ссылка на событие: ${link}`);
  } else {
    fail(`ссылка отсутствует или неверна: ${String(link)}`);
  }

  if (note.read === false) { ok('уведомление непрочитанное'); }
  else { fail('новое уведомление сразу помечено прочитанным'); }

  const read = await call('PATCH', `/notifications/${note.id}/read`, undefined, token);
  if (read.status === 200 || read.status === 204) { ok(`прочитано (${read.status})`); }
  else { fail(`mark read → ${read.status}`); }

  const after = await call<{ data: NotificationRecord[] }>(
    'GET', '/notifications/history?page=1&per_page=20', undefined, token,
  );
  const same = after.data.data.find((n) => n.id === note.id);
  if (same?.read === true) { ok('статус прочтения сохранён'); }
  else { fail('статус прочтения не сохранился'); }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
