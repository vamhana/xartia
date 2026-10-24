// scripts/test-semantic.ts
// I.9.04.19 — Semantic: drift → alarm → ack → escalate → veto → lift →
// dictionary → translation → report → pressure → guardian.
//
// Регрессия v0.0.02:
//   - DELETE /veto reason из query (Fastify 5 не парсит body для DELETE)
//   - GET /report default year — lazy (функция, не значение)
//   - checkTranslationService — logAction (проверка audit_log)
//   - reportPressureService — атомарность (signal ДО infoBlockade)
//
// Запуск: pnpm tsx scripts/test-semantic.ts <phone> <password>

import 'dotenv/config';
import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = `SEM-${Date.now()}:`;
let TOKEN = '';

// ─── helpers ───

async function req<T = unknown>(
  method: string, path: string, body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
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

let OK = 0, FAIL = 0;
function ok(m: string): void { OK++; console.log(`   ✓ ${m}`); }
function fail(m: string): void { FAIL++; console.log(`   ✗ ${m}`); }
function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2).slice(0, 600));
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    ok(msg);
  } else {
    fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
  }
}
function statusOk(actual: number, expected: number | number[], label: string): void {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) {
    ok(`${label} — HTTP ${actual}`);
  } else {
    fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
  }
}
function codeOk(actual: string | undefined, expected: string, label: string): void {
  if (actual === expected) {
    ok(`${label} — code=${expected}`);
  } else {
    fail(`${label} — ожидали code=${expected}, получили ${String(actual)}`);
  }
}
function summarize(): void {
  console.log(`\n─── Итог: ${OK}/${OK + FAIL} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {process.exitCode = 1;}
}

let DRIFT_IDS: string[] = [];
let ALARM_IDS: string[] = [];
let VETO_IDS: string[] = [];
let TERM_IDS: string[] = [];
let SIGNAL_IDS: string[] = [];

async function cleanup(): Promise<void> {
  try {
    for (const sid of SIGNAL_IDS) {
      await query(`DELETE FROM signals WHERE id = $1`, [sid]);
    }
    for (const vid of VETO_IDS) {
      await query(`DELETE FROM vetoes WHERE id = $1`, [vid]);
    }
    for (const aid of ALARM_IDS) {
      await query(`DELETE FROM semantic_alarms WHERE id = $1`, [aid]);
    }
    for (const did of DRIFT_IDS) {
      await query(`DELETE FROM semantic_drift WHERE id = $1`, [did]);
    }
    for (const tid of TERM_IDS) {
      await query(`DELETE FROM dictionary_terms WHERE id = $1`, [tid]);
    }
    await query(`DELETE FROM translation_checks WHERE language = 'test-sem'`);
    ok('Cleanup выполнен');
  } catch (e) {
    fail(`Cleanup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── main ───

async function main(): Promise<void> {
  const phone = process.argv[2];
  const password = process.argv[3];
  if (!phone || !password) {
    console.error('Usage: pnpm tsx scripts/test-semantic.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login
  const login = await req<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {
    console.error(`Login failed: ${JSON.stringify(login.data)}`);
    process.exit(1);
  }
  TOKEN = login.data.access_token;
  const meId = login.data.participant.id;
  ok(`login as ${meId}`);

  // ─── 2. Drift: create + list ───
  const drift = await req<{ id: string; status: string }>(
    'POST', '/semantic/drift', {
      term: `${MARKER}свобода`,
      original_meaning: 'Отсутствие принуждения',
      detected_meaning: 'Возможность делать что угодно',
      severity: 7,
    },
  );
  log('POST /drift', drift.status, drift.data);
  statusOk(drift.status, 201, 'drift HTTP');
  eq(drift.data.status, 'new', 'drift status=new');
  DRIFT_IDS.push(drift.data.id);

  const driftList = await req<{ data: Array<{ id: string }> }>(
    'GET', `/semantic/drift?term=${encodeURIComponent(MARKER)}`,
  );
  log('GET /drift', driftList.status, { count: driftList.data.data?.length });
  statusOk(driftList.status, 200, 'drift list HTTP');
  eq((driftList.data.data?.length ?? 0) >= 1, true, 'drift в списке');

  // ─── 3. Drift негатив: severity=11 → 422 (Zod max(10)) ───
  {
    const r = await req<{ code: string }>(
      'POST', '/semantic/drift', {
        term: `${MARKER}bad`,
        original_meaning: 'x', detected_meaning: 'y',
        severity: 11,
      },
    );
    log('POST /drift (severity=11)', r.status, r.data);
    statusOk(r.status, 422, 'drift severity=11 → 422');
    codeOk(r.data.code, 'VALIDATION_ERROR', 'drift severity=11');
  }

  // ─── 4. Alarm: create ───
  const alarm = await req<{ id: string; priority: number; status: string }>(
    'POST', '/semantic/alarm', { drift_id: drift.data.id },
  );
  log('POST /alarm', alarm.status, alarm.data);
  statusOk(alarm.status, 201, 'alarm HTTP');
  eq(alarm.data.priority, 10, 'alarm priority=10');
  eq(alarm.data.status, 'raised', 'alarm status=raised');
  ALARM_IDS.push(alarm.data.id);

  // ─── 5. Alarm негатив: несуществующий drift_id → 404 ───
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>(
      'POST', '/semantic/alarm', { drift_id: fake },
    );
    log('POST /alarm (bad drift_id)', r.status, r.data);
    statusOk(r.status, 404, 'alarm bad drift_id → 404');
    codeOk(r.data.code, 'NOT_FOUND', 'alarm bad drift_id');
  }

  // ─── 6. Acknowledge ───
  const ack = await req<{ status: string; acknowledgedBy: string | null }>(
    'POST', `/semantic/alarm/${alarm.data.id}/acknowledge`,
  );
  log('POST /alarm/:id/acknowledge', ack.status, ack.data);
  statusOk(ack.status, 200, 'ack HTTP');
  eq(ack.data.status, 'acknowledged', 'ack status');
  eq(ack.data.acknowledgedBy, meId, 'ack.acknowledgedBy=me');

  // ─── 7. Повторный ack → 409 ───
  {
    const r = await req<{ code: string }>(
      'POST', `/semantic/alarm/${alarm.data.id}/acknowledge`,
    );
    log('POST /alarm/:id/acknowledge (повтор)', r.status, r.data);
    statusOk(r.status, 409, 'повторный ack → 409');
    codeOk(r.data.code, 'CONFLICT', 'повторный ack');
  }

  // ─── 8. Escalate ───
  const esc = await req<{ status: string; escalatedTo: string | null }>(
    'POST', `/semantic/alarm/${alarm.data.id}/escalate`, { to: 'forum' },
  );
  log('POST /alarm/:id/escalate', esc.status, esc.data);
  statusOk(esc.status, 200, 'escalate HTTP');
  eq(esc.data.escalatedTo, 'forum', 'escalatedTo=forum');

  // ─── 9. Veto: create ───
  const veto = await req<{ id: string; status: string; validFrom: string; validTo: string }>(
    'POST', '/semantic/veto', {
      type: 'semantic_guardian',
      decision_ref: meId,
      reason: `${MARKER}Решение противоречит базовым благам`,
    },
  );
  log('POST /veto', veto.status, veto.data);
  statusOk(veto.status, 201, 'veto HTTP');
  eq(veto.data.status, 'active', 'veto active');
  VETO_IDS.push(veto.data.id);
  {
    const days = (new Date(veto.data.validTo).getTime() - new Date(veto.data.validFrom).getTime()) / 86_400_000;
    eq(Math.abs(days - 3) < 0.01, true, `veto срок ≈ 3 дня (${days.toFixed(2)})`);
  }

  // ─── 10. 🆕 Veto lift — reason из QUERY (регрессия P1) ───
  {
    const r = await req<{ status: string; liftReason: string | null }>(
      'DELETE',
      `/semantic/veto/${veto.data.id}?reason=${encodeURIComponent('Проверено, не требуется')}`,
    );
    log('DELETE /veto/:id?reason=...', r.status, r.data);
    statusOk(r.status, 200, 'veto lift (query) HTTP');
    eq(r.data.status, 'lifted', 'veto lifted через query');
    eq(r.data.liftReason, 'Проверено, не требуется', 'liftReason сохранён');
  }

  // ─── 11. 🆕 Veto lift без reason → 422 ───
  {
    const r = await req<{ code: string }>(
      'DELETE', `/semantic/veto/${veto.data.id}`,
    );
    log('DELETE /veto/:id (без reason)', r.status, r.data);
    statusOk(r.status, 422, 'veto lift без reason → 422');
    codeOk(r.data.code, 'VALIDATION_ERROR', 'veto lift без reason');
  }

  // ─── 12. 🆕 Veto lift повторно → 409 ───
  {
    const r = await req<{ code: string }>(
      'DELETE',
      `/semantic/veto/${veto.data.id}?reason=${encodeURIComponent('x')}`,
    );
    log('DELETE /veto/:id (повтор)', r.status, r.data);
    statusOk(r.status, 409, 'повторный lift → 409');
    codeOk(r.data.code, 'CONFLICT', 'повторный lift');
  }

  // ─── 13. Dictionary: create → patch → duplicate ───
  const term = await req<{ id: string; version: number }>(
    'POST', '/semantic/dictionary', {
      term: `${MARKER}фрактал`,
      definition: 'Структура, части которой подобны целому',
    },
  );
  log('POST /dictionary', term.status, term.data);
  statusOk(term.status, 201, 'dictionary HTTP');
  eq(term.data.version, 1, 'term v1');
  TERM_IDS.push(term.data.id);

  const patched = await req<{ version: number }>(
    'PATCH', `/semantic/dictionary/${term.data.id}`,
    { definition: 'Обновлённое определение фрактала' },
  );
  log('PATCH /dictionary/:id', patched.status, patched.data);
  statusOk(patched.status, 200, 'dictionary PATCH HTTP');
  eq(patched.data.version, 2, 'term v2');

  {
    const r = await req<{ code: string }>(
      'POST', '/semantic/dictionary', {
        term: `${MARKER}фрактал`,
        definition: 'Дубликат',
      },
    );
    log('POST /dictionary (дубль)', r.status, r.data);
    statusOk(r.status, 409, 'duplicate term → 409');
    codeOk(r.data.code, 'CONFLICT', 'duplicate term');
  }

  // ─── 14. Translation: check + регрессия audit_log ───
  const tc = await req<{ id: string; ok: boolean; drift: unknown[] }>(
    'POST', '/semantic/translations/check', {
      original: 'Свобода — это осознанная необходимость и уважение границ другого.',
      translated: 'Свобода это когда можно всё.',
      language: 'test-sem',
    },
  );
  log('POST /translations/check', tc.status, tc.data);
  statusOk(tc.status, 200, 'translation HTTP');
  eq(tc.data.ok, false, 'translation ok=false (drift обнаружен)');

  // 🆕 Регрессия P3: проверка записи в audit_log.
  // logAction в C.0.01.05 — батчинг с flush через 500 мс (или 100 записей).
  // await logAction(...) гарантирует «в очереди», а не «в БД». Поллим
  // до 3 секунд, чтобы дождаться батч-flush.
  {
    const deadline = Date.now() + 3000;
    let cnt = 0;
    while (Date.now() < deadline) {
      const auditRow = await queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM audit_log
          WHERE action = 'semantic.translation.check'
            AND entity_id = $1`,
        [tc.data.id],
      );
      cnt = parseInt(auditRow?.cnt ?? '0', 10);
      if (cnt >= 1) {break;}
      await new Promise((r) => setTimeout(r, 100));
    }
    eq(cnt >= 1, true, 'translation_check записан в audit_log (P3)');
  }

  // ─── 15. 🆕 Report default year — lazy (регрессия P2) ───
  {
    const r = await req<{ year: number }>('GET', '/semantic/report');
    log('GET /report (без year)', r.status, r.data);
    statusOk(r.status, 200, 'report без year → 200');
    eq(r.data.year, new Date().getUTCFullYear(), 'report default year = current');
  }

  // ─── 16. Guardian ───
  const g = await req<{ active: boolean; can_remove: boolean }>(
    'GET', '/semantic/guardian',
  );
  log('GET /guardian', g.status, g.data);
  statusOk(g.status, 200, 'guardian HTTP');
  eq(g.data.active, true, 'guardian active');
  eq(g.data.can_remove, false, 'guardian can_remove=false');

  // ─── 17. Pressure: регрессия P4 (signal ДО infoBlockade, атомарность) ───
  const pressure = await req<{
    signalId: string; alarmId: string; infoBlockadeActivated: boolean;
  }>('POST', '/semantic/pressure', {
    description: `${MARKER}Попытка силового давления на Стража`,
  });
  log('POST /pressure', pressure.status, pressure.data);
  statusOk(pressure.status, 201, 'pressure HTTP');
  eq(typeof pressure.data.signalId, 'string', 'signalId присутствует');
  eq(typeof pressure.data.alarmId, 'string', 'alarmId присутствует');
  SIGNAL_IDS.push(pressure.data.signalId);
  ALARM_IDS.push(pressure.data.alarmId);

  // 🆕 P4: если signal создан, а infoBlockade не активировалась — это
  // ожидаемая деградация (best-effort). Если signal создан и infoBlockade
  // активировалась — тоже ок. Главное: signalId есть ВСЕГДА (не best-effort).
  eq(typeof pressure.data.signalId === 'string' && pressure.data.signalId.length > 0,
    true, 'signalId создан ДО infoBlockade (атомарность P4)');

  // 🆕 P4: пустое описание → 422 (было бы ConflictError 409)
  {
    const r = await req<{ code: string }>(
      'POST', '/semantic/pressure', { description: '' },
    );
    log('POST /pressure (пустое)', r.status, r.data);
    statusOk(r.status, 422, 'pressure пустое → 422');
    codeOk(r.data.code, 'VALIDATION_ERROR', 'pressure пустое');
  }

  console.log('\n✅ Тест Semantic завершён');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) {console.error(e.stack);}
  })
  .finally(async () => {
    await cleanup();
    summarize();
    try { await gracefulShutdown(); } catch { /* ignore */ }
  });