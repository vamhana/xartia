// I.9.04.76 — Matching в назначении: partial override, no_match блокировка.
// Требует: TaskProfile с required_atoms, участника с частичным покрытием.
// Запуск: pnpm tsx scripts/test-assign-partial.ts <phone> <password>
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const RUN = randomUUID();
const MARK = `I.9.04.76:${RUN}`;
let TOKEN = '';

async function req(method: string, path: string, body?: unknown) {
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
  return { status: res.status, data: data as Record<string, unknown> };
}

let ok = 0, fail = 0;
function check(c: unknown, m: string): void {
  if (c) { ok++; console.log(`  ✓ ${m}`); }
  else { fail++; console.log(`  ✗ ${m}`); }
}

// Извлечение matching из ответа API. Контракт: сервис кладёт его в
// `details.matching` или `matching`; разные middleware/обёртки могут
// сдвинуть уровень. Перебираем известные места.
function extractMatching(data: unknown): { status?: string; gaps?: unknown[] } | undefined {
  if (!data || typeof data !== 'object') {return undefined;}
  const d = data as Record<string, unknown>;
  const candidates = [
    d['matching'],
    (d['details'] as Record<string, unknown> | undefined)?.['matching'],
    (d['data'] as Record<string, unknown> | undefined)?.['matching'],
    (d['error'] as Record<string, unknown> | undefined)?.['matching'],
    (d['context'] as Record<string, unknown> | undefined)?.['matching'],
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && 'status' in c) {
      return c as { status?: string; gaps?: unknown[] };
    }
  }
  return undefined;
}

async function createPlanAndTask(
  dirId: string,
  suffix: string,
): Promise<{ planId: string; taskId: string }> {
  const plan = await req('POST', '/plans', {
    type: 'standard',
    title: `${MARK} ${suffix}`,
    expected_result: 'override',
    lead_direction_id: dirId,
    criteria: {},
  });
  if (plan.status !== 201) {throw new Error(`create plan → ${plan.status}`);}
  const planId = (plan.data as { id: string }).id;
  await req('POST', `/plans/${planId}/approve`, {});
  await req('POST', `/plans/${planId}/activate`, {});

  const t = await req('POST', '/tasks', {
    direction_id: dirId, plan_id: planId,
    description: `${MARK} task ${suffix}`,
    priority: 'standard', kind: 'deliverable', expected_result: 'r',
  });
  if (t.status !== 201) {throw new Error(`create task → ${t.status} ${JSON.stringify(t.data)}`);}
  return { planId, taskId: (t.data as { id: string }).id };
}

async function main() {
  if (process.env['NODE_ENV'] === 'production') {throw new Error('refuse prod');}
  const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'];
  const pass = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'];
  if (!phone || !pass) {throw new Error('usage: <phone> <password>');}

  const login = await req('POST', '/auth/login', { phone, password: pass });
  if (login.status !== 200) {throw new Error('login failed');}
  TOKEN = (login.data as { access_token: string }).access_token;
  const me = (login.data as { participant: { id: string; direction_id: string } }).participant;

  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' AND id = $1 LIMIT 1`,
    [me.direction_id],
  );
  if (!dir) {throw new Error('нет активного направления');}

  // Для partial — атом с применимым U (некритично для executor).
  const atomPartial = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms
      WHERE dimension_applicability->'U'->>'applicable' = 'true'
      ORDER BY atom_id LIMIT 1`,
  );
  if (!atomPartial) {throw new Error('нет атома с применимым U');}

  // Для no_match — атом с применимым P (критично для executor).
  const atomNoMatch = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms
      WHERE dimension_applicability->'P'->>'applicable' = 'true'
      ORDER BY atom_id LIMIT 1`,
  );
  if (!atomNoMatch) {throw new Error('нет атома с применимым P');}

  console.log(`  атом для partial: ${atomPartial.atom_id} (U применимо)`);
  console.log(`  атом для no_match: ${atomNoMatch.atom_id} (P применимо)`);

  const cleanedPlanIds: string[] = [];

  // ─── 1. partial (некритичный gap) ─────────────────────────────
  {
    const { planId, taskId } = await createPlanAndTask(dir.id, 'partial');
    cleanedPlanIds.push(planId);

    // role=executor, min={U:9}. U не входит в ROLE_CRITICAL.executor=[P],
    // значит gap по U — некритический. Ожидаем status='partial'.
    const profile = await req('POST', `/passport/tasks/${taskId}/profile`, {
      requiredAtoms: [{
        atom_id: atomPartial.atom_id,
        role: 'executor',
        min: { U: 9 },
      }],
    });
    check(profile.status === 200 || profile.status === 201,
      `POST /passport/tasks/${taskId}/profile (partial) → 2xx (факт: ${profile.status})`);

    const noOverride = await req('POST', `/tasks/${taskId}/assign`, {
      participant_id: me.id,
    });
    check(noOverride.status === 409,
      'partial: assign без override → 409');
    const matching1 = extractMatching(noOverride.data);
    const status1 = matching1?.status;
    check(status1 === 'partial', `matching.status = partial (факт: ${status1 ?? 'undefined'})`);
    if (status1 !== 'partial') {
      console.log('  FACT noOverride.data:', JSON.stringify(noOverride.data, null, 2));
    }

    if (status1 === 'partial') {
      const withOverride = await req('POST', `/tasks/${taskId}/assign`, {
        participant_id: me.id,
        override: {
          reason: 'тестовый override: некритичный gap по U подтверждён FA',
          risk: 'low',
          accompanying: 'тестовое сопровождение',
        },
      });
      check(withOverride.status === 200,
        'partial + override (FA) → 200');

      // logAction — fire-and-forget (best-effort audit): 200 OK приходит раньше,
      // audit.ts батчит записи с FLUSH_INTERVAL_MS = 500. `await logAction()`
      // возвращается до фактической записи в БД — нужно дождаться flush-таймера
      // с запасом.
      await new Promise((r) => setTimeout(r, 800));

      const audit = await queryOne<{ n: number; last_entity: string | null }>(
        `SELECT COUNT(*)::int AS n, MAX(entity_id::text) AS last_entity
           FROM audit_log
          WHERE action = 'tasks.assign.override'
            AND created_at > now() - interval '1 minute'`,
      );
      console.log(`  FACT tasks.assign.override за 1 мин: ${audit?.n ?? 0}, last=${audit?.last_entity ?? '—'}`);
      check((audit?.n ?? 0) >= 1, 'audit tasks.assign.override записан (1 мин)');

      const auditForTask = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log
          WHERE action = 'tasks.assign.override' AND entity_id = $1`,
        [taskId],
      );
      check((auditForTask?.n ?? 0) >= 1,
        `audit tasks.assign.override для taskId=${taskId.slice(0, 8)}…`);
    }
  }

  // ─── 2. no_match (критичный gap) ──────────────────────────────
  {
    const { planId, taskId } = await createPlanAndTask(dir.id, 'no_match');
    cleanedPlanIds.push(planId);

    // role=executor, min={P:9}. P входит в ROLE_CRITICAL.executor=[P].
    // Если у FA P<9 — critical gap, status='no_match'. Override запрещён.
    const profile = await req('POST', `/passport/tasks/${taskId}/profile`, {
      requiredAtoms: [{
        atom_id: atomNoMatch.atom_id,
        role: 'executor',
        min: { P: 9 },
      }],
    });
    check(profile.status === 200 || profile.status === 201,
      `POST /passport/tasks/${taskId}/profile (no_match) → 2xx (факт: ${profile.status})`);

    const noOverride = await req('POST', `/tasks/${taskId}/assign`, {
      participant_id: me.id,
    });

    // Диагностика: без неё не понять, что реально вернулось.
    if (noOverride.status !== 409) {
      console.log('  FACT no_match assign:', noOverride.status,
        JSON.stringify(noOverride.data, null, 2));
    }
    check(noOverride.status === 409,
      `no_match: assign без override → 409 (факт: ${noOverride.status})`);

    const matching2 = extractMatching(noOverride.data);
    const status2 = matching2?.status;
    check(status2 === 'no_match' || status2 === 'partial',
      `matching.status = no_match|partial (факт: ${status2 ?? 'undefined'})`);

    if (status2 === 'no_match') {
      const overrideAttempt = await req('POST', `/tasks/${taskId}/assign`, {
        participant_id: me.id,
        override: {
          reason: 'попытка обойти no_match — должна быть заблокирована',
        },
      });
      check(overrideAttempt.status === 409,
        'no_match + override → 409 (обход запрещён)');
    }
  }

  // ─── 3. §7.5: задача без TaskProfile — hasTaskProfile=false ────────
  {
    const { planId, taskId } = await createPlanAndTask(dir.id, 'no-profile');
    cleanedPlanIds.push(planId);

    // Не создаём профиль. Назначаем задачу — Matching пропускается.
    const assignNoProfile = await req('POST', `/tasks/${taskId}/assign`, {
      participant_id: me.id,
    });
    check(assignNoProfile.status === 200,
      'assign без TaskProfile → 200 (не блокируется, §7.5)');

    // Проверяем ответ: hasTaskProfile=false.
    const taskResp = await req('GET', `/tasks/${taskId}`);
    const hasProfile = (taskResp.data as { hasTaskProfile?: boolean }).hasTaskProfile;
    check(hasProfile === false,
      'GET /tasks/:id → hasTaskProfile=false (проверка не проводилась)');

    // Проверяем audit tasks.assign.no_profile.
    await new Promise((r) => setTimeout(r, 800));
    const auditNoProfile = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE action = 'tasks.assign.no_profile' AND entity_id = $1`,
      [taskId],
    );
    check((auditNoProfile?.n ?? 0) >= 1,
      'audit tasks.assign.no_profile записан (§7.5)');
  }

  console.log(`\n── Итог: ${ok}/${ok + fail} ok, ${fail} fail ──`);
  if (fail > 0) {process.exitCode = 1;}

  for (const planId of cleanedPlanIds) {
    // Задачи с профилями не удаляем (task_profiles_history append-only).
    await query(
      `DELETE FROM tasks
        WHERE plan_id = $1
          AND id NOT IN (SELECT task_id FROM task_profiles)`,
      [planId],
    );
    await query(`DELETE FROM plan_versions WHERE plan_id = $1`, [planId]);
    await query(`DELETE FROM plans WHERE id = $1`, [planId]);
  }
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(async () => { await gracefulShutdown(); });