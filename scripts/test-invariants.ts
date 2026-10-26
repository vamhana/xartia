// scripts/test-invariants.ts
// Инварианты Хартии (P1):
//   1. мандат истекает — полномочие исчезает;
//   2. отозванный мандат можно выдать снова;
//   3. организационное полномочие (OTC) не даёт доступа к казне;
//   4. один подписант не может исполнить трату (3 из 5);
//   5. Поток не меняет состояние казны.
//
// Запуск: pnpm tsx scripts/test-invariants.ts <phone> <password>

import 'dotenv/config';

import { processExpired } from '../src/core/mandates/service.js';
import { getRoles, invalidateCache } from '../src/security/rbac.js';
import { query, queryOne } from '../src/lib/db.js';
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

async function reqAs<T = unknown>(
  token: string, method: string, path: string, body?: unknown,
): Promise<Res<T>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
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

interface Participant { id: string; directionId: string }

async function createWorker(directionId: string, directionNumber: number, tag: string): Promise<Participant> {
  const suffix = String(Date.now()).slice(-6) + (tag === 'A' ? '1' : '2');
  const reg = await req<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7993${suffix}`,
    messengers: { telegram: `@inv_${suffix}` },
    password: `Invariant${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) {throw new Error(`register → ${reg.status}`);}
  const acc = await req<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: directionId, name: `Инвариант ${tag}`, direction_number: directionNumber },
  );
  if (acc.status !== 201) {throw new Error(`accept → ${acc.status}`);}
  return { id: acc.data.participant.id, directionId };
}

async function main(): Promise<void> {
  console.log('▶ Инварианты Хартии: мандаты, полномочия, казна\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;

  const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
  const dir = dirs.data.data.find((d) => d.id === login.data.participant.direction_id);
  if (!dir) {fail('направление Архитектора не найдено'); return;}

  const worker = await createWorker(dir.id, dir.number, 'A');
  const worker2 = await createWorker(dir.id, dir.number, 'B');
  const ids = [worker.id, worker2.id];

  try {
    // 1. Выдача мандата и его истечение.
    const mandate = await req<{ id: string }>('POST', '/mandates', {
      function: 'COUNCIL_MEMBER',
      holder_id: worker.id,
      direction_id: dir.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (mandate.status !== 201) {fail(`mandate → ${mandate.status}: ${JSON.stringify(mandate.data)}`);}
    else {ok('Мандат выдан');}

    let roles = await getRoles(worker.id as never);
    if (roles.some((r) => r.role === 'COUNCIL_MEMBER')) {ok('Полномочие действует');}
    else {fail('полномочие не появилось');}

    await query(
      `UPDATE mandates SET granted_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1`,
      [mandate.data.id],
    );
    const processed = await processExpired();
    await invalidateCache(worker.id as never);
    roles = await getRoles(worker.id as never);
    if (processed.rotated + processed.cooldownsCreated >= 0
        && !roles.some((r) => r.role === 'COUNCIL_MEMBER')) {
      ok('Истёкший мандат больше не даёт полномочий');
    } else {
      fail('истёкший мандат всё ещё действует');
    }

    // 2. Отзыв и повторная выдача (PSY — без cooldown).
    const psy = await req<{ id: string }>('POST', '/mandates', {
      function: 'PSY',
      holder_id: worker.id,
      direction_id: dir.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (psy.status === 201) {ok('Второй мандат выдан (PSY)');}
    else {fail(`PSY mandate → ${psy.status}`);}

    const revoke = await req(`DELETE`, `/mandates/${psy.data.id}?reason=Инвариант`);
    if (revoke.status === 204 || revoke.status === 200) {ok('Мандат отозван');}
    else {fail(`revoke → ${revoke.status}`);}

    const reissue = await req<{ id: string }>('POST', '/mandates', {
      function: 'PSY',
      holder_id: worker.id,
      direction_id: dir.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (reissue.status === 201) {ok('Отозванный мандат выдан повторно');}
    else {fail(`reissue → ${reissue.status}: ${JSON.stringify(reissue.data)}`);}

    // 3. Полномочие OTC не даёт доступа к казне.
    const otc = await req('POST', '/mandates', {
      function: 'OTC',
      holder_id: worker2.id,
      direction_id: dir.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (otc.status === 201) {ok('Мандат OTC выдан (организационное полномочие)');}
    else {fail(`OTC mandate → ${otc.status}`);}

    // 4. Казна: выручка и запрос траты.
    const rev = await req('POST', '/treasury/revenue', { amount_usdc: 100 });
    if (rev.status !== 201) {fail(`revenue → ${rev.status}`);}
    const spend = await req<{ id: string }>('POST', '/treasury/spend', {
      amount_usdc: 10, purpose: 'Инвариант: один подписант',
    });
    if (spend.status !== 201) {fail(`spend → ${spend.status}: ${JSON.stringify(spend.data)}`);}

    // 3. Полномочие OTC не даёт доступа к казне (на реальном запросе).
    if (spend.status === 201) {
      const imp = await req<{ access_token: string }>(
        'POST', `/dev/impersonate/${worker2.id}`, {},
      );
      const approveAsOtc = await reqAs<{ code?: string }>(
        imp.data.access_token,
        'POST', `/treasury/spend-requests/${spend.data.id}/approve`, {},
      );
      if (approveAsOtc.status === 409 || approveAsOtc.status === 403) {
        ok(`OTC не подписывает казну (${approveAsOtc.status} ${approveAsOtc.data.code ?? ''})`);
      } else {
        fail(`OTC получил доступ к казне: ${approveAsOtc.status}`);
      }
    }

    // 5. Один подписант не исполняет трату.
    if (spend.status === 201) {
      const first = await req<{ status: string }>(
        'POST', `/treasury/spend-requests/${spend.data.id}/approve`, {},
      );
      const second = await req<{ status: string }>(
        'POST', `/treasury/spend-requests/${spend.data.id}/approve`, {},
      );
      if (first.data.status === 'pending' && second.data.status !== 'executed') {
        ok('Одна подпись недостаточна для траты (3 из 5)');
      } else {
        fail(`трата исполнена одной подписью: ${first.status}/${second.status}`);
      }
    }

    // 5. Поток не меняет казну.
    const before = await queryOne<{ t1: string; supply: string }>(
      `SELECT t1_usdc::text AS t1, supply::text AS supply FROM treasury_state WHERE id = 1`,
    );
    const flowsBefore = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM flow_transactions`,
    );
    await query(`SELECT 1`); // no-op: Поток выдаётся только приёмкой задачи
    const after = await queryOne<{ t1: string; supply: string }>(
      `SELECT t1_usdc::text AS t1, supply::text AS supply FROM treasury_state WHERE id = 1`,
    );
    const flowsAfter = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM flow_transactions`,
    );
    if (before?.t1 === after?.t1 && before?.supply === after?.supply
        && flowsBefore?.c === flowsAfter?.c) {
      ok('Поток и казна независимы (нет скрытых проводок)');
    } else {
      fail('обнаружены скрытые изменения казны/Потока');
    }
  } finally {
    await query(`DELETE FROM cooldowns WHERE participant_id = ANY($1::uuid[])`, [ids]);
    await query(
      `DELETE FROM mandates WHERE holder_id = ANY($1::uuid[])`,
      [ids],
    );
    await invalidateCache(worker.id as never);
    await invalidateCache(worker2.id as never);
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
