// C.0.28.02 — Сервис Convergence.
// Переход внешнего государства (V.7). 5 этапов + завершение.
// Максимум 60 месяцев (I.7.2). Без cron: аудит — политическая процедура
// Совета (I.7.7.4), запускается вручную.
//
// Интеграции (best-effort, dynamic import):
//   - C.0.14.02 (Flows)        — internal debts → Потоки.
//   - C.0.24.02 (Gateway)      — assets → фонд Шлюза (acceptAsset).
//   - C.0.19.02 (Verification) — auditProgress → createAuditService.
//   - C.0.27.02 (Planetary)    — complete → аккредитация общины (TODO).
//
// Соглашение: ad-hoc критерии этапа 4→5 берутся из:
//   - balance_metrics.metrics->>'import_dependency_pct' (последняя запись).
//   - cognitive_routes: доля completed/certificate_issued.
//   - weapon_conversions WHERE action='utilize'.
//
// v0.0.02:
//   - B.6: advanceStage(planId, targetStage, requesterId) — target-этап
//          передаётся из контроллера, проверка plan.stage+1 === targetStage
//          выполняется здесь (race-fix), а не в HTTP-слое.
//   - B.7: checkStageCriteria использует CONVERGENCE_MAX_STAGE из
//          CONVERGENCE_STAGES (единый источник), без хардкод-константы 5.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { logAction } from '../audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import {
  createConvergencePlan as entityCreatePlan,
  signDeclaration as entitySignDeclaration,
  createCouncil as entityCreateCouncil,
  advanceStage as entityAdvanceStage,
  canAdvanceStage as entityCanAdvanceStage,
  convertDebts as entityConvertDebts,
  convertAssets as entityConvertAssets,
  convertWeapons as entityConvertWeapons,
  createCulturalCenter as entityCreateCulturalCenter,
  completeConvergence as entityCompleteConvergence,
  getMaxMonths as entityGetMaxMonths,
  CONVERGENCE_MAX_MONTHS,
  CONVERGENCE_STAGES,
  type ConvergencePlan,
  type ConvergenceCouncil,
  type DebtConversion,
  type AssetConversion,
  type WeaponConversion,
  type CulturalCenter,
  type ConvergenceStatus,
  type DebtType,
  type DebtAction,
  type WeaponAction,
  type StageCriteria,
} from './entity.js';

// ─── Constants ──────────────────────────────────────────────────

// B.7: 5 — финальный этап конвергенции (0..5). Источник истины —
// CONVERGENCE_STAGES в entity.ts, здесь только производная.
const CONVERGENCE_MAX_STAGE = CONVERGENCE_STAGES - 1;

// ─── Best-effort helper ─────────────────────────────────────────

async function bestEffort(
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `convergence: ${label} failed (best-effort)`);
  }
}

// ─── Row-mappers ────────────────────────────────────────────────

interface PlanRow {
  id: string;
  state_name: string;
  stage: number;
  status: ConvergenceStatus;
  coordinator_id: string | null;
  started_at: Date;
  finished_at: Date | null;
}

function rowToPlan(r: PlanRow): ConvergencePlan {
  return {
    id: r.id,
    stateName: r.state_name,
    stage: r.stage,
    status: r.status,
    coordinatorId: r.coordinator_id,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
  };
}

interface CouncilRow {
  id: string;
  plan_id: string;
  members: Array<Record<string, unknown>>;
}

function rowToCouncil(r: CouncilRow): ConvergenceCouncil {
  return {
    id: r.id,
    planId: r.plan_id,
    members: r.members ?? [],
  };
}

interface DebtRow {
  id: string;
  plan_id: string;
  type: DebtType;
  amount: string;
  action: DebtAction;
  coefficient: string | null;
  created_at: Date;
}

function rowToDebt(r: DebtRow): DebtConversion {
  return {
    id: r.id,
    planId: r.plan_id,
    type: r.type,
    amount: parseFloat(r.amount),
    action: r.action,
    coefficient: r.coefficient !== null ? parseFloat(r.coefficient) : null,
    createdAt: r.created_at.toISOString(),
  };
}

interface AssetRow {
  id: string;
  plan_id: string;
  asset_type: string;
  value: string;
  destination_direction_id: string;
  created_at: Date;
}

function rowToAsset(r: AssetRow): AssetConversion {
  return {
    id: r.id,
    planId: r.plan_id,
    assetType: r.asset_type,
    value: parseFloat(r.value),
    destinationDirectionId: r.destination_direction_id,
    createdAt: r.created_at.toISOString(),
  };
}

interface WeaponRow {
  id: string;
  plan_id: string;
  weapon_type: string;
  action: WeaponAction;
  verified_by: string | null;
  created_at: Date;
}

function rowToWeapon(r: WeaponRow): WeaponConversion {
  return {
    id: r.id,
    planId: r.plan_id,
    weaponType: r.weapon_type,
    action: r.action,
    verifiedBy: r.verified_by,
    createdAt: r.created_at.toISOString(),
  };
}

interface CultureRow {
  id: string;
  plan_id: string;
  lat: string;
  lon: string;
  status: 'planned' | 'open' | 'closed';
  created_at: Date;
}

function rowToCulture(r: CultureRow): CulturalCenter {
  return {
    id: r.id,
    planId: r.plan_id,
    location: {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    },
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Plans: read / list / create ─────────────────────────────────

const PLAN_COLS = `
  id, state_name, stage, status, coordinator_id, started_at, finished_at
`;

export interface PlanFilter {
  status?: ConvergenceStatus;
  page?: number;
  perPage?: number;
}

export async function listPlans(
  filter: PlanFilter = {},
  _requesterId?: UUID,
): Promise<{ data: ConvergencePlan[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    cond.push(`status = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM convergence_plans ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<PlanRow>(
    `SELECT ${PLAN_COLS}
       FROM convergence_plans
       ${where}
      ORDER BY started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToPlan), total };
}

export async function getPlan(
  planId: UUID,
  _requesterId?: UUID,
): Promise<ConvergencePlan> {
  const row = await queryOne<PlanRow>(
    `SELECT ${PLAN_COLS} FROM convergence_plans WHERE id = $1`,
    [planId],
  );
  if (!row) {throw new NotFoundError('План конвергенции', planId);}
  return rowToPlan(row);
}

export interface CreatePlanInput {
  stateName: string;
  coordinatorId?: UUID;
}

export async function createPlan(
  input: CreatePlanInput,
  requesterId: UUID,
): Promise<ConvergencePlan> {
  const entity = entityCreatePlan({
    id: newUUID(),
    stateName: input.stateName,
    ...(input.coordinatorId !== undefined
      ? { coordinatorId: input.coordinatorId }
      : {}),
  });

  if (input.coordinatorId) {
    const p = await queryOne<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
      [input.coordinatorId],
    );
    if (!p) {
      throw new ValidationError('coordinator_id не существует');
    }
  }

  await query(
    `INSERT INTO convergence_plans
       (id, state_name, stage, status, coordinator_id, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entity.id,
      entity.stateName,
      entity.stage,
      entity.status,
      entity.coordinatorId,
      entity.startedAt,
    ],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.plan_created',
    entityType: 'convergence_plan',
    entityId: entity.id,
    newValue: { state_name: entity.stateName },
  });

  return entity;
}

// ─── Declaration ────────────────────────────────────────────────

export async function signDeclaration(
  planId: UUID,
  signedBy: UUID,
  requesterId: UUID,
): Promise<ConvergencePlan> {
  const plan = await getPlan(planId);

  const signer = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [signedBy],
  );
  if (!signer) {
    throw new ValidationError('signed_by не существует');
  }

  const updated = entitySignDeclaration(plan, signedBy);

  await query(
    `UPDATE convergence_plans SET status = 'declared' WHERE id = $1`,
    [planId],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.declaration_signed',
    entityType: 'convergence_plan',
    entityId: planId,
    newValue: { signed_by: signedBy },
  });

  return updated;
}

// ─── Council ────────────────────────────────────────────────────

export async function createCouncil(
  planId: UUID,
  members: Array<Record<string, unknown>>,
  requesterId: UUID,
): Promise<ConvergenceCouncil> {
  const plan = await getPlan(planId);
  if (plan.status === 'completed' || plan.status === 'failed') {
    throw new ConflictError(
      `План в статусе '${plan.status}' — Совет недоступен`,
    );
  }

  const entity = entityCreateCouncil(planId, members);

  await query(
    `INSERT INTO convergence_council (id, plan_id, members)
     VALUES ($1, $2, $3::jsonb)`,
    [entity.id, entity.planId, JSON.stringify(entity.members)],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.council_created',
    entityType: 'convergence_council',
    entityId: entity.id,
    newValue: { plan_id: planId, members_count: entity.members.length },
  });

  return entity;
}

// ─── Критерии этапа ─────────────────────────────────────────────

async function computeStageCriteria(
  plan: ConvergencePlan,
): Promise<StageCriteria> {
  // 1. Декларация подписана.
  const declarationSigned = plan.status !== 'draft';

  // 2. Импортозависимость — последняя запись в balance_metrics с ключом
  //    'import_dependency_pct' (соглашение проекта, аналогично GuardianIndex
  //    'import_dependency' в C.0.18.*). null = нет данных.
  let importDependencyPct: number | null = null;
  try {
    const row = await queryOne<{ pct: string | null }>(
      `SELECT (metrics->>'import_dependency_pct') AS pct
         FROM balance_metrics
        WHERE metrics ? 'import_dependency_pct'
        ORDER BY created_at DESC
        LIMIT 1`,
    );
    if (row?.pct !== null && row?.pct !== undefined) {
      const v = parseFloat(row.pct);
      if (Number.isFinite(v)) {importDependencyPct = v;}
    }
  } catch (e) {
    logger.warn({ err: e }, 'convergence: import_dependency query failed');
  }

  // 3. Когнитивный маршрут — доля завершённых (certificate_issued или
  //    status='completed') среди всех записей cognitive_routes.
  let cognitiveRoutePct: number | null = null;
  try {
    const row = await queryOne<{ total: string; done: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (
           WHERE certificate_issued = true OR status = 'completed'
         )::text AS done
       FROM cognitive_routes`,
    );
    const total = parseInt(row?.total ?? '0', 10);
    if (total > 0) {
      const done = parseInt(row?.done ?? '0', 10);
      cognitiveRoutePct = Math.round((done / total) * 10000) / 100;
    }
  } catch (e) {
    logger.warn({ err: e }, 'convergence: cognitive_routes query failed');
  }

  // 4. Военные интегрированы — есть ли хотя бы один weapon_conversions с
  //    action='utilize'. null = нет данных, не блокирует.
  let militaryIntegrated: boolean | null = null;
  try {
    const row = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM weapon_conversions
        WHERE action = 'utilize'`,
    );
    const cnt = parseInt(row?.cnt ?? '0', 10);
    militaryIntegrated = cnt > 0 ? true : null;
  } catch (e) {
    logger.warn({ err: e }, 'convergence: weapon_conversions query failed');
  }

  return {
    declarationSigned,
    importDependencyPct,
    cognitiveRoutePct,
    militaryIntegrated,
  };
}

// B.7: nextStage ограничивается CONVERGENCE_MAX_STAGE (из CONVERGENCE_STAGES),
// без хардкод-константы 5.
export async function checkStageCriteria(
  planId: UUID,
): Promise<{ canAdvance: boolean; missing: string[]; nextStage: number }> {
  const plan = await getPlan(planId);
  const criteria = await computeStageCriteria(plan);
  const result = entityCanAdvanceStage(plan, criteria);
  return {
    canAdvance: result.allowed,
    missing: result.missing,
    nextStage: Math.min(plan.stage + 1, CONVERGENCE_MAX_STAGE),
  };
}

// ─── advanceStage / advanceToStage ──────────────────────────────

// B.6: targetStage передаётся из контроллера; проверка «plan.stage + 1 ===
// targetStage» выполняется здесь, под тем же getPlan — без race между
// контроллером и сервисом. Два параллельных POST /stage/N не могут прыгнуть
// через этап.
export async function advanceStage(
  planId: UUID,
  targetStage: number,
  requesterId: UUID,
): Promise<ConvergencePlan> {
  const plan = await getPlan(planId);

  // Race-fix: проверяем внутри сервиса, а не только в контроллере.
  // Иначе два параллельных POST /stage/N могли прыгнуть через этап.
  if (plan.stage + 1 !== targetStage) {
    throw new ConflictError(
      `Нельзя перейти к этапу ${targetStage}: текущий ${plan.stage}, ` +
        `ожидаемый следующий ${plan.stage + 1}`,
    );
  }

  const criteria = await computeStageCriteria(plan);
  const check = entityCanAdvanceStage(plan, criteria);
  if (!check.allowed) {
    throw new ConflictError(
      `Нельзя перейти к этапу ${targetStage}: ${check.missing.join('; ')}`,
      { missing: check.missing },
    );
  }

  const updated = entityAdvanceStage(plan);

  if (updated.status === 'completed') {
    await query(
      `UPDATE convergence_plans
          SET stage = $2, status = 'completed', finished_at = now()
        WHERE id = $1`,
      [planId, updated.stage],
    );
  } else {
    await query(
      `UPDATE convergence_plans SET stage = $2, status = 'in_progress'
        WHERE id = $1`,
      [planId, updated.stage],
    );
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.stage_advanced',
    entityType: 'convergence_plan',
    entityId: planId,
    newValue: {
      from_stage: plan.stage,
      to_stage: updated.stage,
      new_status: updated.status,
    },
  });

  return updated;
}

// ─── Конверсии: долги / активы / вооружения ────────────────────

export interface ConvertDebtsInput {
  type: DebtType;
  amount: number;
  action?: DebtAction;
  coefficient?: number;
}

export async function convertDebts(
  planId: UUID,
  input: ConvertDebtsInput,
  requesterId: UUID,
): Promise<DebtConversion> {
  const plan = await getPlan(planId);
  if (plan.status === 'completed' || plan.status === 'failed') {
    throw new ConflictError(
      `План в статусе '${plan.status}' — конверсия недоступна`,
    );
  }

  const entity = entityConvertDebts(planId, input);

  await query(
    `INSERT INTO debt_conversions
       (id, plan_id, type, amount, action, coefficient)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entity.id,
      entity.planId,
      entity.type,
      entity.amount,
      entity.action,
      entity.coefficient,
    ],
  );

  // Internal → convert в Потоки (best-effort).
  // C.0.14.02: сигнатуры неизвестны. Пытаемся вызвать addFlow через
  // runtime-guard; если метода нет — молча пропускаем.
  if (entity.action === 'convert') {
    await bestEffort('flows.addFlow', async () => {
      const flowsMod = (await import('../flows/service.js')) as Record<
        string,
        unknown
      >;
      const addFlow = flowsMod['addFlow'];
      if (typeof addFlow === 'function') {
        await (
          addFlow as (
            amount: number,
            type: string,
            reason: string,
          ) => Promise<unknown>
        )(entity.amount, 'main', `convergence:${planId}`);
      } else {
        logger.info(
          { planId },
          'convergence: flows.addFlow not available, skipping',
        );
      }
    });
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.debt_converted',
    entityType: 'debt_conversion',
    entityId: entity.id,
    newValue: {
      plan_id: planId,
      type: entity.type,
      amount: entity.amount,
      action: entity.action,
    },
  });

  return entity;
}

export interface ConvertAssetsInput {
  assetType: string;
  value: number;
  destinationDirectionId: UUID;
}

export async function convertAssets(
  planId: UUID,
  input: ConvertAssetsInput,
  requesterId: UUID,
): Promise<AssetConversion> {
  const plan = await getPlan(planId);
  if (plan.status === 'completed' || plan.status === 'failed') {
    throw new ConflictError(
      `План в статусе '${plan.status}' — конверсия недоступна`,
    );
  }

  // Проверка, что destination_direction_id существует.
  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE id = $1`,
    [input.destinationDirectionId],
  );
  if (!dir) {
    throw new ValidationError('destination_direction_id не существует');
  }

  const entity = entityConvertAssets(planId, input);

  await query(
    `INSERT INTO asset_conversions
       (id, plan_id, asset_type, value, destination_direction_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entity.id,
      entity.planId,
      entity.assetType,
      entity.value,
      entity.destinationDirectionId,
    ],
  );

  // Активы → фонд Шлюза (best-effort, C.0.24.02.acceptAsset).
  await bestEffort('gateway.acceptAsset', async () => {
    const mod = await import('../gateway/service.js');
    const acceptAsset = mod.acceptAsset;
    if (typeof acceptAsset === 'function') {
      await acceptAsset(
        {
          type: 'finance', // валидное значение external_asset_type_enum
          value: entity.value,
        },
        requesterId,
      );
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.asset_converted',
    entityType: 'asset_conversion',
    entityId: entity.id,
    newValue: {
      plan_id: planId,
      asset_type: entity.assetType,
      value: entity.value,
    },
  });

  return entity;
}

export interface ConvertWeaponsInput {
  weaponType: string;
  action: WeaponAction;
}

export async function convertWeapons(
  planId: UUID,
  input: ConvertWeaponsInput,
  requesterId: UUID,
): Promise<WeaponConversion> {
  const plan = await getPlan(planId);
  if (plan.status === 'completed' || plan.status === 'failed') {
    throw new ConflictError(
      `План в статусе '${plan.status}' — конверсия недоступна`,
    );
  }

  const entity = entityConvertWeapons(planId, input);

  await query(
    `INSERT INTO weapon_conversions
       (id, plan_id, weapon_type, action, verified_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entity.id,
      entity.planId,
      entity.weaponType,
      entity.action,
      entity.verifiedBy,
    ],
  );

  // Best-effort: createAuditService в Verification (I.7.8.1).
  await bestEffort('verification.createAuditService', async () => {
    const mod = await import('../verification/service.js');
    const create = mod.createAuditService;
    if (typeof create === 'function') {
      await create(
        {
          type: 'unplanned',
          subject: 'convergence',
          subjectId: planId,
        },
        requesterId,
      );
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.weapon_converted',
    entityType: 'weapon_conversion',
    entityId: entity.id,
    newValue: {
      plan_id: planId,
      weapon_type: entity.weaponType,
      action: entity.action,
    },
  });

  return entity;
}

// ─── Культурные центры ─────────────────────────────────────────

export async function createCulturalCenter(
  planId: UUID,
  lat: number,
  lon: number,
  requesterId: UUID,
): Promise<CulturalCenter> {
  const plan = await getPlan(planId);
  if (plan.status === 'completed' || plan.status === 'failed') {
    throw new ConflictError(
      `План в статусе '${plan.status}' — создание центра недоступно`,
    );
  }

  const entity = entityCreateCulturalCenter(planId, lat, lon);

  await query(
    `INSERT INTO cultural_centers (id, plan_id, location, status)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 'planned')`,
    [entity.id, entity.planId, entity.location.lat, entity.location.lon],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.cultural_center_created',
    entityType: 'cultural_center',
    entityId: entity.id,
    newValue: {
      plan_id: planId,
      lat: entity.location.lat,
      lon: entity.location.lon,
    },
  });

  return entity;
}

// ─── complete ──────────────────────────────────────────────────

export async function complete(
  planId: UUID,
  requesterId: UUID,
): Promise<ConvergencePlan> {
  const plan = await getPlan(planId);
  if (plan.status === 'completed') {
    // Идемпотентно: возвращаем как есть.
    return plan;
  }
  if (plan.status === 'failed') {
    throw new ConflictError('План провален — завершение недоступно');
  }

  const validation = await validateCompletion(planId);
  if (!validation.canComplete) {
    throw new ConflictError(
      `Нельзя завершить: ${validation.reasons.join('; ')}`,
      { reasons: validation.reasons },
    );
  }

  const updated = entityCompleteConvergence(plan);

  await query(
    `UPDATE convergence_plans
        SET status = 'completed', finished_at = now()
      WHERE id = $1`,
    [planId],
  );

  // Аккредитация общины через C.0.27.02 (I.7.8.2) — best-effort.
  // В C.0.27.02 нет функции аккредитации; логируем намерение.
  // TODO: при появлении accreditationCommunity в Planetary — вызвать.
  await bestEffort('planetary.accreditation', async () => {
    const mod = (await import('../planetary/service.js')) as Record<
      string,
      unknown
    >;
    const accredit = mod['accreditCommunity'];
    if (typeof accredit === 'function') {
      await (accredit as (planId: UUID, by: UUID) => Promise<unknown>)(
        planId,
        requesterId,
      );
    } else {
      logger.info(
        { planId },
        'convergence: planetary.accreditCommunity not available',
      );
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.completed',
    entityType: 'convergence_plan',
    entityId: planId,
  });

  return updated;
}

// ─── validateCompletion ────────────────────────────────────────

export async function validateCompletion(
  planId: UUID,
): Promise<{ canComplete: boolean; reasons: string[] }> {
  const plan = await getPlan(planId);
  const reasons: string[] = [];

  if (plan.status === 'completed') {
    return { canComplete: true, reasons: [] };
  }
  if (plan.status === 'failed') {
    return { canComplete: false, reasons: ['План провален'] };
  }

  // Все этапы пройдены?
  if (plan.stage < 5) {
    reasons.push(`Достигнут этап ${plan.stage} < 5 (не все этапы пройдены)`);
  }

  // Декларация?
  if (plan.status === 'draft') {
    reasons.push('Декларация не подписана');
  }

  // Совет конвергенции создан?
  const councilRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM convergence_council WHERE plan_id = $1`,
    [planId],
  );
  const councilCount = parseInt(councilRow?.cnt ?? '0', 10);
  if (councilCount === 0) {
    reasons.push('Совет конвергенции не создан');
  }

  return { canComplete: reasons.length === 0, reasons };
}

// ─── auditProgress ─────────────────────────────────────────────

export async function auditProgress(
  planId: UUID,
  requesterId: UUID,
): Promise<{ findings: string[] }> {
  const plan = await getPlan(planId);
  const findings: string[] = [];

  // Базовые проверки.
  if (plan.status === 'draft') {
    findings.push('Декларация не подписана');
  }

  const councilRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM convergence_council WHERE plan_id = $1`,
    [planId],
  );
  if (parseInt(councilRow?.cnt ?? '0', 10) === 0) {
    findings.push('Совет конвергенции не создан');
  }

  // Конверсии.
  const debtRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM debt_conversions WHERE plan_id = $1`,
    [planId],
  );
  if (parseInt(debtRow?.cnt ?? '0', 10) === 0) {
    findings.push('Конверсий долгов нет');
  }

  // Превышение 60 месяцев (I.7.2).
  const startedAt = new Date(plan.startedAt).getTime();
  const months = (Date.now() - startedAt) / (30 * 86_400_000);
  if (months > CONVERGENCE_MAX_MONTHS) {
    findings.push(
      `Превышен лимит ${CONVERGENCE_MAX_MONTHS} месяцев ` +
        `(${months.toFixed(1)} мес.) — I.7.2`,
    );
  }

  // Критерии финального этапа (информативно).
  if (plan.stage >= 3) {
    const criteria = await computeStageCriteria(plan);
    if (
      criteria.importDependencyPct !== null &&
      criteria.importDependencyPct >= 5
    ) {
      findings.push(
        `Импортозависимость ${criteria.importDependencyPct.toFixed(2)}% ≥ 5%`,
      );
    }
    if (
      criteria.cognitiveRoutePct !== null &&
      criteria.cognitiveRoutePct < 80
    ) {
      findings.push(
        `Когнитивный маршрут ${criteria.cognitiveRoutePct.toFixed(1)}% < 80%`,
      );
    }
  }

  // Best-effort: createAuditService в Verification.
  await bestEffort('verification.createAuditService (auditProgress)', async () => {
    const mod = await import('../verification/service.js');
    const create = mod.createAuditService;
    if (typeof create === 'function') {
      await create(
        {
          type: 'planned',
          subject: 'convergence',
          subjectId: planId,
        },
        requesterId,
      );
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'convergence.audit',
    entityType: 'convergence_plan',
    entityId: planId,
    newValue: { findings },
  });

  return { findings };
}

// ─── getMaxMonths ──────────────────────────────────────────────

export function getMaxMonths(): number {
  return entityGetMaxMonths();
}

// ─── Чтение коллекций (для UI: 4 таба) ─────────────────────────
//
// Спека не заявляет GET-эндпоинты для debts/assets/weapons/culture/council
// явно, но UI F.4.02.20 (4 таба) без них не отобразит данные. Это
// логичное расширение контракта — по аналогии с Psy (listCrises,
// listDischarges) и Aggregator.

export async function getCouncil(
  planId: UUID,
): Promise<ConvergenceCouncil | null> {
  const row = await queryOne<CouncilRow>(
    `SELECT id, plan_id, members
       FROM convergence_council
      WHERE plan_id = $1
      ORDER BY id ASC
      LIMIT 1`,
    [planId],
  );
  return row ? rowToCouncil(row) : null;
}

export async function listDebts(
  planId: UUID,
): Promise<DebtConversion[]> {
  const rows = await query<DebtRow>(
    `SELECT id, plan_id, type, amount::text AS amount, action,
            coefficient::text AS coefficient, created_at
       FROM debt_conversions
      WHERE plan_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [planId],
  );
  return rows.map(rowToDebt);
}

export async function listAssets(
  planId: UUID,
): Promise<AssetConversion[]> {
  const rows = await query<AssetRow>(
    `SELECT id, plan_id, asset_type, value::text AS value,
            destination_direction_id, created_at
       FROM asset_conversions
      WHERE plan_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [planId],
  );
  return rows.map(rowToAsset);
}

export async function listWeapons(
  planId: UUID,
): Promise<WeaponConversion[]> {
  const rows = await query<WeaponRow>(
    `SELECT id, plan_id, weapon_type, action, verified_by, created_at
       FROM weapon_conversions
      WHERE plan_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [planId],
  );
  return rows.map(rowToWeapon);
}

export async function listCulturalCenters(
  planId: UUID,
): Promise<CulturalCenter[]> {
  const rows = await query<CultureRow>(
    `SELECT id, plan_id,
            ST_Y(location::geometry)::text AS lat,
            ST_X(location::geometry)::text AS lon,
            status, created_at
       FROM cultural_centers
      WHERE plan_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [planId],
  );
  return rows.map(rowToCulture);
}

// ─── Экспорт константы ──────────────────────────────────────────

export { CONVERGENCE_MAX_MONTHS, type StageCriteria };