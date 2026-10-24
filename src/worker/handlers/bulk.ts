// I.9.07.04 — Bulk handlers.
// 5 handler'ов. Каждый: resolve/work с updateProgress → S3 upload → complete.
// Ошибки отдельных операций — в report.errors (батч НЕ откатывается).
// Катастрофические ошибки (resolve, upload) — throw → outer catch → fail(job).

import {
  formatReportKey,
  MAX_RESOLVED_RECIPIENTS,
  type BulkReport,
  type BulkRecipients,
} from '../../core/bulk/entity.js';
import { ForbiddenError, ValidationError } from '../../core/errors.js';
import {
  isExportType,
  type ExportFormat,
  type ExportType,
} from '../../core/exports/entity.js';
import { createExport } from '../../core/exports/service.js';
import { charge } from '../../core/flows/service.js';
import { hasConflict } from '../../core/mandates/entity.js';
import { createMandateService } from '../../core/mandates/service.js';
import { listParticipants } from '../../core/participants/service.js';
import { Role, isRoleValid } from '../../core/roles.js';
import { assignTaskService } from '../../core/tasks/service.js';
import type { FlowType, UUID } from '../../core/types.js';
import { query, queryOne } from '../../lib/db.js';
import {
  complete,
  updateProgress,
  type Job,
} from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import {
  sendBulk,
  type NotificationChannel,
  type NotificationPayload,
  type NotificationPriority,
} from '../../lib/notifications.js';
import { upload } from '../../lib/s3.js';
import { getEffectiveRoles, listParticipantsWithRole } from '../../security/rbac.js';

// ─── Общие хелперы ──────────────────────────────────────────────

async function writeReport(job: Job, report: BulkReport): Promise<void> {
  await updateProgress(job.id, 90);
  const key = formatReportKey(job.id);
  await upload(
    key,
    Buffer.from(JSON.stringify(report), 'utf8'),
    'application/json',
    'archive',
  );
  await complete(job.id, key);
  logger.info(
    {
      jobId: job.id,
      processed: report.processed,
      succeeded: report.succeeded,
      failed: report.failed,
    },
    'bulk: report uploaded',
  );
}

function progressStep(processed: number, total: number): number {
  if (total === 0) {return 90;}
  return Math.min(90, 5 + Math.floor((processed / total) * 85));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── bulk.notify ────────────────────────────────────────────────

interface NotifyPayload {
  recipients: BulkRecipients;
  payload: {
    type: string;
    priority: NotificationPriority;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    channels?: NotificationChannel[];
    persist?: boolean;
  };
  dryRun: boolean;
  requesterId: UUID;
}

async function resolveRecipients(
  recipients: BulkRecipients,
  requesterId: UUID,
): Promise<UUID[]> {
  // { ids } — как есть
  if (recipients.ids) {return recipients.ids;}

  // { directionId, role } / { role } — через listParticipantsWithRole
  if (recipients.role) {
    if (!isRoleValid(recipients.role)) {
      throw new ValidationError(`Неизвестная роль: ${recipients.role}`);
    }
    return await listParticipantsWithRole(
      recipients.role as Role,
      recipients.directionId,
    );
  }

  // { directionId } — все участники направления (пагинация до лимита)
  if (recipients.directionId) {
    const ids: UUID[] = [];
    const perPage = 200;
    let page = 1;
    while (ids.length < MAX_RESOLVED_RECIPIENTS) {
      const res = await listParticipants(
        { directionId: recipients.directionId, page, perPage },
        requesterId,
      );
      if (res.data.length === 0) {break;}
      for (const p of res.data) {ids.push(p.id);}
      if (res.data.length < perPage) {break;}
      page++;
    }
    return ids;
  }

  return [];
}

export async function handleBulkNotify(job: Job): Promise<void> {
  const p = job.payload as unknown as NotifyPayload;

  await updateProgress(job.id, 5);
  const recipientIds = await resolveRecipients(p.recipients, p.requesterId);

  if (recipientIds.length > MAX_RESOLVED_RECIPIENTS) {
    throw new ValidationError(
      `Слишком много получателей: ${recipientIds.length} > ${MAX_RESOLVED_RECIPIENTS}`,
    );
  }

  await updateProgress(job.id, 10);

  const notifPayloads: NotificationPayload[] = recipientIds.map((rid) => ({
    recipientId: rid,
    type: p.payload.type,
    priority: p.payload.priority,
    title: p.payload.title,
    body: p.payload.body,
    ...(p.payload.data ? { data: p.payload.data } : {}),
    ...(p.payload.channels ? { channels: p.payload.channels } : {}),
    ...(p.payload.persist !== undefined ? { persist: p.payload.persist } : {}),
  }));

  const { delivered, failed } = await sendBulk(notifPayloads);

  const report: BulkReport = {
    processed: recipientIds.length,
    succeeded: delivered,
    failed,
    // sendBulk не даёт per-error деталей — только агрегаты.
    errors: [],
  };

  await writeReport(job, report);
}

// ─── bulk.tasks.assign ──────────────────────────────────────────

interface TasksAssignPayload {
  task_ids: UUID[];
  participant_ids: UUID[];
  requesterId: UUID;
}

export async function handleBulkTasksAssign(job: Job): Promise<void> {
  const p = job.payload as unknown as TasksAssignPayload;
  const n = p.task_ids.length;

  const report: BulkReport = {
    processed: n,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  await updateProgress(job.id, 5);

  for (let i = 0; i < n; i++) {
    const taskId = p.task_ids[i];
    const participantId = p.participant_ids[i];
    if (taskId === undefined || participantId === undefined) {continue;}

    try {
      await assignTaskService(taskId, participantId, p.requesterId);
      report.succeeded++;
    } catch (e) {
      report.failed++;
      report.errors.push({ index: i, id: taskId, message: errMessage(e) });
    }
    if ((i + 1) % 100 === 0 || i === n - 1) {
      await updateProgress(job.id, progressStep(i + 1, n));
    }
  }

  await writeReport(job, report);
}

// ─── bulk.flows.charge ──────────────────────────────────────────

interface FlowsChargePayload {
  participant_ids: UUID[];
  type: string;
  amount: number;
  reason: string;
  requesterId: UUID;
}

export async function handleBulkFlowsCharge(job: Job): Promise<void> {
  const p = job.payload as unknown as FlowsChargePayload;
  const n = p.participant_ids.length;

  const report: BulkReport = {
    processed: n,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  await updateProgress(job.id, 5);

  for (let i = 0; i < n; i++) {
    const pid = p.participant_ids[i];
    if (pid === undefined) {continue;}

    try {
      // source='bulk' — новая категория; cast, если union в ChargeInput
      // не содержит 'bulk' (согласовать при правках C.0.14.01).
      await charge(
        {
          participantId: pid,
          type: p.type as FlowType,
          amount: p.amount,
          reason: p.reason,
          source: 'bulk',
        } as Parameters<typeof charge>[0],
        p.requesterId,
      );
      report.succeeded++;
    } catch (e) {
      report.failed++;
      report.errors.push({ index: i, id: pid, message: errMessage(e) });
    }
    if ((i + 1) % 100 === 0 || i === n - 1) {
      await updateProgress(job.id, progressStep(i + 1, n));
    }
  }

  await writeReport(job, report);
}

// ─── bulk.roles.grant ───────────────────────────────────────────

interface RolesGrantPayload {
  participant_ids: UUID[];
  role: string;
  direction_id: UUID;
  expires_at: string;
  dryRun: boolean;
  requesterId: UUID;
}

export async function handleBulkRolesGrant(job: Job): Promise<void> {
  const p = job.payload as unknown as RolesGrantPayload;

  // 1. assertArchitect (defense-in-depth)
  const roles = await getEffectiveRoles(p.requesterId);
  if (!roles.includes(Role.FIRST_ARCHITECT)) {
    throw new ForbiddenError(
      'Только FIRST_ARCHITECT может выдавать роли через bulk',
    );
  }

  const n = p.participant_ids.length;
  const report: BulkReport = {
    processed: n,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  await updateProgress(job.id, 5);

  if (p.dryRun) {
    let toGrant = 0;
    let conflicts = 0;
    let cooldowns = 0;

    for (let i = 0; i < n; i++) {
      const pid = p.participant_ids[i];
      if (pid === undefined) {continue;}

      try {
        // hasConflict с активными мандатами
        const active = await query<{ function: string }>(
          `SELECT function FROM mandates WHERE holder_id = $1 AND status = 'active'`,
          [pid],
        );
        let conflicted = false;
        for (const m of active) {
          if (hasConflict(m.function, p.role)) {
            conflicted = true;
            break;
          }
        }
        if (conflicted) {
          conflicts++;
          report.errors.push({ index: i, id: pid, message: 'Конфликт ролей' });
          continue;
        }

        // cooldown
        const cd = await queryOne<{ valid_to: Date }>(
          `SELECT valid_to FROM cooldowns
            WHERE participant_id = $1 AND reason LIKE $2 AND valid_to > now()
            LIMIT 1`,
          [pid, `rotation:${p.role}%`],
        );
        if (cd) {
          cooldowns++;
          report.errors.push({ index: i, id: pid, message: 'Cooldown активен' });
          continue;
        }

        toGrant++;
      } catch (e) {
        report.errors.push({ index: i, id: pid, message: errMessage(e) });
      }
      if ((i + 1) % 100 === 0 || i === n - 1) {
        await updateProgress(job.id, progressStep(i + 1, n));
      }
    }

    report.succeeded = toGrant;
    report.failed = conflicts + cooldowns;
    report.preview = { toGrant, conflicts, cooldowns };
  } else {
    for (let i = 0; i < n; i++) {
      const pid = p.participant_ids[i];
      if (pid === undefined) {continue;}

      try {
        await createMandateService(
          {
            function: p.role,
            holderId: pid,
            directionId: p.direction_id,
            expiresAt: p.expires_at,
          },
          p.requesterId,
        );
        report.succeeded++;
      } catch (e) {
        report.failed++;
        report.errors.push({ index: i, id: pid, message: errMessage(e) });
      }
      if ((i + 1) % 100 === 0 || i === n - 1) {
        await updateProgress(job.id, progressStep(i + 1, n));
      }
    }
  }

  await writeReport(job, report);
}

// ─── bulk.export ────────────────────────────────────────────────

interface ExportPayload {
  types: string[];
  format: ExportFormat;
  requesterId: UUID;
}

export async function handleBulkExport(job: Job): Promise<void> {
  const p = job.payload as unknown as ExportPayload;
  const types = p.types;

  const exportJobIds: UUID[] = [];
  const report: BulkReport = {
    processed: types.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  await updateProgress(job.id, 5);

  // Promise.allSettled: createExport проверяет лимит 3 активных job'ов.
  // Параллельный запуск позволяет всем 5 пройти проверку до первого INSERT
  // (best-effort; если рейс не удался — часть уйдёт в errors).
  const results = await Promise.allSettled(
    types.map((t) => {
      if (!isExportType(t)) {
        return Promise.reject(new Error(`Неизвестный тип экспорта: ${t}`));
      }
      return createExport(
        t as ExportType,
        { format: p.format, filter: {} },
        p.requesterId,
      );
    }),
  );

  results.forEach((r, i) => {
    const t = types[i] ?? '';
    if (r.status === 'fulfilled') {
      report.succeeded++;
      exportJobIds.push(r.value.jobId);
    } else {
      report.failed++;
      report.errors.push({
        index: i,
        id: t,
        message: errMessage(r.reason),
      });
    }
  });

  report.exportJobIds = exportJobIds;

  await writeReport(job, report);
}