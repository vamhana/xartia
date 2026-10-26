// scripts/test-panels.ts
// Продуктовые панели: у каждой роли и направления — своя панель,
// у Архитектора/Совета/Балансировки — виджеты казны и надзора.
//
// Запуск: pnpm tsx scripts/test-panels.ts <phone> <password>

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

interface RenderPayload {
  panel: { id: string; name: string } | null;
  widgets: Array<{ entity?: string }>;
  widgetData: Record<string, unknown>;
  missingEntities: string[];
  failedEntities: string[];
}

interface RenderResponse {
  data: RenderPayload;
}

async function main(): Promise<void> {
  console.log('▶ Продуктовые панели\n');

  const login = await call<{ access_token: string }>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;

  const render = await call<RenderResponse>('GET', '/panels/me/render?context=normal', undefined, token);
  if (render.status !== 200) { fail(`render → ${render.status}`); return; }

  const payload = render.data.data;
  const name = payload.panel?.name ?? '';
  if (name.includes('FIRST_ARCHITECT')) {
    ok(`Архитектор получает свою панель: «${name}»`);
  } else {
    fail(`Архитектор получил панель «${name}» вместо ролевой`);
  }

  const entities = Object.keys(payload.widgetData ?? {});
  for (const e of ['treasury_price', 'treasury_coverage', 'signatories', 'spend_requests', 'oversight']) {
    if (entities.includes(e)) { ok(`виджет «${e}» отдаёт данные`); }
    else { fail(`виджета «${e}» нет в widgetData`); }
  }

  if ((payload.missingEntities ?? []).length === 0) {
    ok('нет виджетов без loader’а');
  } else {
    fail(`нет loader’а для: ${payload.missingEntities.join(', ')}`);
  }

  // У каждой активной роли — панель минимум с 3 виджетами.
  const roles = await query<{ name: string; c: string }>(
    `SELECT r.name, COUNT(pw.*)::text AS c
       FROM roles r
       JOIN panels p ON p.role_id = r.id AND p.active = true
       LEFT JOIN panel_widgets pw ON pw.panel_id = p.id
      GROUP BY r.name
      ORDER BY r.name`,
  );
  const thin = roles.filter((r) => parseInt(r.c, 10) < 3);
  if (thin.length === 0) { ok(`у всех ${roles.length} ролей панель ≥ 3 виджетов`); }
  else { fail(`тонкие панели: ${thin.map((r) => `${r.name} (${r.c})`).join(', ')}`); }

  // Направления 1..17 — у каждого есть панель.
  const dirs = await query<{ number: number; c: string }>(
    `SELECT d.number, COUNT(p.id)::text AS c
       FROM directions d
       LEFT JOIN panels p ON p.direction_id = d.id AND p.active = true AND p.role_id IS NULL
      WHERE d.status = 'active'
      GROUP BY d.number ORDER BY d.number`,
  );
  const noPanel = dirs.filter((d) => d.c === '0');
  if (noPanel.length === 0) { ok(`у всех ${dirs.length} направлений есть панель`); }
  else { fail(`без панели: ${noPanel.map((d) => d.number).join(', ')}`); }

  // Шлюз: сделки и активы.
  const gw = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM panels p
       JOIN directions d ON d.id = p.direction_id
       JOIN panel_widgets pw ON pw.panel_id = p.id
       JOIN widgets w ON w.id = pw.widget_id
      WHERE d.number = 15 AND w.entity IN ('transactions', 'assets')`,
  );
  if (parseInt(gw[0]?.c ?? '0', 10) >= 2) { ok('панель Шлюза содержит сделки и активы'); }
  else { fail('панель Шлюза без сделок/активов'); }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
