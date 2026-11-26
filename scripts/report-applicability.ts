// Фаза 1, этап 4b — отчёт (read-only): распределение состояний применимости
// измерений по статусам атомов. Показывает, сколько записей ещё в старом
// boolean-формате (`legacy`) и сколько уже в каноническом (`state`).
//
// Запуск: pnpm tsx scripts/report-applicability.ts

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

interface Row {
  atom_status: string;
  state: string;
  entries: number;
  atoms: number;
}

async function main(): Promise<void> {
  const rows = await query<Row>(
    `SELECT a.status AS atom_status,
            CASE
              WHEN jsonb_typeof(e.value) <> 'object'  THEN 'garbage'
              WHEN jsonb_exists(e.value, 'state')     THEN 'state:' || COALESCE(e.value ->> 'state', '?')
              WHEN jsonb_exists(e.value, 'applicable') THEN 'legacy'
              ELSE 'no-state'
            END AS state,
            count(*)::int AS entries,
            count(DISTINCT a.atom_id)::int AS atoms
       FROM competency_atoms a,
            LATERAL jsonb_each(a.dimension_applicability) AS e(key, value)
      WHERE jsonb_typeof(a.dimension_applicability) = 'object'
        AND e.key IN ('U', 'X', 'D', 'P', 'E')
      GROUP BY 1, 2
      ORDER BY 1, 2`,
  );
  const total = await query<{ n: number }>('SELECT count(*)::int AS n FROM competency_atoms');
  console.log(`atoms total: ${total[0]?.n ?? 0}`);
  console.log('atom_status | entry state            | entries | atoms');
  console.log('------------+------------------------+---------+------');
  for (const r of rows) {
    console.log(
      `${r.atom_status.padEnd(11)} | ${r.state.padEnd(22)} | ${String(r.entries).padStart(7)} | ${String(r.atoms).padStart(5)}`,
    );
  }
  const legacy = rows.filter((r) => r.state === 'legacy' || r.state === 'garbage')
    .reduce((s, r) => s + r.entries, 0);
  console.log(legacy === 0
    ? '\nOK: no legacy/garbage applicability entries left'
    : `\nWARN: ${legacy} legacy/garbage entries remain (migration 073 not applied?)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await gracefulShutdown();
  });
