// I.9.09.04 — Идемпотентный сид профессионального паспорта.
//
// Запуск: pnpm tsx scripts/seed-passport.ts [--skip-pilots]
//
// Флаг --skip-pilots:
//   атомы, изменённые через workflow catalog_proposals, не откатываются
//   сидом к пилотной версии. Критерий «изменён через workflow»:
//     * version в БД > seed-версии (semver compare), или
//     * status ∈ {approved, deprecated}.
//   Такие атомы считаются unchanged и пропускаются.
//
// Идемпотентность:
//   * competency_atoms     — ON CONFLICT (atom_id) DO UPDATE, но только если
//                            version, status или freshness_policy изменились.
//                            Иначе no-op (проверка через IS DISTINCT FROM).
//   * competency_relations — ON CONFLICT (from,to,type) DO NOTHING.
//   * profession_profiles  — ON CONFLICT (slug) DO UPDATE, если version/status
//                            изменились.
//
// Не трогает:
//   * participant_competencies (053) — отдельный домен «ёмкость».
//   * passport_visibility / passport_access_log / development_paths /
//     passport_assessments / passport_evidence / passport_history_events /
//     person_atom_states — это пользовательские данные.
//
// Выход:
//   * атомов: 54
//   * связей: N (сколько в RELATION_SEEDS, дедуп по UNIQUE)
//   * профилей: 3
//   Печатает идемпотентный отчёт.

import 'dotenv/config';

import type { PoolClient } from 'pg';

import { queryOne, transaction } from '../src/lib/db.js';
import { logger } from '../src/lib/logger.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { ATOM_SEEDS, type AtomSeed } from './seed-data/atoms.js';
import { CLUSTER_RELATED_DIRECTIONS, HOME_DIRECTION_NUMBER, MAIN_DIRECTION_NUMBER } from './seed-data/direction_map.js';
import { DIRECTION_SEEDS } from './seed-data/directions.js';
import { RELATION_SEEDS } from './seed-data/relations.js';
import { PROFILE_SEEDS } from './seed-data/profiles.js';

interface UpsertCounts {
  atomsInserted: number;
  atomsUpdated: number;
  atomsUnchanged: number;
  relationsInserted: number;
  relationsSkipped: number;
  profilesInserted: number;
  profilesUpdated: number;
  profilesUnchanged: number;
  directionMapInserted: number;
  directionMapSkipped: number;
}

type AtomCounts = Pick<UpsertCounts, 'atomsInserted' | 'atomsUpdated' | 'atomsUnchanged'>;
type RelationCounts = Pick<UpsertCounts, 'relationsInserted' | 'relationsSkipped'>;
type ProfileCounts = Pick<UpsertCounts, 'profilesInserted' | 'profilesUpdated' | 'profilesUnchanged'>;
type DirectionMapCounts = Pick<UpsertCounts, 'directionMapInserted' | 'directionMapSkipped'>;

/**
 * Сравнение semver-строк формата 'X.Y.Z'. Возвращает:
 *   > 0 — a > b,  0 — равны,  < 0 — a < b.
 * Недостающие компоненты считаются нулями; нечисловые → 0.
 * Для '0.2.0' vs '0.1.0' → 1;  '0.2.0' vs '0.2.0' → 0;  '0.1' vs '0.1.0' → 0.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v.split('.').map((p) => parseInt(p, 10));
    const pad = (n: number): number => (Number.isFinite(n) && n >= 0 ? n : 0);
    return [pad(parts[0] ?? 0), pad(parts[1] ?? 0), pad(parts[2] ?? 0)];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

/**
 * Совпадает ли freshness_policy в строке БД с seed-значением.
 * Сверяем по полям, чтобы не зависеть от порядка ключей JSONB и от
 * лишних полей, которые могут появиться в БД.
 */
function sameFreshness(
  row: { freshness_policy?: unknown },
  seed: AtomSeed,
): boolean {
  const db = (row.freshness_policy ?? {}) as {
    content_change_rate?: string;
    practice_review_policy?: string;
  };
  const s = seed.freshness_policy;
  return (
    db.content_change_rate === s.content_change_rate
    && db.practice_review_policy === s.practice_review_policy
  );
}

async function upsertAtoms(
  client: PoolClient,
  seeds: AtomSeed[],
  skipPilots: boolean,
): Promise<AtomCounts> {
  let atomsInserted = 0;
  let atomsUpdated = 0;
  let atomsUnchanged = 0;

  for (const s of seeds) {
    const existing = await client.query<{
      version: string;
      status: string;
      freshness_policy: unknown;
    }>(
      `SELECT version, status, freshness_policy
         FROM competency_atoms WHERE atom_id = $1`,
      [s.atom_id],
    );
    const row = existing.rows[0];

    if (!row) {
      await client.query(
        `INSERT INTO competency_atoms
           (atom_id, cluster, name, definition,
            boundary_includes, boundary_excludes,
            context, input, outcome,
            assessment_criteria, assessment_methods,
            dimension_applicability, freshness_policy,
            translations, status, version)
         VALUES ($1,$2,$3,$4,
                 $5::jsonb,$6::jsonb,
                 $7,$8,$9,
                 $10::jsonb,$11::jsonb,
                 $12::jsonb,$13::jsonb,
                 '{}'::jsonb,$14,$15)`,
        [
          s.atom_id,
          s.cluster,
          s.name,
          s.definition,
          JSON.stringify(s.boundary_includes),
          JSON.stringify(s.boundary_excludes),
          s.context,
          s.input,
          s.outcome,
          JSON.stringify(s.assessment_criteria),
          JSON.stringify(s.assessment_methods),
          JSON.stringify(s.dimension_applicability),
          JSON.stringify(s.freshness_policy),
          s.status,
          s.version,
        ],
      );
      atomsInserted++;
      continue;
    }

    // skipPilots: не откатывать pilot-атомы, изменённые через workflow.
    // Критерий: version в БД > seed-версии (semver compare) ИЛИ
    // status ∈ {approved, deprecated}.
    // versionBumped покрывает update_atom (status остаётся 'candidate',
    // но version увеличивается) — иначе сид откатил бы правки к пилотной версии.
    if (skipPilots) {
      const versionBumped = compareSemver(row.version, s.version) > 0;
      if (versionBumped || row.status === 'approved' || row.status === 'deprecated') {
        atomsUnchanged++;
        continue;
      }
    }

    // Пре-чек: ничего не изменилось — не гоняем UPDATE и не бампаем updated_at.
    if (
      row.version === s.version
      && row.status === s.status
      && sameFreshness(row, s)
    ) {
      atomsUnchanged++;
      continue;
    }

    const upd = await client.query(
      `UPDATE competency_atoms SET
         cluster = $2, name = $3, definition = $4,
         boundary_includes = $5::jsonb, boundary_excludes = $6::jsonb,
         context = $7, input = $8, outcome = $9,
         assessment_criteria = $10::jsonb, assessment_methods = $11::jsonb,
         dimension_applicability = $12::jsonb, freshness_policy = $13::jsonb,
         status = $14, version = $15,
         updated_at = now()
       WHERE atom_id = $1
         AND (version           IS DISTINCT FROM $15
           OR status            IS DISTINCT FROM $14
           OR freshness_policy  IS DISTINCT FROM $13::jsonb)
       RETURNING atom_id`,
      [
        s.atom_id,
        s.cluster,
        s.name,
        s.definition,
        JSON.stringify(s.boundary_includes),
        JSON.stringify(s.boundary_excludes),
        s.context,
        s.input,
        s.outcome,
        JSON.stringify(s.assessment_criteria),
        JSON.stringify(s.assessment_methods),
        JSON.stringify(s.dimension_applicability),
        JSON.stringify(s.freshness_policy),
        s.status,
        s.version,
      ],
    );

    if (upd.rowCount && upd.rowCount > 0) {
      atomsUpdated++;
    } else {
      atomsUnchanged++;
    }
  }

  return { atomsInserted, atomsUpdated, atomsUnchanged };
}

async function upsertRelations(client: PoolClient): Promise<RelationCounts> {
  let inserted = 0;
  let skipped = 0;

  for (const r of RELATION_SEEDS) {
    const res = await client.query<{ id: string }>(
      `INSERT INTO competency_relations
         (from_atom_id, to_atom_id, relation_type, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_atom_id, to_atom_id, relation_type) DO NOTHING
       RETURNING id`,
      [r.from, r.to, r.type, r.note ?? null],
    );
    if (res.rows.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  return { relationsInserted: inserted, relationsSkipped: skipped };
}

async function upsertProfiles(client: PoolClient): Promise<ProfileCounts> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const p of PROFILE_SEEDS) {
    const existing = await client.query<{ version: string; status: string }>(
      `SELECT version, status FROM profession_profiles WHERE slug = $1`,
      [p.slug],
    );
    const row = existing.rows[0];

    if (!row) {
      await client.query(
        `INSERT INTO profession_profiles
           (slug, name, version, requirements, status)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [p.slug, p.name, p.version, JSON.stringify(p.requirements), p.status],
      );
      inserted++;
      continue;
    }

    if (row.version === p.version && row.status === p.status) {
      unchanged++;
      continue;
    }

    await client.query(
      `UPDATE profession_profiles SET
         name = $2, version = $3, requirements = $4::jsonb,
         status = $5, updated_at = now()
       WHERE slug = $1`,
      [p.slug, p.name, p.version, JSON.stringify(p.requirements), p.status],
    );
    updated++;
  }

  return {
    profilesInserted: inserted,
    profilesUpdated: updated,
    profilesUnchanged: unchanged,
  };
}

async function upsertDirectionMap(client: PoolClient): Promise<DirectionMapCounts> {
  // 1. Sanity-check справочника. directions создаёт не сид — это делает
  // миграция/bootstrap; здесь только читаем и сверяем.
  const dirRows = await client.query<{ id: string; number: number; name: string; status: string }>(
    `SELECT id, number, name, status FROM directions ORDER BY number`,
  );
  const byNumber = new Map<number, string>();
  for (const d of dirRows.rows) {
    if (d.status === 'active') byNumber.set(d.number, d.id);
  }

  if (dirRows.rows.length !== DIRECTION_SEEDS.length) {
    logger.warn(
      { actual: dirRows.rows.length, expected: DIRECTION_SEEDS.length },
      'seed-passport: directions count differs from reference (не fail)',
    );
  }
  for (const seed of DIRECTION_SEEDS) {
    if (!byNumber.has(seed.number)) {
      logger.warn(
        { number: seed.number, name: seed.name },
        'seed-passport: direction number missing/not active in DB',
      );
    }
  }
  if (!byNumber.has(HOME_DIRECTION_NUMBER)) {
    throw new Error(
      `direction #${HOME_DIRECTION_NUMBER} (Кибернетика и Протокол) not found or not active`,
    );
  }

  // 2. Маппинг. home + main — D09; related — по кластеру.
  let inserted = 0;
  let skipped = 0;

  const insertOne = async (
    atomId: string,
    directionId: string,
    role: 'home' | 'main' | 'related',
  ): Promise<void> => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO atom_direction_map (atom_id, direction_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (atom_id, direction_id, role) DO NOTHING
       RETURNING id`,
      [atomId, directionId, role],
    );
    if (res.rows.length > 0) inserted++;
    else skipped++;
  };

  const homeDirId = byNumber.get(HOME_DIRECTION_NUMBER)!;
  const mainDirId = byNumber.get(MAIN_DIRECTION_NUMBER)!;

  for (const atom of ATOM_SEEDS) {
    await insertOne(atom.atom_id, homeDirId, 'home');
    await insertOne(atom.atom_id, mainDirId, 'main');

    const related = CLUSTER_RELATED_DIRECTIONS[atom.cluster] ?? [];
    for (const num of related) {
      const dirId = byNumber.get(num);
      if (!dirId) {
        logger.warn(
          { atom_id: atom.atom_id, direction_number: num },
          'seed-passport: related direction not found, skip',
        );
        continue;
      }
      await insertOne(atom.atom_id, dirId, 'related');
    }
  }

  return { directionMapInserted: inserted, directionMapSkipped: skipped };
}

async function verifyProfileAtomRefs(): Promise<void> {
  // Санити-чек: все atom_id в профилях существуют.
  const allAtomIds = new Set(ATOM_SEEDS.map((a) => a.atom_id));
  for (const p of PROFILE_SEEDS) {
    for (const r of p.requirements.atoms) {
      if (!allAtomIds.has(r.atom_id)) {
        throw new Error(
          `Профиль ${p.slug}: атом ${r.atom_id} отсутствует в ATOM_SEEDS.`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipPilots = args.includes('--skip-pilots');

  logger.info(
    {
      atoms: ATOM_SEEDS.length,
      profiles: PROFILE_SEEDS.length,
      relations: RELATION_SEEDS.length,
      skipPilots,
    },
    'seed-passport: starting',
  );

  await verifyProfileAtomRefs();

  let counts: UpsertCounts;

  // Одна транзакция на все три блока — все upsert'ы идут через одно соединение,
  // поэтому FK-ссылки из relations/profiles видят ещё не закоммиченные атомы.
  await transaction(async (client) => {
    const atomCounts = await upsertAtoms(client, ATOM_SEEDS, skipPilots);
    const relCounts = await upsertRelations(client);
    const profileCounts = await upsertProfiles(client);
    const dirMapCounts = await upsertDirectionMap(client);

    counts = {
      ...atomCounts,
      ...relCounts,
      ...profileCounts,
      ...dirMapCounts,
    };
  });

  // Проверка после коммита — читаем из БД.
  const atomTotal = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM competency_atoms`,
  );
  const profileTotal = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM profession_profiles`,
  );
  const relationTotal = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM competency_relations`,
  );

  const dirMapTotal = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM atom_direction_map`,
  );
  const dirMapHome = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM atom_direction_map WHERE role = 'home'`,
  );
  const dirMapMain = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM atom_direction_map WHERE role = 'main'`,
  );
  const dirMapRelated = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM atom_direction_map WHERE role = 'related'`,
  );

  console.log('\n─── seed-passport: OK ───');
  if (skipPilots) {
    console.log('(флаг --skip-pilots: approved/deprecated pilot-атомы не откатываются)');
  }
  console.log(
    `competency_atoms:      total=${atomTotal?.total} ` +
      `(inserted=${counts!.atomsInserted}, updated=${counts!.atomsUpdated}, unchanged=${counts!.atomsUnchanged})`,
  );
  console.log(
    `competency_relations:  total=${relationTotal?.total} ` +
      `(inserted=${counts!.relationsInserted}, skipped=${counts!.relationsSkipped})`,
  );
  console.log(
    `profession_profiles:   total=${profileTotal?.total} ` +
      `(inserted=${counts!.profilesInserted}, updated=${counts!.profilesUpdated}, unchanged=${counts!.profilesUnchanged})`,
  );
  console.log(
    `atom_direction_map:    total=${dirMapTotal?.total} ` +
      `(home=${dirMapHome?.total}, main=${dirMapMain?.total}, related=${dirMapRelated?.total}; ` +
      `inserted=${counts!.directionMapInserted}, skipped=${counts!.directionMapSkipped})`,
  );

  // Каталог v0.4: атомы могут добавляться через workflow (catalog_proposals).
  // Seed гарантирует, что 54 пилота есть, но не что их ровно 54.
  if (Number(atomTotal?.total ?? 0) < ATOM_SEEDS.length) {
    throw new Error(
      `competency_atoms: ожидалось не меньше ${ATOM_SEEDS.length}, в БД ${atomTotal?.total}`,
    );
  }
  if (profileTotal?.total !== String(PROFILE_SEEDS.length)) {
    throw new Error(`profession_profiles: ожидалось ${PROFILE_SEEDS.length}, в БД ${profileTotal?.total}`);
  }
  if (dirMapHome?.total !== String(ATOM_SEEDS.length)) {
    throw new Error(
      `atom_direction_map: home=${dirMapHome?.total}, ожидалось ${ATOM_SEEDS.length}`,
    );
  }
  if (dirMapMain?.total !== String(ATOM_SEEDS.length)) {
    throw new Error(
      `atom_direction_map: main=${dirMapMain?.total}, ожидалось ${ATOM_SEEDS.length}`,
    );
  }

  logger.info({ counts }, 'seed-passport: done');
  await gracefulShutdown();
}

main().catch(async (e) => {
  logger.error({ err: e }, 'seed-passport: fatal');
  try {
    await gracefulShutdown();
  } catch {
    // ignore
  }
  process.exit(1);
});