// scripts/test-gateway-contour.ts
// Экономический контур Шлюза (P1):
//   права: создание ≠ одобрение ≠ аудит, внешний участник не получает доступ;
//   состояния: аудит только после одобрения, повторный аудит идемпотентен;
//   гонки: параллельное одобрение — ровно один успех;
//   казна: выручка начисляется один раз.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? '+79001234567';
const password = process.argv[3] ?? 'ChangeMe123456';

let TOKEN = '';
interface Res<T> { status: number; data: T }

async function req<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  const t = token ?? TOKEN;
  if (t) {headers['Authorization'] = `Bearer ${t}`;}
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
  console.log('▶ Шлюз: права, состояния, гонки, казна\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;

  const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
  const dir = dirs.data.data.find((d) => d.id === login.data.participant.direction_id);
  if (!dir) {fail('направление не найдено'); return;}

  // Внешний участник без прав Шлюза.
  const suffix = String(Date.now()).slice(-6);
  const reg = await req<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7992${suffix}`,
    messengers: { telegram: `@gw_${suffix}` },
    password: `Gateway${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) {fail(`register → ${reg.status}`); return;}
  const acc = await req<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `Внешний ${suffix}`, direction_number: dir.number },
  );
  if (acc.status !== 201) {fail(`accept → ${acc.status}`); return;}
  const outsider = acc.data.participant.id;

  const imp = await req<{ access_token: string }>('POST', `/dev/impersonate/${outsider}`, {});
  const outsiderToken = imp.data.access_token;

  // 1. Права: внешний не создаёт и не одобряет сделки.
  const outsiderCreate = await req('POST', '/gateway/transactions', {
    type: 'sale', description: 'Внешний: попытка', amount_external: 100,
  }, outsiderToken);
  if (outsiderCreate.status === 403) {ok('Внешний не создаёт сделки (403)');}
  else {fail(`внешний create → ${outsiderCreate.status}`);}

  const outsiderApprove = await req('POST', '/gateway/transactions/00000000-0000-4000-8000-000000000000/approve', {}, outsiderToken);
  if (outsiderApprove.status === 403) {ok('Внешний не одобряет сделки (403)');}
  else {fail(`внешний approve → ${outsiderApprove.status}`);}

  // 2. Валидация суммы.
  const negative = await req('POST', '/gateway/transactions', {
    type: 'sale', description: 'Отрицательная', amount_external: -5,
  });
  if (negative.status === 422 || negative.status === 400) {ok('Отрицательная сумма отклонена');}
  else {fail(`negative → ${negative.status}`);}

  // 3. Полный цикл: создание → одобрение → аудит.
  const before = await req<{ t1Usdc: number }>('GET', '/treasury/state');
  const created = await req<{ id: string; status: string }>('POST', '/gateway/transactions', {
    type: 'sale', description: `Контур ${suffix}`, amount_external: 250,
  });
  if (created.status === 201 && created.data.status === 'pending') {ok('Сделка создана (pending)');}
  else {fail(`create → ${created.status}`); return;}
  const txId = created.data.id;

  const auditBeforeApprove = await req('POST', `/gateway/transactions/${txId}/audit`, {});
  if (auditBeforeApprove.status === 409) {ok('Аудит до одобрения запрещён (409)');}
  else {fail(`audit до approve → ${auditBeforeApprove.status}`);}

  // 4. Гонка одобрения: ровно один успех.
  const [a1, a2] = await Promise.all([
    req('POST', `/gateway/transactions/${txId}/approve`, {}),
    req('POST', `/gateway/transactions/${txId}/approve`, {}),
  ]);
  const statuses = [a1.status, a2.status].sort();
  if (statuses[0] === 200 && statuses[1] === 409) {
    ok('Параллельное одобрение: один успех, один конфликт');
  } else {
    fail(`параллельные approve → ${statuses.join(',')}`);
  }

  // 5. Повторный аудит идемпотентен, выручка — один раз.
  const audit1 = await req<{ status: string }>('POST', `/gateway/transactions/${txId}/audit`, {});
  const audit2 = await req<{ status: string }>('POST', `/gateway/transactions/${txId}/audit`, {});
  if (audit1.status === 200 && audit1.data.status === 'completed') {
    ok('Аудит завершает сделку (completed)');
  } else {
    fail(`audit → ${audit1.status}: ${JSON.stringify(audit1.data)}`);
  }
  if (audit2.status === 200) {ok('Повторный аудит идемпотентен');}
  else {fail(`повторный audit → ${audit2.status}`);}

  const after = await req<{ t1Usdc: number }>('GET', '/treasury/state');
  const delta = Math.round((after.data.t1Usdc - before.data.t1Usdc) * 100) / 100;
  if (Math.abs(delta - 150) < 0.01) {ok('Казна получила 60% (150) ровно один раз');}
  else {fail(`T1 delta = ${delta}, ожидали 150`);}

  // 6. Аудит несуществующей сделки.
  const missing = await req('POST', '/gateway/transactions/00000000-0000-4000-8000-000000000000/audit', {});
  if (missing.status === 404) {ok('Аудит несуществующей сделки → 404');}
  else {fail(`audit missing → ${missing.status}`);}

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
