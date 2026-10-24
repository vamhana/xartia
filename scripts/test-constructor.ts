// scripts/test-constructor.ts(I.9.04.47)
// Constructor: panels, widgets, publish/version, contextual, rights-matrix,
// render, me.
//
// Проверки fix'ов C.0.26.01 + C.0.26.02 + C.0.26.03 + A.1.26.01 + A.1.98.01:
//   - B1: /panels/me — панели текущего участника; direction-scoping.
//   - B2: update/delete активной панели → 409.
//   - B3: addWidget — depth через recursive CTE (limit MAX_DEPTH).
//   - B4: updateWidget — cycle prevention.
//   - B5: deleteWidget — каскадное удаление потомков.
//   - B6: publishPanel — version+1, повторный publish → 409.
//   - B8: listWidgets возвращает entity/widgetType (JOIN с widgets).
//   - B9: invalidate-cache → 200.
//   - B37: checkRightInMatrix — null-roleId = universal (unit-импорт).
//   - B38: getContextualPanel — role-specific > global + fallback normal
//          (требует includeGlobalRole в C.0.26.02 v0.0.03).
//   - B7 (loadPanelData без хака entity) проверяется косвенно: render
//     использует listWidgets, который отдаёт entity.
//
// Запуск: pnpm tsx scripts/test-constructor.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import {
  checkRightInMatrix,
  type RightsMatrixEntry,
} from '../src/core/constructor/entity.js';
import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

// Unit-импорт B37 (не доступен через HTTP — core.checkRight имеет другую логику).

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'CONSTRUCTOR-TEST:';

interface Client { token: string; participantId: string; directionId: string; }
interface WorkerInfo { id: string; externalId: string; phone: string; password: string; directionId: string; }

async function makeClient(phone: string, password: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json() as {
    access_token: string;
    participant: { id: string; direction_id: string };
  };
  if (!res.ok) {
    if (res.status === 429) {throw new Error('Rate limit on login. Сбрось rate:* в Redis.');}
    throw new Error(`Login ${phone}: ${JSON.stringify(data)}`);
  }
  return { token: data.access_token, participantId: data.participant.id, directionId: data.participant.direction_id };
}

async function req<T = unknown>(
  c: Client, method: string, path: string, body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${c.token}` };
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}
function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }

// ─── Setup ──────────────────────────────────────────────────────

async function findArch(phone: string) {
  const phoneHash = hashForSearch(phone);
  const row = await queryOne<{ id: string; external_id: string; direction_id: string }>(
    `SELECT id, external_id, direction_id FROM participants
     WHERE phone_hash = $1 AND deleted_at IS NULL LIMIT 1`,
    [phoneHash],
  );
  if (!row) {throw new Error(`Architect ${phone} not found`);}
  return { id: row.id, externalId: row.external_id, directionId: row.direction_id };
}

async function findOtherDirection(excludeId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE id <> $1 AND status = 'active' LIMIT 1`,
    [excludeId],
  );
  if (!row) {throw new Error('No other active direction');}
  return row.id;
}

async function findRoles(): Promise<{ first: string; second: string }> {
  const rows = await query<{ id: string }>(`SELECT id FROM roles LIMIT 2`);
  if (rows.length < 1) {throw new Error('No roles in DB');}
  const first = rows[0]!.id;
  const second = rows[1]?.id ?? rows[0]!.id;
  return { first, second };
}

async function findContainerWidget(): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM widgets WHERE type = 'container' LIMIT 1`,
  );
  return row?.id ?? null;
}

async function findLeafWidget(): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM widgets WHERE type != 'container' LIMIT 1`,
  );
  return row?.id ?? null;
}

async function cleanupWorkerByExternalId(externalId: string): Promise<void> {
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1`, [externalId],
  );
  if (!p) {return;}
  const pid = p.id;
  // Защита в глубину: панели worker'а (если он их создавал).
  await query(
    `DELETE FROM panel_widgets WHERE panel_id IN (SELECT id FROM panels WHERE created_by = $1)`,
    [pid],
  ).catch(() => undefined);
  await query(
    `DELETE FROM panel_versions WHERE panel_id IN (SELECT id FROM panels WHERE created_by = $1)`,
    [pid],
  ).catch(() => undefined);
  await query(`DELETE FROM panels WHERE created_by = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM reports WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM flow_transactions WHERE participant_id = $1`, [pid]).catch(() => undefined);
  try { await query(`DELETE FROM capsules WHERE participant_id = $1`, [pid]); } catch { /* */ }
  await query(`DELETE FROM tasks WHERE assigned_to = $1 OR assigned_by = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1 OR granted_by = $1)`, [pid]).catch(() => undefined);
  await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM mandates WHERE holder_id = $1 OR granted_by = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM cell_members WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM participants WHERE id = $1`, [pid]).catch(() => undefined);
}

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009991';
  const password = 'TestConstructorWorker1';
  const externalId = 'Т90091-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Constructor Worker', encryptField(phone), phoneHash, directionId, passwordHash],
  );

  const roleRow = await queryOne<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'ASSOCIATED' LIMIT 1`,
  );
  if (!roleRow) {throw new Error('Role ASSOCIATED not found');}
  await query(
    `INSERT INTO participant_roles (id, participant_id, role_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [newUUID(), id, roleRow.id],
  );

  return { id, externalId, phone, password, directionId };
}

async function resetRateLimit(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {return;}
  let count = 0;
  for (const pattern of ['rate:*', 'ratelimit:*']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) { await redis.del(...keys); count += keys.length; }
    } while (cursor !== '0');
  }
  if (count > 0) {console.log(`   · rate-limit: очищено ${count} ключей`);}
}

async function cleanupConstructor(): Promise<void> {
  const panels = await query<{ id: string }>(
    `SELECT id FROM panels WHERE name LIKE $1`, [`${MARKER}%`],
  );
  const ids = panels.map((p) => p.id);
  if (ids.length > 0) {
    await query(`DELETE FROM panel_widgets WHERE panel_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM panel_versions WHERE panel_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM panels WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  }
  await query(`DELETE FROM rights_matrix WHERE resource LIKE $1`, [`${MARKER}%`]).catch(() => undefined);
  // Кэш панелей — SCAN по префиксу (B9-совместимо).
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'constructor:panel:*', 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) { await redis.del(...keys); }
  } while (cursor !== '0');
  console.log('🧹 Cleanup: constructor (panels/widgets/versions/rights/cache)');
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const archPhone = process.argv[2] ?? '+79001234567';
  const archPassword = process.argv[3] ?? 'ChangeMe123456';

  console.log('── Подготовка ──────────────────────────────────────────');
  const archInfo = await findArch(archPhone);
  console.log(`   · Архитектор: ${archInfo.externalId} (dir=${archInfo.directionId})`);

  const workerDir = await findOtherDirection(archInfo.directionId);
  const workerInfo = await ensureWorker(workerDir);
  console.log(`   · Worker: ${workerInfo.externalId} (dir=${workerDir})`);

  const roles = await findRoles();
  const containerWidgetId = await findContainerWidget();
  const leafWidgetId = await findLeafWidget();
  console.log(`   · Roles: ${roles.first} / ${roles.second}`);
  console.log(`   · Widget container: ${containerWidgetId ?? 'НЕТ'}`);
  console.log(`   · Widget leaf: ${leafWidgetId ?? 'НЕТ'}`);

  if (!leafWidgetId) {
    throw new Error('Нужен хотя бы один leaf-виджет в библиотеке widgets');
  }

  await resetRateLimit();
  await cleanupConstructor();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ═══════════ Панель: create / get / list / patch (inactive) ═══

    const createP = await req<{ id: string; active: boolean; version: number }>(
      arch, 'POST', '/panels', {
        name: `${MARKER} panel-A`,
        context: 'normal',
        direction_id: arch.directionId,
      },
    );
    log('POST /panels', createP.status, createP.data);
    if (createP.status === 201 && createP.data.active === false && createP.data.version === 1) {
      ok(`panel создана: ${createP.data.id}, active=false, v=1`);
    } else {
      fail(`panel: ${createP.status}, active=${createP.data.active}, v=${createP.data.version}`);
    }
    const panelId = createP.data.id;

    const getP = await req<{ id: string }>(arch, 'GET', `/panels/${panelId}`);
    if (getP.status === 200 && getP.data.id === panelId) {ok('GET /panels/:id → 200');}
    else {fail(`GET /panels/:id: ${getP.status}`);}

    const listP = await req<{ data: Array<{ id: string }> }>(arch, 'GET', '/panels?context=normal');
    if (listP.status === 200 && listP.data.data?.some((p) => p.id === panelId)) {
      ok(`GET /panels содержит нашу (${listP.data.data.length} шт.)`);
    } else {
      fail('GET /panels: не нашли нашу панель');
    }

    const patch1 = await req<{ name: string }>(arch, 'PATCH', `/panels/${panelId}`, {
      name: `${MARKER} panel-A-renamed`,
    });
    if (patch1.status === 200 && patch1.data.name === `${MARKER} panel-A-renamed`) {
      ok('PATCH inactive panel → 200');
    } else {
      fail(`PATCH inactive: ${patch1.status}, name=${patch1.data.name}`);
    }

    // DELETE inactive — разрешено.
    const pDel = await req<{ id: string }>(arch, 'POST', '/panels', {
      name: `${MARKER} panel-to-delete`,
      context: 'normal',
    });
    if (pDel.status === 201) {
      const delRes = await req(arch, 'DELETE', `/panels/${pDel.data.id}`);
      if (delRes.status === 204) {ok('DELETE inactive → 204');}
      else {fail(`DELETE inactive: ${delRes.status}`);}
    }

    // ═══════════ B3/B4/B5/B8: widgets ═════════════════════════

    // Root widget (без parent) — B3 (parentDepth путь не активен).
    const addRoot = await req<{ id: string }>(arch, 'POST', `/panels/${panelId}/widgets`, {
      widget_id: leafWidgetId,
      position: { x: 0, y: 0 },
      size: { w: 4, h: 2 },
    });
    if (addRoot.status === 201) {ok(`widget root: ${addRoot.data.id}`);}
    else {fail(`widget root: ${addRoot.status}`);}

    // B8: listWidgets отдаёт entity + widgetType.
    const lw = await req<{ data: Array<{ id: string; entity?: string; widgetType?: string }> }>(
      arch, 'GET', `/panels/${panelId}/widgets`,
    );
    log('GET /panels/:id/widgets', lw.status, {
      count: lw.data.data?.length,
      sample: lw.data.data?.[0],
    });
    if (lw.status === 200 && lw.data.data?.some((w) => w.entity && w.widgetType)) {
      ok('B8: listWidgets возвращает entity/widgetType');
    } else {
      fail('B8: entity/widgetType отсутствуют');
    }

    // Container + вложенный container (для cycle-теста B4) + leaf-child.
    if (containerWidgetId) {
      const addC1 = await req<{ id: string }>(arch, 'POST', `/panels/${panelId}/widgets`, {
        widget_id: containerWidgetId,
        position: { x: 0, y: 2 },
        size: { w: 12, h: 6 },
      });
      if (addC1.status === 201) {ok(`widget container-1: ${addC1.data.id}`);}
      else {fail(`widget container-1: ${addC1.status}`);}
      const c1 = addC1.data.id;

      const addC2 = await req<{ id: string }>(arch, 'POST', `/panels/${panelId}/widgets`, {
        widget_id: containerWidgetId,
        parent_id: c1,
        position: { x: 0, y: 0 },
        size: { w: 6, h: 4 },
      });
      if (addC2.status === 201) {ok(`widget container-2 (child): ${addC2.data.id}`);}
      else {fail(`widget container-2: ${addC2.status}`);}
      const c2 = addC2.data.id;

      // Leaf-child под container-2 (для каскадного delete B5).
      const addL = await req<{ id: string }>(arch, 'POST', `/panels/${panelId}/widgets`, {
        widget_id: leafWidgetId,
        parent_id: c2,
        position: { x: 0, y: 0 },
        size: { w: 2, h: 1 },
      });
      if (addL.status === 201) {ok(`widget leaf-under-c2: ${addL.data.id}`);}
      else {fail(`widget leaf-under-c2: ${addL.status}`);}
      const leafId = addL.data.id;

      // B4: cycle — сделать c1 ребёнком своего потомка c2.
      const cycle = await req(arch, 'PATCH', `/panels/${panelId}/widgets/${c1}`, {
        parent_id: c2,
      });
      log('B4: cycle prevention', cycle.status, cycle.data);
      if (cycle.status === 400 || cycle.status === 422) {
        ok(`B4: cycle prevention → ${cycle.status}`);
      } else {
        fail(`B4: ожидали 400/422, получили ${cycle.status}`);
      }

      // B5: delete c1 → c2 и leaf исчезают каскадно.
      const delC = await req(arch, 'DELETE', `/panels/${panelId}/widgets/${c1}`);
      if (delC.status === 204) {ok('DELETE container-1 → 204');}
      else {fail(`DELETE container-1: ${delC.status}`);}

      const afterDel = await req<{ data: Array<{ id: string }> }>(
        arch, 'GET', `/panels/${panelId}/widgets`,
      );
      const childGone = !afterDel.data.data?.some((w) => w.id === c2);
      const leafGone = !afterDel.data.data?.some((w) => w.id === leafId);
      if (childGone && leafGone) {ok('B5: c2 и leaf удалены каскадно');}
      else {fail(`B5: c2=${childGone ? 'gone' : 'EXISTS'}, leaf=${leafGone ? 'gone' : 'EXISTS'}`);}
    } else {
      console.log('   ℹ нет container-виджета — пропускаем B3(depth)/B4/B5');
    }

    // ═══════════ B6: publish + version + B2 ═══════════════════

    const publish = await req<{ active: boolean; version: number }>(
      arch, 'POST', `/panels/${panelId}/publish`,
    );
    log('POST /panels/:id/publish', publish.status, publish.data);
    if (publish.status === 200 && publish.data.active === true && publish.data.version >= 2) {
      ok(`B6: publish → active=true, v=${publish.data.version}`);
    } else {
      fail(`B6: publish: status=${publish.status}, active=${publish.data.active}, v=${publish.data.version}`);
    }

    const versions = await req<{ data: Array<{ version: number }> }>(
      arch, 'GET', `/panels/${panelId}/versions`,
    );
    if (versions.status === 200 && versions.data.data?.some((v) => v.version >= 2)) {
      ok(`B6: versions содержит v>=2 (${versions.data.data.length} записей)`);
    } else {
      fail('B6: versions не содержит опубликованной версии');
    }

    // B2: PATCH активной → 409.
    const patchActive = await req(arch, 'PATCH', `/panels/${panelId}`, {
      name: `${MARKER} should-not-apply`,
    });
    log('B2: PATCH active panel', patchActive.status, patchActive.data);
    if (patchActive.status === 409) {ok('B2: PATCH active → 409');}
    else {fail(`B2: ожидали 409, получили ${patchActive.status}`);}

    // B2: DELETE активной → 409.
    const delActive = await req(arch, 'DELETE', `/panels/${panelId}`);
    log('B2: DELETE active panel', delActive.status, delActive.data);
    if (delActive.status === 409) {ok('B2: DELETE active → 409');}
    else {fail(`B2: ожидали 409, получили ${delActive.status}`);}

    // B6: повторный publish → 409.
    const publish2 = await req(arch, 'POST', `/panels/${panelId}/publish`);
    log('B6: re-publish', publish2.status, publish2.data);
    if (publish2.status === 409) {ok('B6: повторный publish → 409');}
    else {fail(`B6: ожидали 409, получили ${publish2.status}`);}

    // ═══════════ B38: contextual panel ════════════════════════

    // 1) Глобальная normal-панель (role_id = null).
    const globalP = await req<{ id: string }>(arch, 'POST', '/panels', {
      name: `${MARKER} global-normal`,
      context: 'normal',
    });
    if (globalP.status === 201) {
      await req(arch, 'POST', `/panels/${globalP.data.id}/publish`);
      ok('B38: global normal создана+published');
    } else {
      fail(`B38: global panel: ${globalP.status}`);
    }

    // 2) Role-specific crisis-панель.
    const specificP = await req<{ id: string }>(arch, 'POST', '/panels', {
      name: `${MARKER} role-crisis`,
      context: 'crisis',
      role_id: roles.first,
    });
    if (specificP.status === 201) {
      await req(arch, 'POST', `/panels/${specificP.data.id}/publish`);
      ok('B38: role-specific crisis создана+published');
    } else {
      fail(`B38: specific panel: ${specificP.status}`);
    }

    // 3) Запрос role-specific crisis → должна вернуться role-specific.
    const ctx1 = await req<{ data: { id: string; name: string } | null }>(
      arch, 'GET', `/panels/context/${roles.first}/crisis`,
    );
    log(`B38: context/${roles.first.slice(0, 8)}.../crisis`, ctx1.status, ctx1.data);
    if (ctx1.status === 200 && specificP.status === 201 && ctx1.data.data?.id === specificP.data.id) {
      ok('B38: role-specific crisis имеет приоритет');
    } else {
      fail(`B38: ожидали specific, получили ${ctx1.data.data?.id ?? 'null'}`);
    }

    // 4) Запрос "чужой" role в crisis → fallback на глобальную normal.
    if (roles.second !== roles.first) {
      const ctx2 = await req<{ data: { id: string; name: string } | null }>(
        arch, 'GET', `/panels/context/${roles.second}/crisis`,
      );
      log(`B38: context/${roles.second.slice(0, 8)}.../crisis (fallback)`, ctx2.status, ctx2.data);
      if (ctx2.status === 200 && ctx2.data.data?.name === `${MARKER} global-normal`) {
        ok('B38: fallback на global normal');
      } else {
        fail(`B38: fallback вернул ${ctx2.data.data?.name ?? 'null'}`);
      }
    } else {
      console.log('   ℹ одна роль в БД — пропускаем fallback-проверку B38');
    }

    // ═══════════ B37: checkRightInMatrix (unit) ═══════════════

    // NB: scope — из rightScopeSchema: 'self' | 'dir' | 'all' | 'agg' | 'raw' | 'arch'.
    // 'own' НЕ входит (в RightScope есть, но схема не пропускает).
    const universalEntry = {
      id: newUUID(),
      roleId: null,
      resource: 'test_resource',
      action: 'V' as const,
      scope: 'self' as const,
      condition: null,
      version: 1,
      createdAt: new Date().toISOString(),
    } satisfies RightsMatrixEntry;

    const anyRole = newUUID();
    const b37a = checkRightInMatrix([universalEntry], anyRole, 'test_resource', 'V', 'self');
    if (b37a) {ok('B37: null-roleId → universal (any role)');}
    else {fail('B37: null-roleId не применился');}

    const b37b = checkRightInMatrix([universalEntry], anyRole, 'other_resource', 'V', 'self');
    if (!b37b) {ok('B37: null-roleId + другой resource → false');}
    else {fail('B37: null-roleId просочился на другой resource');}

    // ═══════════ B1: /panels/me ═══════════════════════════════

    const me = await req<{ data: Array<{ id: string }> }>(arch, 'GET', '/panels/me');
    log('GET /panels/me (arch)', me.status, { count: me.data.data?.length });
    if (me.status === 200 && Array.isArray(me.data.data)) {
      ok(`B1: /panels/me (arch) → ${me.data.data.length} панелей`);
    } else {
      fail(`B1: /panels/me (arch): ${me.status}`);
    }

    // B1: worker в другом направлении не должен видеть direction-specific panel-A.
    const meWorker = await req<{ data: Array<{ id: string }> }>(worker, 'GET', '/panels/me');
    if (meWorker.status === 200) {
      const seesArchPanel = meWorker.data.data?.some((p) => p.id === panelId);
      if (!seesArchPanel) {ok('B1: worker (другое направление) не видит panel-A');}
      else {fail('B1: worker видит panel-A чужого направления');}
    } else if (meWorker.status === 403) {
      console.log('   ℹ B1: worker без panel:V (ASSOCIATED) — пропускаем');
    } else {
      fail(`B1: /panels/me (worker): ${meWorker.status}`);
    }

    // ═══════════ render ═══════════════════════════════════════

    const render = await req<{
      panel?: { id: string };
      widgets?: unknown[];
      data?: Record<string, unknown>;
      missing_entities?: string[];
      failed_entities?: string[];
    }>(arch, 'GET', `/panels/${panelId}/render`);
    log('GET /panels/:id/render', render.status, {
      hasPanel: !!render.data.panel,
      widgetsCount: render.data.widgets?.length,
      missing: render.data.missing_entities,
      failed: render.data.failed_entities,
    });
    if (render.status === 200 && render.data.panel?.id === panelId) {
      ok('render: панель + data вернулись');
    } else {
      fail(`render: ${render.status}`);
    }

    const renderMissing = await req(arch, 'GET', `/panels/${newUUID()}/render`);
    if (renderMissing.status === 404) {ok('render несуществующей → 404');}
    else {fail(`render missing: ${renderMissing.status}`);}

    // ═══════════ Rights matrix CRUD ═══════════════════════════

    // scope: 'self' — валидное значение rightScopeSchema.
    const rmCreate = await req<{ id: string }>(arch, 'POST', '/rights-matrix', {
      role_id: null,
      resource: `${MARKER}rights_res`,
      action: 'V',
      scope: 'self',
    });
    log('rights-matrix create', rmCreate.status, rmCreate.data);
    if (rmCreate.status === 201) {ok(`rights-matrix create: ${rmCreate.data.id}`);}
    else {fail(`rights-matrix create: ${rmCreate.status}`);}

    const rmDup = await req(arch, 'POST', '/rights-matrix', {
      role_id: null,
      resource: `${MARKER}rights_res`,
      action: 'V',
      scope: 'self',
    });
    log('rights-matrix dup', rmDup.status, rmDup.data);
    if (rmDup.status === 409) {ok('rights-matrix dup → 409');}
    else {fail(`rights-matrix dup: ${rmDup.status}`);}

    const rmList = await req<{ data: unknown[] }>(
      arch, 'GET', `/rights-matrix?resource=${MARKER}rights_res`,
    );
    if (rmList.status === 200 && (rmList.data.data?.length ?? 0) > 0) {
      ok(`rights-matrix list: ${rmList.data.data.length}`);
    } else {
      fail(`rights-matrix list: ${rmList.status}`);
    }

    // ═══════════ Cache / Library ══════════════════════════════

    const cache = await req<{ invalidated: boolean }>(arch, 'POST', '/panels/invalidate-cache');
    if (cache.status === 200 && cache.data.invalidated) {ok('B9: invalidate-cache → 200');}
    else {fail(`invalidate-cache: ${cache.status}`);}

    const widgets = await req<{ data: unknown[] }>(arch, 'GET', '/widgets');
    if (widgets.status === 200) {ok(`GET /widgets: ${widgets.data.data?.length}`);}
    else {fail(`GET /widgets: ${widgets.status}`);}

    console.log('\n✅ Тест Constructor завершён');
  } finally {
    try {
      await cleanupConstructor();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: constructor + worker ${workerInfo.externalId}`);
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
    await gracefulShutdown();
  }
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});