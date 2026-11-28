// Фаза 1 — read-only аудит исторических данных паспорта (§7.2 и §10 п.8 плана).
//
// Отвечает на вопрос «что уже лежит в БД до того, как мы включили gate и
// трёхзначную применимость»: сколько оценок и подтверждённых состояний
// держится на атомах и критериях, которые сейчас не утверждены; на измерениях,
// решение по которым не принято; какие оценки устарели; какие апелляции
// закрыты по неутверждённым атомам.
//
// ЧИТАЕТ ТОЛЬКО: всё выполняется в одной транзакции READ ONLY, поэтому любая
// попытка записи завершится ошибкой Postgres. Ничего не исправляет и не
// удаляет, исправление — отдельное решение владельца.
//
// Запуск:
//   pnpm tsx scripts/audit-passport-history.ts [--json] [--out audit.json]

import 'dotenv/config';
import { writeFileSync } from 'node:fs';

import { evaluateFreshness } from '../src/core/passport/freshness-policy.js';
import type { Dimension, DimensionApplicability, FreshnessPolicy } from '../src/core/passport/types.js';
import { getDimensionApplicabilityState } from '../src/core/passport/types.js';
import { transaction } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

interface Row { [k: string]: unknown }

interface Audit {
  generatedAt: string;
  atoms: Row[];
  assessmentsByAtomStatus: Row[];
  statesByAtomStatus: Row[];
  confirmedStatesByApplicability: Row[];
  activeAssessmentFreshness: Row[];
  criteriaVersionDrift: Row[];
  appealsResolved: Row[];
  calibrationSnapshot: Row[] | 'migration 074 not applied';
  xskCatalog: Row[] | 'migration 075 not applied';
  findings: Array<{ id: string; severity: 'info' | 'attention'; text: string }>;
}

const num = (v: unknown): number => Number(v ?? 0);
const isApproved = (atomStatus: unknown, criteriaStatus: unknown): boolean =>
  atomStatus === 'approved' && criteriaStatus === 'approved';

function printTable(title: string, rows: Row[] | string): void {
  console.log(`\n── ${title}`);
  if (typeof rows === 'string') {
    console.log(`   (${rows})`);
    return;
  }
  if (rows.length === 0) {
    console.log('   (нет данных)');
    return;
  }
  const cols = Object.keys(rows[0] as Row);
  const cell = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  console.log('   ' + cols.map((c, i) => c.padEnd(widths[i] as number)).join(' | '));
  console.log('   ' + widths.map((w) => '-'.repeat(w)).join('-+-'));
  for (const r of rows) {
    console.log('   ' + cols.map((c, i) => cell(r[c]).padEnd(widths[i] as number)).join(' | '));
  }
}

async function tableHasColumns(
  client: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }> },
  table: string,
  columns: string[],
): Promise<boolean> {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = $1 AND column_name = ANY($2::text[])`,
    [table, columns],
  );
  return num(r.rows[0]?.['n']) === columns.length;
}

async function runAudit(): Promise<Audit> {
  return transaction(async (client) => {
    // Должно быть первым оператором транзакции: дальше записать нельзя.
    await client.query('SET TRANSACTION READ ONLY');
    const q = async (sql: string, params: unknown[] = []): Promise<Row[]> =>
      (await client.query(sql, params)).rows as Row[];

    const atoms = await q(
      `SELECT status AS atom_status,
              COALESCE(assessment_criteria ->> 'status', '(нет)') AS criteria_status,
              count(*)::int AS atoms
         FROM competency_atoms GROUP BY 1, 2 ORDER BY 1, 2`,
    );

    const assessmentsByAtomStatus = await q(
      `SELECT a.status AS assessment_status, ca.status AS atom_status,
              COALESCE(ca.assessment_criteria ->> 'status', '(нет)') AS criteria_status,
              count(*)::int AS assessments,
              count(DISTINCT a.participant_id)::int AS participants,
              min(a.created_at) AS first_at, max(a.created_at) AS last_at
         FROM passport_assessments a
         JOIN competency_atoms ca ON ca.atom_id = a.atom_id
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    );

    const statesByAtomStatus = await q(
      `SELECT s.status AS state_status, ca.status AS atom_status,
              COALESCE(ca.assessment_criteria ->> 'status', '(нет)') AS criteria_status,
              count(*)::int AS states,
              count(DISTINCT s.participant_id)::int AS participants
         FROM person_atom_states s
         JOIN competency_atoms ca ON ca.atom_id = s.atom_id
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    );

    // Применимость считаем тем же читателем, что и код (не SQL-ом по JSON).
    const confirmed = await q(
      `SELECT s.dimension, ca.status AS atom_status, ca.dimension_applicability
         FROM person_atom_states s
         JOIN competency_atoms ca ON ca.atom_id = s.atom_id
        WHERE s.status = 'confirmed'`,
    );
    const byApplicability = new Map<string, number>();
    for (const r of confirmed) {
      const st = getDimensionApplicabilityState(
        r['dimension_applicability'] as DimensionApplicability | null,
        r['dimension'] as Dimension,
      );
      const key = `${String(r['atom_status'])}|${st}`;
      byApplicability.set(key, (byApplicability.get(key) ?? 0) + 1);
    }
    const confirmedStatesByApplicability = [...byApplicability.entries()].sort()
      .map(([k, n]) => {
        const [atom_status, applicability] = k.split('|');
        return { atom_status, dimension_applicability: applicability, confirmed_states: n };
      });

    // Свежесть активных оценок тем же движком, что и Matching.
    const active = await q(
      `SELECT a.created_at, ca.status AS atom_status, ca.freshness_policy
         FROM passport_assessments a
         JOIN competency_atoms ca ON ca.atom_id = a.atom_id
        WHERE a.status = 'active'`,
    );
    const now = new Date();
    const fresh = new Map<string, number>();
    for (const r of active) {
      const f = evaluateFreshness(r['freshness_policy'] as FreshnessPolicy | null, r['created_at'] as Date, now);
      const label = f.state === 'unverified' ? `unverified:${f.reason}` : f.state;
      const key = `${String(r['atom_status'])}|${label}`;
      fresh.set(key, (fresh.get(key) ?? 0) + 1);
    }
    const activeAssessmentFreshness = [...fresh.entries()].sort().map(([k, n]) => {
      const [atom_status, freshness] = k.split('|');
      return { atom_status, freshness, active_assessments: n };
    });

    const criteriaVersionDrift = await q(
      `SELECT ca.status AS atom_status,
              count(*)::int AS active_assessments,
              count(*) FILTER (WHERE a.criteria_version IS NULL)::int AS without_version,
              count(*) FILTER (WHERE a.criteria_version IS NOT NULL
                                 AND a.criteria_version IS DISTINCT FROM ca.version)::int AS version_differs
         FROM passport_assessments a
         JOIN competency_atoms ca ON ca.atom_id = a.atom_id
        WHERE a.status = 'active'
        GROUP BY 1 ORDER BY 1`,
    );

    const appealsResolved = await q(
      `SELECT COALESCE(e.payload ->> 'resolution', '(нет)') AS resolution,
              ca.status AS atom_status,
              count(*)::int AS appeals
         FROM passport_history_events e
         JOIN competency_atoms ca ON ca.atom_id = e.atom_id
        WHERE e.event_type = 'appeal_resolved'
        GROUP BY 1, 2 ORDER BY 1, 2`,
    );

    const snapCols = ['atom_version', 'atom_status', 'criteria_status'];
    const calibrationSnapshot: Audit['calibrationSnapshot'] =
      (await tableHasColumns(client, 'anchor_examples', snapCols))
        ? await q(
          `SELECT 'anchor_examples' AS material, count(*)::int AS total,
                  count(*) FILTER (WHERE atom_status IS NULL)::int AS without_snapshot,
                  count(*) FILTER (WHERE atom_status IS NOT NULL
                                     AND NOT (atom_status = 'approved' AND criteria_status = 'approved'))::int AS pilot
             FROM anchor_examples
           UNION ALL
           SELECT 'calibration_sessions', count(*)::int,
                  count(*) FILTER (WHERE atom_status IS NULL)::int,
                  count(*) FILTER (WHERE atom_status IS NOT NULL
                                     AND NOT (atom_status = 'approved' AND criteria_status = 'approved'))::int
             FROM calibration_sessions`,
        )
        : 'migration 074 not applied';

    const xskCatalog: Audit['xskCatalog'] =
      (await q(`SELECT to_regclass('xsk_catalog_versions') IS NOT NULL AS ok`))[0]?.['ok'] === true
        ? await q(`SELECT catalog_version, skills_count, domains_count, subdomains_count, imported_at
                     FROM xsk_catalog_versions ORDER BY imported_at`)
        : 'migration 075 not applied';

    // ── Выводы ─────────────────────────────────────────────────────────
    const findings: Audit['findings'] = [];
    const sum = (rows: Row[], pick: (r: Row) => boolean, field: string): number =>
      rows.filter(pick).reduce((s, r) => s + num(r[field]), 0);

    const confirmedOnNonApproved = sum(
      statesByAtomStatus,
      (r) => r['state_status'] === 'confirmed' && !isApproved(r['atom_status'], r['criteria_status']),
      'states',
    );
    findings.push({
      id: 'F1',
      severity: confirmedOnNonApproved > 0 ? 'attention' : 'info',
      text: `Подтверждённых (confirmed) состояний на атомах/критериях, которые сейчас не утверждены: ${confirmedOnNonApproved}. `
        + 'Production Matching их не учитывает (gate), но они лежат в БД.',
    });
    const activeOnNonApproved = sum(
      assessmentsByAtomStatus,
      (r) => r['assessment_status'] === 'active' && !isApproved(r['atom_status'], r['criteria_status']),
      'assessments',
    );
    findings.push({
      id: 'F2',
      severity: activeOnNonApproved > 0 ? 'attention' : 'info',
      text: `Активных оценок (active) на неутверждённых атомах/критериях: ${activeOnNonApproved}.`,
    });
    const notApplicableConfirmed = confirmedStatesByApplicability
      .filter((r) => r.dimension_applicability !== 'applicable')
      .reduce((s, r) => s + r.confirmed_states, 0);
    findings.push({
      id: 'F3',
      severity: notApplicableConfirmed > 0 ? 'attention' : 'info',
      text: `Подтверждённых состояний по измерениям, где применимость сейчас не applicable (undetermined или not_applicable): ${notApplicableConfirmed}.`,
    });
    const staleOnApproved = activeAssessmentFreshness
      .filter((r) => r.atom_status === 'approved' && r.freshness !== 'fresh')
      .reduce((s, r) => s + r.active_assessments, 0);
    findings.push({
      id: 'F4',
      severity: 'info',
      text: `Активных оценок на утверждённых атомах, которые не свежи (stale или unverified): ${staleOnApproved}. В Matching это некритичный gap (partial).`,
    });
    const appealsOnNonApproved = sum(
      appealsResolved,
      (r) => r['atom_status'] !== 'approved',
      'appeals',
    );
    findings.push({
      id: 'F5',
      severity: appealsOnNonApproved > 0 ? 'attention' : 'info',
      text: `Закрытых апелляций по атомам, которые сейчас не утверждены: ${appealsOnNonApproved}. `
        + 'Путь решения апелляции пока не перепроверяет gate (см. отчёт по фазе 1, п.6.1).',
    });
    const drift = criteriaVersionDrift.reduce((s, r) => s + num(r['version_differs']), 0);
    findings.push({
      id: 'F6',
      severity: 'info',
      text: `Активных оценок, у которых версия критериев отличается от текущей версии атома: ${drift}.`,
    });

    return {
      generatedAt: new Date().toISOString(),
      atoms,
      assessmentsByAtomStatus,
      statesByAtomStatus,
      confirmedStatesByApplicability,
      activeAssessmentFreshness,
      criteriaVersionDrift,
      appealsResolved,
      calibrationSnapshot,
      xskCatalog,
      findings,
    };
  });
}

async function main(): Promise<void> {
  const audit = await runAudit();
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1] as string, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  console.log(`Аудит исторических данных паспорта (read-only), ${audit.generatedAt}`);
  printTable('Атомы: статус атома × статус критериев', audit.atoms);
  printTable('Оценки: статус оценки × статус атома × статус критериев', audit.assessmentsByAtomStatus);
  printTable('Состояния участников: статус состояния × статус атома × статус критериев', audit.statesByAtomStatus);
  printTable('Подтверждённые состояния × применимость измерения (читателем кода)', audit.confirmedStatesByApplicability);
  printTable('Активные оценки: свежесть (движком Matching) × статус атома', audit.activeAssessmentFreshness);
  printTable('Активные оценки: версия критериев против версии атома', audit.criteriaVersionDrift);
  printTable('Решённые апелляции × текущий статус атома', audit.appealsResolved);
  printTable('Калибровка: снимок атома (миграция 074)', audit.calibrationSnapshot);
  printTable('Каталог XSK (миграция 075)', audit.xskCatalog);
  console.log('\n── Выводы');
  for (const f of audit.findings) {
    console.log(`   [${f.severity === 'attention' ? 'ВНИМАНИЕ' : 'инфо    '}] ${f.id}: ${f.text}`);
  }
  console.log('\nAUDIT COMPLETE (read-only, БД не изменена)');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await gracefulShutdown();
  });
