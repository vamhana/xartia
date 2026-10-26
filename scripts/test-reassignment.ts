// scripts/test-reassignment.ts
// Сигналы перестановки L0–L3: создать → эскалировать → решить/отклонить.
//
// Запуск: pnpm tsx scripts/test-reassignment.ts <phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? '+79001234567';
const password = process.argv[3] ?? 'ChangeMe123456';

let TOKEN = '';
interface Res<T> { status: number; data: T }

async function req<T = unknown>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

async function main(): Promise<void> {
  console.log('▶ Сигналы перестановки L0–L3\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;
  const dirId = login.data.participant.direction_id;

  const cell = await req<{ id: string }>('POST', '/cells', {
    level: 0,
    number: `R${String(Date.now()).slice(-5)}`,
    direction_id: dirId,
    profile: 'reassign-test',
  });
  if (cell.status !== 201) {fail(`cell → ${cell.status}`); return;}

  // 1. Создание сигнала уровня L0.
  const s0 = await req<{ id: string; level: number; status: string; directionId: string }>(
    'POST', '/reassignment-signals', {
      level: 0,
      reason: 'Ячейка не справляется: срыв срока более 15%',
      cell_id: cell.data.id,
    },
  );
  if (s0.status === 201 && s0.data.level === 0 && s0.data.status === 'open') {
    ok('Сигнал L0 создан (open)');
  } else {
    fail(`create → ${s0.status}: ${JSON.stringify(s0.data)}`);
    return;
  }
  if (s0.data.directionId === dirId) {ok('Направление подставлено из ячейки');}

  // 2. Эскалация L0 → L1 → L2 → L3.
  let last = s0.data;
  for (const expected of [1, 2, 3]) {
    const esc = await req<{ level: number; status: string }>(
      'POST', `/reassignment-signals/${s0.data.id}/escalate`, {},
    );
    last = esc.data as typeof last;
    if (esc.status === 200 && esc.data.level === expected && esc.data.status === 'escalated') {
      ok(`Эскалация до L${expected}`);
    } else {
      fail(`escalate → ${esc.status}: ${JSON.stringify(esc.data)}`);
    }
  }
  const top = await req('POST', `/reassignment-signals/${s0.data.id}/escalate`, {});
  if (top.status === 409) {ok('Выше L3 эскалации нет (409)');}
  else {fail(`escalate выше L3 → ${top.status}`);}

  // 3. Решение и запрет повторного.
  const resolved = await req<{ status: string; resolution: string }>(
    'POST', `/reassignment-signals/${s0.data.id}/resolve`,
    { resolution: 'Задача переставлена на другую группу' },
  );
  if (resolved.status === 200 && resolved.data.status === 'resolved') {
    ok('Сигнал решён (resolved)');
  } else {
    fail(`resolve → ${resolved.status}: ${JSON.stringify(resolved.data)}`);
  }
  const again = await req('POST', `/reassignment-signals/${s0.data.id}/resolve`, { resolution: 'Повтор' });
  if (again.status === 409) {ok('Повторное решение отклонено (409)');}
  else {fail(`repeat resolve → ${again.status}`);}

  // 4. Список с фильтром.
  const list = await req<{ data: Array<{ id: string; status: string }> }>(
    'GET', '/reassignment-signals?status=resolved',
  );
  if (list.status === 200 && list.data.data.some((s) => s.id === s0.data.id)) {
    ok('Сигнал виден в списке resolved');
  } else {
    fail(`list → ${list.status}: ${JSON.stringify(list.data)}`);
  }

  // 5. Отклонение и валидация.
  const s1 = await req<{ id: string }>('POST', '/reassignment-signals', {
    level: 2,
    reason: 'Совет направления: дефицит людей 70%',
  });
  const rejected = await req<{ status: string }>(
    'POST', `/reassignment-signals/${s1.data.id}/reject`, { reason: 'Ресурсы найдены' },
  );
  if (rejected.status === 200 && rejected.data.status === 'rejected') {ok('Сигнал отклонён');}
  else {fail(`reject → ${rejected.status}`);}

  const badLevel = await req('POST', '/reassignment-signals', {
    level: 4, reason: 'Некорректный уровень сигнала',
  });
  if (badLevel.status === 422 || badLevel.status === 400) {ok('Уровень 4 отклонён');}
  else {fail(`level 4 → ${badLevel.status}`);}

  const missingCell = await req('POST', '/reassignment-signals', {
    level: 1,
    reason: 'Несуществующая ячейка',
    cell_id: '00000000-0000-4000-8000-000000000000',
  });
  if (missingCell.status === 404) {ok('Несуществующая ячейка → 404');}
  else {fail(`missing cell → ${missingCell.status}`);}

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
