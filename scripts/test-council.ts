// scripts/test-council.ts
// Совет направления: избрание самого опытного, ротация, дисквалификация,
// фолбэк на Архитектора.
//
// Запуск: pnpm tsx scripts/test-council.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

interface CouncilState {
  member: { participantId: string; name: string; score: number } | null;
  termEndsAt: string | null;
  fallback: { participantId: string; name: string } | null;
}

async function main(): Promise<void> {
  console.log('▶ Совет направления: выборы, ротация, дисквалификация\n');

  const login = await call<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  const suffix = String(Date.now()).slice(-5);

  // Свежий участник: он будет единственным с принятой работой.
  const reg = await call<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7996${suffix}1`,
    messengers: { telegram: `@council_${suffix}` },
    password: `CouncilTest${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) { fail(`register → ${reg.status}`); return; }
  const accepted = await call<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `Советник ${suffix}`, direction_number: 9 },
    token,
  );
  if (accepted.status !== 201) { fail(`accept → ${accepted.status}`); return; }
  const memberId = accepted.data.participant.id;

  // Принятая работа в направлении = опыт (1 Поток).
  const task = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: `Опыт советника ${suffix}`, priority: 'standard' },
    token,
  );
  if (task.status !== 201) { fail(`task → ${task.status}`); return; }
  await call('POST', `/tasks/${task.data.id}/assign`, { participant_id: memberId }, token);
  await query(`UPDATE tasks SET status = 'accepted' WHERE id = $1`, [task.data.id]);

  const elect = await call<CouncilState>('POST', `/council/${dir.id}/elect`, {}, token);
  if (elect.status === 200 && elect.data.member && elect.data.member.score >= 1) {
    ok(`избран самый опытный: ${elect.data.member.name} (работ: ${elect.data.member.score})`);
  } else {
    fail(`elect → ${elect.status}: ${JSON.stringify(elect.data)}`);
  }
  // Избран может быть не наш новый участник: в направлении уже есть люди
  // с принятыми работами. Дальше работаем с фактически избранным.
  const electedId = elect.data.member?.participantId ?? '';
  if (elect.data.termEndsAt) {
    const days = Math.round(
      (new Date(elect.data.termEndsAt).getTime() - Date.now()) / (24 * 3600 * 1000),
    );
    if (days >= 178 && days <= 181) { ok(`срок мандата 180 дней (${days})`); }
    else { fail(`срок мандата ${days} дней, ожидали 180`); }
  } else {
    fail('срок мандата не установлен');
  }

  const history = await call<{
    elections: Array<{ participantId: string; score: number }>;
    disqualifications: Array<{ participantId: string; reason: string }>;
  }>('GET', `/council/${dir.id}/history`, undefined, token);
  if (history.status === 200 && history.data.elections.some((e) => e.participantId === electedId)) {
    ok('история выборов пишется');
  } else {
    fail(`history → ${history.status}: ${JSON.stringify(history.data)}`);
  }

  const state = await call<CouncilState>('GET', `/council/${dir.id}`, undefined, token);
  if (state.data.member?.participantId === electedId) { ok('состояние Совета читается'); }
  else { fail('состояние Совета не совпадает'); }

  // Авто-ротация: мандат истёк → система переизбирает без ручного действия.
  // Делаем это до дисквалификации, пока роль избранного ещё активна.
  await query(
    `UPDATE participant_roles pr
        SET valid_to = now() - interval '1 day'
       FROM roles r
      WHERE pr.role_id = r.id AND r.name = 'COUNCIL_MEMBER'
        AND pr.direction_id = $1 AND pr.status = 'active'`,
    [dir.id],
  );
  const beforeRotate = await call<{ elections: Array<{ electedAt: string }> }>(
    'GET', `/council/${dir.id}/history`, undefined, token,
  );
  const latestBefore = beforeRotate.data.elections[0]?.electedAt ?? '';
  const rotate = await call<{ rotated: Array<{ directionId: string }>; checked: number }>(
    'POST', '/council/rotate-expired', {}, token,
  );
  if (rotate.status === 200 && rotate.data.checked >= 1) {
    ok(`авто-ротация сработала (проверено ${rotate.data.checked})`);
  } else {
    fail(`rotate-expired → ${rotate.status}: ${JSON.stringify(rotate.data)}`);
  }
  const afterRotate = await call<{
    elections: Array<{ participantId: string; electedAt: string }>;
  }>('GET', `/council/${dir.id}/history`, undefined, token);
  // История ограничена 50 записями, поэтому сравниваем время, а не длину.
  if ((afterRotate.data.elections[0]?.electedAt ?? '') > latestBefore) {
    ok('ротация записана в историю');
  } else {
    fail('ротация не попала в историю');
  }

  // После ротации роль у нового советника; берём его для дисквалификации.
  const stateAfter = await call<CouncilState>('GET', `/council/${dir.id}`, undefined, token);
  const currentId = stateAfter.data.member?.participantId ?? electedId;

  const disq = await call<CouncilState>(
    'POST', `/council/${dir.id}/disqualify/${currentId}`,
    { reason: 'Тест: дисквалификация' },
    token,
  );
  if (disq.status === 200 && disq.data.member === null) { ok('дисквалификация сняла с роли'); }
  else { fail(`disqualify → ${disq.status}: ${JSON.stringify(disq.data)}`); }
  if (disq.data.fallback?.participantId) { ok(`функция у Архитектора: ${disq.data.fallback.name}`); }
  else { fail('фолбэк на Архитектора не вернулся'); }

  const history2 = await call<{
    disqualifications: Array<{ participantId: string; reason: string }>;
  }>('GET', `/council/${dir.id}/history`, undefined, token);
  if (history2.data.disqualifications.some(
    (d) => d.participantId === currentId && d.reason.includes('Тест'),
  )) {
    ok('дисквалификация попала в историю');
  } else {
    fail('дисквалификация не отражена в истории');
  }

  const reElect = await call<CouncilState>('POST', `/council/${dir.id}/elect`, {}, token);
  if (reElect.status === 200 && reElect.data.member?.participantId !== currentId) {
    if (reElect.data.member) {
      ok(`переизбран другой участник: ${reElect.data.member.name}`);
    } else {
      ok('кандидатов не осталось — Совет падает на Архитектора');
    }
  } else {
    fail(`re-elect → ${reElect.status}: ${JSON.stringify(reElect.data)}`);
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
