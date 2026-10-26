// scripts/test-treasury.ts
// Казна 5.0: пол 1.00, выручка 60/30/10, мультисиг 3-из-5, инвариант пола.
//
// Запуск: pnpm tsx scripts/test-treasury.ts <phone> <password>

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

interface State {
  t1Usdc: number;
  operatingUsdc: number;
  bufferUsdc: number;
  reserveUsdc: number;
  supply: number;
  price: number;
  coverage: number;
}

interface SpendRequest {
  id: string;
  status: string;
  approvals: Array<{ participantId: string }>;
}

async function main(): Promise<void> {
  console.log('▶ Казна 5.0: пол, выручка, мультисиг\n');

  const login = await call<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;
  const architectId = login.data.participant.id;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }
  const directionId = dir.id;

  // Смоук должен быть идемпотентным: чистим казну перед сценарием.
  await query('DELETE FROM treasury_approvals');
  await query(
    `DELETE FROM unit_transfers
      WHERE account_id IN (SELECT id FROM unit_accounts WHERE participant_id = $1)`,
    [architectId],
  );
  await query('UPDATE unit_accounts SET balance = 0 WHERE participant_id = $1', [architectId]);
  await query('DELETE FROM treasury_spend_requests');
  await query('DELETE FROM treasury_operations');
  await query(
    'UPDATE treasury_state SET t1_usdc=0, t2_usdc=0, operating_usdc=0, buffer_usdc=0, supply=0, updated_at=now() WHERE id=1',
  );

  const initial = await call<State>('GET', '/treasury/state', undefined, token);
  ok(`старт: supply ${initial.data.supply}, цена ${initial.data.price}`);

  const r1 = await call<State>(
    'POST', '/treasury/revenue', { amount_usdc: 1000, note: 'Тест: выручка Шлюза' }, token,
  );
  if (r1.status === 201 && Math.abs(r1.data.t1Usdc - 600) < 0.01
      && Math.abs(r1.data.supply - 600) < 0.01 && Math.abs(r1.data.price - 1) < 1e-9) {
    ok('выручка 1000: T1=600, supply=600, цена 1.00 (genesis)');
  } else {
    fail(`revenue #1 → ${r1.status}: ${JSON.stringify(r1.data)}`);
  }
  if (Math.abs(r1.data.operatingUsdc - 300) < 0.01 && Math.abs(r1.data.bufferUsdc - 100) < 0.01) {
    ok('сплит 60/30/10 соблюдён');
  } else {
    fail(`сплит неверный: ${JSON.stringify(r1.data)}`);
  }

  const r2 = await call<State>(
    'POST', '/treasury/revenue', { amount_usdc: 1000 }, token,
  );
  if (r2.status === 201 && Math.abs(r2.data.supply - 600) < 0.01
      && Math.abs(r2.data.price - 2) < 1e-9) {
    ok('вторая выручка: supply не вырос, цена 2.00 (NAV)');
  } else {
    fail(`revenue #2 → ${r2.status}: ${JSON.stringify(r2.data)}`);
  }

  // Два дополнительных подписанта: KEEPER в направлении.
  const approvers: string[] = [architectId];
  // Подписанты — реальные держатели мест казны (Совет/Верификация/Шлюз/Хранитель).
  const sigs = await call<{
    data: Array<{ holder: { participantId?: string } | null }>;
  }>('GET', '/treasury/signatories', undefined, token);
  const holderIds = sigs.data.data
    .map((seat) => seat.holder?.participantId)
    .filter((pid): pid is string => typeof pid === 'string' && pid.length > 0);
  const validHolders = holderIds.length > 0
    ? await query<{ participant_id: string }>(
        `SELECT DISTINCT pr.participant_id
           FROM participant_roles pr
           JOIN roles r ON r.id = pr.role_id
          WHERE pr.participant_id = ANY($1::uuid[])
            AND pr.status = 'active'
            AND (pr.valid_to IS NULL OR pr.valid_to > now())
            AND r.name IN ('FIRST_ARCHITECT','COUNCIL_MEMBER','KEEPER','VERIFIER','BALANCER')`,
        [holderIds],
      )
    : [];
  for (const row of validHolders) {
    if (!approvers.includes(row.participant_id) && approvers.length < 3) {
      approvers.push(row.participant_id);
    }
  }

  // На чистой базе местá подписантов могут быть вакантны — создаём Совет.
  let extra = 0;
  while (approvers.length < 3 && extra < 4) {
    extra += 1;
    const suffix = String(Date.now()).slice(-6) + extra;
    const reg = await call<{ request_id: string }>('POST', '/auth/register', {
      phone: `+7995${suffix}`,
      messengers: { telegram: `@signer_${suffix}` },
      password: `Signer${suffix}`,
      consent_video: true,
      consent_data: true,
    });
    if (reg.status !== 201) {break;}
    const acc = await call<{ participant: { id: string } }>(
      'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
      { direction_id: directionId, name: `Советник ${suffix}`, direction_number: 9 },
      token,
    );
    if (acc.status !== 201) {break;}
    const pid = acc.data.participant.id;
    await query(
      `INSERT INTO participant_roles
         (participant_id, role_id, direction_id, status, valid_from, granted_by)
       SELECT $1, r.id, r.direction_id, 'active', now(), $2
         FROM roles r
        WHERE r.name = 'COUNCIL_MEMBER'
        LIMIT 1`,
      [pid, architectId],
    );
    approvers.push(pid);
  }
  ok(`подписантов подготовлено: ${approvers.length}`);

  const spend = await call<SpendRequest>(
    'POST', '/treasury/spend', { amount_usdc: 100, purpose: 'Тест: серверы' }, token,
  );
  if (spend.status === 201 && spend.data.status === 'pending') {
    ok('запрос траты создан (pending)');
  } else {
    fail(`spend → ${spend.status}: ${JSON.stringify(spend.data)}`);
    return;
  }

  // Три разные подписи: архитектор + два KEEPER (через dev-impersonation).
  const signTokens: string[] = [token];
  for (const pid of approvers.slice(1)) {
    signTokens.push(await tokenFor(pid, approvers, token));
  }

  let last: SpendRequest | null = null;
  for (let i = 0; i < 2; i++) {
    const a = await call<SpendRequest>(
      'POST', `/treasury/spend-requests/${spend.data.id}/approve`, {}, signTokens[i],
    );
    last = a.data;
  }
  if (last?.status === 'pending') { ok('2 подписи: запрос ещё pending'); }
  else { fail(`ожидали pending после 2 подписей: ${JSON.stringify(last)}`); }

  const third = await call<SpendRequest>(
    'POST', `/treasury/spend-requests/${spend.data.id}/approve`, {}, signTokens[2],
  );
  if (third.status === 200 && third.data.status === 'executed') {
    ok('3-я подпись: трата исполнена');
  } else {
    fail(`approve #3 → ${third.status}: ${JSON.stringify(third.data)}`);
  }

  const after = await call<State>('GET', '/treasury/state', undefined, token);
  if (Math.abs(after.data.t1Usdc - (r2.data.t1Usdc - 100)) < 0.01) {
    ok('T1 уменьшился на сумму траты');
  } else {
    fail(`T1 после траты: ${after.data.t1Usdc}`);
  }
  if (after.data.t1Usdc + 1e-9 >= after.data.supply) {
    ok('инвариант пола держится');
  } else {
    fail('инвариант пола нарушен');
  }

  // Подписанты: 5 мест, вакантные замещает Архитектор.
  const signatories = await call<{ data: Array<{ seat: string; holder: unknown | null; fallbackToArchitect: boolean }> }>(
    'GET', '/treasury/signatories', undefined, token,
  );
  if (signatories.status === 200 && signatories.data.data.length === 5) {
    ok('5 мест подписантов, вакантные — фолбэк на Архитектора');
  } else {
    fail(`signatories → ${signatories.status}: ${JSON.stringify(signatories.data)}`);
  }

  // Привязка к Шлюзу: завершённая сделка автоматически попадает в казну.
  const tx = await call<{ id: string }>(
    'POST', '/gateway/transactions',
    { type: 'sale', description: 'Тест: продажа через Шлюз', amount_external: 500 },
    token,
  );
  if (tx.status !== 201) { fail(`gateway create → ${tx.status}: ${JSON.stringify(tx.data)}`); return; }
  await call('POST', `/gateway/transactions/${tx.data.id}/approve`, {}, token);
  const audited = await call('POST', `/gateway/transactions/${tx.data.id}/audit`, {}, token);
  if (audited.status !== 200) { fail(`gateway audit → ${audited.status}`); }

  const afterGateway = await call<State>('GET', '/treasury/state', undefined, token);
  if (Math.abs(afterGateway.data.t1Usdc - (after.data.t1Usdc + 300)) < 0.01) {
    ok('сделка Шлюза 500: +300 в T1 автоматически (60%)');
  } else {
    fail(`T1 после Шлюза: ${afterGateway.data.t1Usdc} (ожидали ${after.data.t1Usdc + 300})`);
  }

  const ops = await call<{ data: Array<{ gatewayTransactionId: string | null }> }>(
    'GET', '/treasury/operations', undefined, token,
  );
  if (ops.data.data.some((o) => o.gatewayTransactionId === tx.data.id)) {
    ok('операция казны привязана к сделке Шлюза');
  } else {
    fail('операция казны не привязана к сделке');
  }

  // Повторный аудит не должен задвоить выручку.
  await call('POST', `/gateway/transactions/${tx.data.id}/audit`, {}, token);
  const afterRetry = await call<State>('GET', '/treasury/state', undefined, token);
  if (Math.abs(afterRetry.data.t1Usdc - afterGateway.data.t1Usdc) < 0.01) {
    ok('повторный аудит не задваивает выручку');
  } else {
    fail('выручка задвоилась при повторном аудите');
  }

  // Покупка монеты внешним держателем: цена не меняется (R и S растут вместе).
  const beforeBuy = await call<State>('GET', '/treasury/state', undefined, token);
  const price = beforeBuy.data.price;
  const buy = await call<{ account: { balance: number }; state: State }>(
    'POST', '/treasury/buy', { amount_usdc: 100 }, token,
  );
  if (buy.status === 201
      && Math.abs(buy.data.account.balance - 100 / price) < 0.01
      && Math.abs(buy.data.state.price - price) < 0.01) {
    ok(`покупка 100 USDC: +${(100 / price).toFixed(2)} монет, курс не изменился`);
  } else {
    fail(`buy → ${buy.status}: ${JSON.stringify(buy.data)}`);
  }

  // Дар казне: монеты сжигаются, USDC уходит в операционный фонд (общие блага).
  const donateUnits = buy.data.account.balance / 2;
  const beforeDonate = await call<State>('GET', '/treasury/state', undefined, token);
  const donate = await call<{ account: { balance: number }; state: State }>(
    'POST', '/treasury/donate', { units: donateUnits, note: 'Тест: общие блага' }, token,
  );
  if (donate.status === 201
      && donate.data.account.balance < buy.data.account.balance - 1e-6
      && Math.abs(donate.data.state.operatingUsdc - (beforeDonate.data.operatingUsdc + donateUnits * price)) < 0.05) {
    ok('дар казне: монеты сожжены, эквивалент ушёл в операционный фонд');
  } else {
    fail(`donate → ${donate.status}: ${JSON.stringify(donate.data)}`);
  }
  if (donate.data.state.t1Usdc + 1e-6 >= donate.data.state.supply) {
    ok('после дара пол держится');
  } else {
    fail('после дара пол пробит');
  }

  console.log('\n✅ done');
}

/** В тесте подписанты без пароля: авторизуемся как архитектор, но сервис
 *  требует отдельного participant_id — используем dev-impersonation. */
async function tokenFor(pid: string, approvers: string[], architectToken: string): Promise<string> {
  if (pid === approvers[0]) {return architectToken;}
  const res = await fetch(`${BASE}/dev/impersonate/${pid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${architectToken}` },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? architectToken;
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
