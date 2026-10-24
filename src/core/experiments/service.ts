// C.0.30.02 — Сервис Experiments.
// Эксперименты (VIII.1) + диссидентские проекты (I.1.8.10).
//
// Интеграции (best-effort, dynamic import):
//   - C.0.13.02 (UniversalRuns) — approveExperiment: aggregateRun для
//     подсчёта 75% support. ВАЖНО: FK universal_runs.signal_id → signals(id),
//     поэтому experiment_id как signal_id не подойдёт. Логика:
//       - если уже есть universal_runs с signal_id = experiment_id —
//         используем aggregateRun;
//       - иначе — считаем support по participants.length.
//     Создание run через runService не выполняем (FK violation).
//   - C.0.14.02 (Flows) — signPetition: запрос финансирования.
//   - C.0.20.02 (Archive) — recordResults / completeExperiment: публикация.
//
// v0.0.02:
//   - P3: joinExperiment — убран мёртвый if (entity-слой сам бросает
//         ConflictError при дубликате).
//   - P4: approveExperiment — ApproveResult.approved + progress.required;
//         идемпотентность (уже active → approved=true без logAction).
//   - P5: recordResults — 409 при status='cancelled'; completed разрешён
//         (финальный отчёт перед архивацией).

import { query, queryOne, isUniqueViolation } from '../../lib/db.js';
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
  createExperiment as entityCreateExperiment,
  approveExperiment as entityApproveExperiment,
  joinExperiment as entityJoinExperiment,
  leaveExperiment as entityLeaveExperiment,
  completeExperiment as entityCompleteExperiment,
  recordResults as entityRecordResults,
  createDissident as entityCreateDissident,
  signPetition as entitySignPetition,
  hasEnoughSignatures,
  resourceSourceFor as entityResourceSourceFor,
  reportDissident as entityReportDissident,
  shouldSuspend as entityShouldSuspend,
  canReview as entityCanReview,
  formatExternalId,
  EXPERIMENT_APPROVAL_PCT,
  DISSIDENT_REPORT_INTERVAL_DAYS,
  type Experiment,
  type ExperimentResults,
  type DissidentProject,
  type ExperimentStatus,
  type DissidentStatus,
  type DissidentResourceSource,
} from './entity.js';

// ─── Best-effort ─────────────────────────────────────────────────

async function bestEffort(
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `experiments: ${label} failed (best-effort)`);
  }
}

// ─── Row-mappers ─────────────────────────────────────────────────

interface ExperimentRow {
  id: string;
  external_id: string;
  goal: string;
  term_days: number;
  participants: UUID[];
  criteria: Record<string, unknown>;
  status: ExperimentStatus;
  approved_by: string | null;
  created_at: Date;
  finished_at: Date | null;
}

function rowToExperiment(r: ExperimentRow): Experiment {
  return {
    id: r.id,
    externalId: r.external_id,
    goal: r.goal,
    termDays: r.term_days,
    participants: r.participants ?? [],
    criteria: r.criteria ?? {},
    status: r.status,
    approvedBy: r.approved_by,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
  };
}

interface ResultsRow {
  id: string;
  protocol_id: string;
  successes: string[];
  failures: string[];
  stats: Record<string, unknown>;
  published: boolean;
  created_at: Date;
}

function rowToResults(r: ResultsRow): ExperimentResults {
  return {
    id: r.id,
    protocolId: r.protocol_id,
    successes: r.successes ?? [],
    failures: r.failures ?? [],
    stats: r.stats ?? {},
    published: r.published,
    createdAt: r.created_at.toISOString(),
  };
}

interface DissidentRow {
  id: string;
  initiator_id: string;
  description: string;
  petition_count: number;
  required_percent: string | number;
  resource_source: DissidentResourceSource;
  status: DissidentStatus;
  report_interval_days: number;
  last_report_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
}

function rowToDissident(r: DissidentRow): DissidentProject {
  return {
    id: r.id,
    initiatorId: r.initiator_id,
    description: r.description,
    petitionCount: r.petition_count,
    requiredPercent:
      typeof r.required_percent === 'string'
        ? parseFloat(r.required_percent)
        : r.required_percent,
    resourceSource: r.resource_source,
    status: r.status,
    reportIntervalDays: r.report_interval_days,
    lastReportAt: r.last_report_at ? r.last_report_at.toISOString() : null,
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

const EXP_COLS = `
  id, external_id, goal, term_days, participants, criteria,
  status, approved_by, created_at, finished_at
`;

const DISSIDENT_COLS = `
  id, initiator_id, description, petition_count, required_percent,
  resource_source, status, report_interval_days,
  last_report_at, closed_at, created_at
`;

// ─── Утилита: общее число активных участников ────────────────────

async function countActiveParticipants(): Promise<number> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM participants
      WHERE deleted_at IS NULL AND status <> 'excluded'`,
  );
  return parseInt(row?.cnt ?? '0', 10);
}

async function countActiveDirections(): Promise<number> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM directions WHERE status = 'active'`,
  );
  return parseInt(row?.cnt ?? '0', 10);
}

// ─── Experiments: list / get / create ──────────────────────────

export interface ExperimentFilter {
  status?: ExperimentStatus;
  page?: number;
  perPage?: number;
}

export async function listExperiments(
  filter: ExperimentFilter = {},
  _requesterId?: UUID,
): Promise<{ data: Experiment[]; total: number }> {
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
    `SELECT COUNT(*)::text AS total FROM experimental_protocols ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<ExperimentRow>(
    `SELECT ${EXP_COLS}
       FROM experimental_protocols
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToExperiment), total };
}

export async function listMyExperiments(
  participantId: UUID,
  _requesterId?: UUID,
): Promise<Experiment[]> {
  const rows = await query<ExperimentRow>(
    `SELECT ${EXP_COLS}
       FROM experimental_protocols
      WHERE participants @> $1::jsonb
      ORDER BY created_at DESC
      LIMIT 200`,
    [JSON.stringify([participantId])],
  );
  return rows.map(rowToExperiment);
}

export async function getExperiment(
  experimentId: UUID,
  _requesterId?: UUID,
): Promise<Experiment> {
  const row = await queryOne<ExperimentRow>(
    `SELECT ${EXP_COLS} FROM experimental_protocols WHERE id = $1`,
    [experimentId],
  );
  if (!row) {throw new NotFoundError('Эксперимент', experimentId);}
  return rowToExperiment(row);
}

export interface CreateExperimentServiceInput {
  goal: string;
  termDays: number;
  criteria: Record<string, unknown>;
}

export async function createExperiment(
  input: CreateExperimentServiceInput,
  requesterId: UUID,
): Promise<Experiment> {
  const year = new Date().getUTCFullYear();

  // sequence = COUNT(*) + 1 с retry на UNIQUE (защита от гонок).
  for (let attempt = 0; attempt < 3; attempt++) {
    const countRow = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM experimental_protocols
        WHERE created_at >= $1`,
      [new Date(Date.UTC(year, 0, 1)).toISOString()],
    );
    const seq = parseInt(countRow?.cnt ?? '0', 10) + 1 + attempt;
    const externalId = formatExternalId(seq, year);
    const id = newUUID();

    const entity = entityCreateExperiment({
      id,
      externalId,
      goal: input.goal,
      termDays: input.termDays,
      criteria: input.criteria,
      initiatorId: requesterId,
    });

    try {
      await query(
        `INSERT INTO experimental_protocols
           (id, external_id, goal, term_days, participants, criteria,
            status, approved_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'filed', NULL)`,
        [
          entity.id,
          entity.externalId,
          entity.goal,
          entity.termDays,
          JSON.stringify(entity.participants),
          JSON.stringify(entity.criteria),
        ],
      );

      await logAction({
        actorId: requesterId,
        actorType: 'participant',
        action: 'experiment.created',
        entityType: 'experimental_protocol',
        entityId: entity.id,
        newValue: {
          external_id: entity.externalId,
          term_days: entity.termDays,
        },
      });

      return entity;
    } catch (e) {
      if (isUniqueViolation(e)) {continue;}
      throw e;
    }
  }

  throw new ConflictError('Не удалось сгенерировать уникальный external_id');
}

// ─── approveExperiment (идемпотентен) ──────────────────────────

// P4: approved — флаг, true если статус 'active' (в этом вызове или ранее);
// progress.required — порог 75% от total (для UI-прогресса).
export interface ApproveResult {
  experiment: Experiment;
  /** true — статус переведён в 'active' в этом вызове (или уже был active).
   *  false — support < 75%, статус остался 'filed'. */
  approved: boolean;
  progress: {
    responded: number;
    total: number;
    percent: number;
    required: number;
    approvalRunId: UUID | null;
  };
}

/**
 * Идемпотентен. Всегда 200 с актуальным Experiment.
 *
 * Логика support:
 *   1. Если есть universal_runs с signal_id = experiment_id — используем
 *      aggregateRun / getProgress (best-effort через dynamic import).
 *   2. Иначе — fallback на participants.length.
 *
 * ВАЖНО: не создаём universal_runs (FK signal_id → signals.id;
 * experiment_id ≠ signals.id).
 */
export async function approveExperiment(
  experimentId: UUID,
  requesterId: UUID,
): Promise<ApproveResult> {
  const plan = await getExperiment(experimentId, requesterId);
  const total = await countActiveDirections();

  // 1. Проверка существующего universal run (signal_id = experiment_id).
  let responded = 0;
  let approvalRunId: UUID | null = null;

  const runRow = await queryOne<{ id: string }>(
    `SELECT id FROM universal_runs WHERE signal_id = $1 LIMIT 1`,
    [experimentId],
  );

  if (runRow) {
    approvalRunId = runRow.id;
    await bestEffort('universal-runs.getProgress', async () => {
      const mod = await import('../universal-runs/service.js');
      const getProgress = mod.getProgress;
      if (typeof getProgress === 'function') {
        const progress = await (
          getProgress as (runId: UUID) => Promise<{
            responded: number;
            total: number;
            percent: number;
          }>
        )(runRow.id);
        responded = progress.responded ?? 0;
      }
    });
  }

  // 2. Fallback на участников (если run не было или он пустой).
  const byParticipants = plan.participants.length;
  const support = Math.max(responded, byParticipants);
  const requiredSupport = Math.max(
    1,
    Math.ceil(total * EXPERIMENT_APPROVAL_PCT),
  );
  const enough = support >= requiredSupport;

  let updated = plan;
  let approved = false;

  if (plan.status === 'active') {
    // P4: идемпотентно — уже active.
    approved = true;
  } else if (enough && plan.status === 'filed') {
    updated = entityApproveExperiment(plan, requesterId);
    approved = true;

    await query(
      `UPDATE experimental_protocols
          SET status = 'active', approved_by = $2
        WHERE id = $1`,
      [experimentId, requesterId],
    );

    await logAction({
      actorId: requesterId,
      actorType: 'participant',
      action: 'experiment.approved',
      entityType: 'experimental_protocol',
      entityId: experimentId,
      newValue: {
        support,
        required_support: requiredSupport,
        total,
      },
    });
  }

  const percent = total > 0 ? Math.round((support / total) * 10000) / 100 : 0;

  return {
    experiment: updated,
    approved,
    progress: {
      responded: support,
      total,
      percent,
      required: requiredSupport,
      approvalRunId,
    },
  };
}

// ─── join / leave / complete ────────────────────────────────────

// P3: убран мёртвый if — entity-слой сам бросает ConflictError.
export async function joinExperiment(
  experimentId: UUID,
  participantId: UUID,
): Promise<Experiment> {
  const plan = await getExperiment(experimentId);
  // entity.joinExperiment сам бросает ConflictError, если participant уже
  // в списке (см. C.0.30.01). Никакой доп. проверки здесь не нужно.
  const updated = entityJoinExperiment(plan, participantId);

  await query(
    `UPDATE experimental_protocols
        SET participants = $2::jsonb
      WHERE id = $1`,
    [experimentId, JSON.stringify(updated.participants)],
  );

  await logAction({
    actorId: participantId,
    actorType: 'participant',
    action: 'experiment.joined',
    entityType: 'experimental_protocol',
    entityId: experimentId,
  });

  return updated;
}

export async function leaveExperiment(
  experimentId: UUID,
  participantId: UUID,
): Promise<Experiment> {
  const plan = await getExperiment(experimentId);
  const updated = entityLeaveExperiment(plan, participantId);

  await query(
    `UPDATE experimental_protocols
        SET participants = $2::jsonb
      WHERE id = $1`,
    [experimentId, JSON.stringify(updated.participants)],
  );

  await logAction({
    actorId: participantId,
    actorType: 'participant',
    action: 'experiment.left',
    entityType: 'experimental_protocol',
    entityId: experimentId,
  });

  return updated;
}

export async function completeExperiment(
  experimentId: UUID,
  requesterId: UUID,
): Promise<Experiment> {
  const plan = await getExperiment(experimentId);
  const updated = entityCompleteExperiment(plan);

  await query(
    `UPDATE experimental_protocols
        SET status = 'completed', finished_at = now()
      WHERE id = $1`,
    [experimentId],
  );

  // Best-effort: публикация в архив.
  await bestEffort('archive.archiveService', async () => {
    const mod = await import('../archive/service.js');
    const archiveService = mod.archiveService;
    if (typeof archiveService === 'function') {
      const dir = await queryOne<{ id: string }>(
        `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
      );
      if (dir) {
        await archiveService(
          {
            type: 'report',
            directionId: dir.id,
            subject: `Experiment ${plan.externalId} completed`,
            content: {
              experimentId: plan.id,
              externalId: plan.externalId,
              goal: plan.goal,
              participantsCount: plan.participants.length,
              finishedAt: new Date().toISOString(),
            },
          },
          requesterId,
        );
      }
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'experiment.completed',
    entityType: 'experimental_protocol',
    entityId: experimentId,
  });

  return updated;
}

// ─── recordResults / getResults ────────────────────────────────

export interface RecordResultsInput {
  successes: string[];
  failures: string[];
  stats: Record<string, unknown>;
}

// P5: cancelled → 409 (результатов быть не может). completed — разрешён
// (финальный отчёт перед архивацией). filed/active — разрешены.
export async function recordResults(
  protocolId: UUID,
  input: RecordResultsInput,
  requesterId: UUID,
): Promise<ExperimentResults> {
  const plan = await getExperiment(protocolId);
  if (plan.status === 'cancelled') {
    throw new ConflictError(
      'Эксперимент отменён — запись результатов недоступна',
    );
  }
  // completed — разрешено: результаты могут публиковаться после завершения
  // (например, финальный отчёт перед архивацией).

  const entity = entityRecordResults({
    id: newUUID(),
    protocolId,
    successes: input.successes,
    failures: input.failures,
    stats: input.stats,
  });

  await query(
    `INSERT INTO experiment_results
       (id, protocol_id, successes, failures, stats, published)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, false)`,
    [
      entity.id,
      entity.protocolId,
      JSON.stringify(entity.successes),
      JSON.stringify(entity.failures),
      JSON.stringify(entity.stats),
    ],
  );

  // Best-effort: публикация в архив.
  await bestEffort('archive.archiveService (results)', async () => {
    const mod = await import('../archive/service.js');
    const archiveService = mod.archiveService;
    if (typeof archiveService === 'function') {
      const dir = await queryOne<{ id: string }>(
        `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
      );
      if (dir) {
        await archiveService(
          {
            type: 'report',
            directionId: dir.id,
            subject: `Experiment ${plan.externalId} results`,
            content: {
              experimentId: plan.id,
              successes: entity.successes,
              failures: entity.failures,
              stats: entity.stats,
            },
          },
          requesterId,
        );
      }
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'experiment.results_recorded',
    entityType: 'experiment_results',
    entityId: entity.id,
    newValue: {
      protocol_id: protocolId,
      successes_count: entity.successes.length,
      failures_count: entity.failures.length,
    },
  });

  return entity;
}

export async function getResults(
  protocolId: UUID,
  _requesterId?: UUID,
): Promise<ExperimentResults | null> {
  const row = await queryOne<ResultsRow>(
    `SELECT id, protocol_id, successes, failures, stats, published, created_at
       FROM experiment_results
      WHERE protocol_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [protocolId],
  );
  return row ? rowToResults(row) : null;
}

// ─── Диссидентские проекты ──────────────────────────────────────

export interface CreateDissidentServiceInput {
  description: string;
}

export async function createDissident(
  input: CreateDissidentServiceInput,
  requesterId: UUID,
): Promise<DissidentProject> {
  const entity = entityCreateDissident({
    id: newUUID(),
    initiatorId: requesterId,
    description: input.description,
  });

  await query(
    `INSERT INTO dissident_projects
       (id, initiator_id, description, petition_count, required_percent,
        resource_source, status, report_interval_days, last_report_at)
     VALUES ($1, $2, $3, 0, 1.0, 'deferred_flow', 'filed', $4, NULL)`,
    [
      entity.id,
      entity.initiatorId,
      entity.description,
      entity.reportIntervalDays,
    ],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'dissident.created',
    entityType: 'dissident_project',
    entityId: entity.id,
  });

  return entity;
}

export interface DissidentFilter {
  status?: DissidentStatus;
  page?: number;
  perPage?: number;
}

export async function listDissidents(
  filter: DissidentFilter = {},
  _requesterId?: UUID,
): Promise<{ data: DissidentProject[]; total: number }> {
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
    `SELECT COUNT(*)::text AS total FROM dissident_projects ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<DissidentRow>(
    `SELECT ${DISSIDENT_COLS}
       FROM dissident_projects
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToDissident), total };
}

export async function getDissident(
  projectId: UUID,
  _requesterId?: UUID,
): Promise<DissidentProject> {
  const row = await queryOne<DissidentRow>(
    `SELECT ${DISSIDENT_COLS} FROM dissident_projects WHERE id = $1`,
    [projectId],
  );
  if (!row) {throw new NotFoundError('Диссидентский проект', projectId);}
  return rowToDissident(row);
}

export async function signPetition(
  projectId: UUID,
  requesterId: UUID,
): Promise<DissidentProject> {
  const project = await getDissident(projectId);
  const updated = entitySignPetition(project);

  const totalParticipants = await countActiveParticipants();
  const enough = hasEnoughSignatures(updated, totalParticipants);
  const newSource = enough
    ? entityResourceSourceFor(updated, totalParticipants)
    : updated.resourceSource;

  await query(
    `UPDATE dissident_projects
        SET petition_count = $2, resource_source = $3,
            status = CASE WHEN $4::boolean AND status = 'filed'
                          THEN 'active' ELSE status END
      WHERE id = $1`,
    [projectId, updated.petitionCount, newSource, enough],
  );

  // Best-effort: запрос финансирования из Flows.
  if (enough) {
    await bestEffort('flows.requestFunding', async () => {
      const flowsMod = (await import('../flows/service.js')) as Record<
        string,
        unknown
      >;
      const requestFunding = flowsMod['requestFunding'];
      if (typeof requestFunding === 'function') {
        await (
          requestFunding as (
            projectId: UUID,
            source: string,
            by: UUID,
          ) => Promise<unknown>
        )(projectId, newSource, requesterId);
      } else {
        logger.info(
          { projectId, source: newSource },
          'dissident: flows.requestFunding not available, skipping',
        );
      }
    });
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'dissident.petition',
    entityType: 'dissident_project',
    entityId: projectId,
    newValue: {
      petition_count: updated.petitionCount,
      enough,
      resource_source: newSource,
    },
  });

  return {
    ...updated,
    status: enough && project.status === 'filed' ? 'active' : project.status,
    resourceSource: newSource,
  };
}

export async function reportDissident(
  projectId: UUID,
  content: string,
  requesterId: UUID,
): Promise<DissidentProject> {
  const project = await getDissident(projectId);
  if (!content || !content.trim()) {
    throw new ValidationError('content обязателен');
  }

  const now = new Date();
  const { nextReportAt } = entityReportDissident(project, now);

  await query(
    `UPDATE dissident_projects
        SET last_report_at = now(),
            status = CASE WHEN status = 'suspended' THEN 'active' ELSE status END
      WHERE id = $1`,
    [projectId],
  );

  // Best-effort: запись отчёта в архив.
  await bestEffort('archive.archiveService (dissident report)', async () => {
    const mod = await import('../archive/service.js');
    const archiveService = mod.archiveService;
    if (typeof archiveService === 'function') {
      const dir = await queryOne<{ id: string }>(
        `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
      );
      if (dir) {
        await archiveService(
          {
            type: 'report',
            directionId: dir.id,
            subject: `Dissident project ${projectId.slice(0, 8)} report`,
            content: {
              projectId,
              content,
              reportedAt: now.toISOString(),
              nextReportAt,
            },
          },
          requesterId,
        );
      }
    }
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'dissident.report',
    entityType: 'dissident_project',
    entityId: projectId,
    newValue: { next_report_at: nextReportAt },
  });

  return getDissident(projectId);
}

export async function reviewDissident(
  projectId: UUID,
  requesterId: UUID,
): Promise<DissidentProject> {
  const project = await getDissident(projectId);
  if (!entityCanReview(project)) {
    throw new ConflictError(
      'Пересмотр доступен только через 2 года после создания (I.1.8.10)',
    );
  }
  if (project.status === 'closed') {
    throw new ConflictError('Проект уже закрыт');
  }

  await query(
    `UPDATE dissident_projects
        SET status = 'reviewed', closed_at = now()
      WHERE id = $1`,
    [projectId],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'dissident.reviewed',
    entityType: 'dissident_project',
    entityId: projectId,
  });

  return getDissident(projectId);
}

export async function resourceSourceFor(
  projectId: UUID,
): Promise<{ source: DissidentResourceSource }> {
  const row = await queryOne<{ resource_source: DissidentResourceSource }>(
    `SELECT resource_source FROM dissident_projects WHERE id = $1`,
    [projectId],
  );
  if (!row) {throw new NotFoundError('Диссидентский проект', projectId);}
  return { source: row.resource_source };
}

// ─── Cron: process-suspensions ─────────────────────────────────

export async function processSuspensions(): Promise<{
  suspended: number;
  checked: number;
}> {
  const rows = await query<DissidentRow>(
    `SELECT ${DISSIDENT_COLS}
       FROM dissident_projects
      WHERE status = 'active'
      ORDER BY created_at ASC
      LIMIT 1000`,
  );

  let suspended = 0;
  for (const r of rows) {
    const project = rowToDissident(r);
    if (entityShouldSuspend(project)) {
      await query(
        `UPDATE dissident_projects SET status = 'suspended' WHERE id = $1`,
        [project.id],
      );
      await logAction({
        actorId: null,
        actorType: 'system',
        action: 'dissident.suspended',
        entityType: 'dissident_project',
        entityId: project.id,
        newValue: {
          last_report_at: project.lastReportAt,
          interval_days: DISSIDENT_REPORT_INTERVAL_DAYS,
        },
      });
      suspended += 1;
    }
  }

  return { suspended, checked: rows.length };
}

export async function shouldSuspend(
  projectId: UUID,
): Promise<boolean> {
  const project = await getDissident(projectId);
  return entityShouldSuspend(project);
}

// ─── checkExpiration ───────────────────────────────────────────

/**
 * Проверка истечения срока эксперимента. Возвращает true, если
 * termDays истёк с момента createdAt. Используется как утилита —
 * для cron-задач, если понадобится.
 */
export async function checkExpiration(
  protocolId: UUID,
): Promise<boolean> {
  const plan = await getExperiment(protocolId);
  const created = new Date(plan.createdAt).getTime();
  const termMs = plan.termDays * 86_400_000;
  return Date.now() - created > termMs;
}

// ─── Экспорт для контроллера ──────────────────────────────────

export { EXPERIMENT_APPROVAL_PCT, DISSIDENT_REPORT_INTERVAL_DAYS };