// C.0.32.02 — Сервис Автоматизации.
// Очередь решений ИИ, утверждение/отклонение, участки, аудит операторов.
//
// Хартия I.6.15: оператор утверждает типовые запросы ИИ, фиксирует
// причину отклонения, может отключить автоматизацию в любой момент.
// III.1.13: > 95% утверждений → аудит; > 3 ошибок/мес → отстранение.
//
// Связь с Balance (III.1) — best-effort: при approvalRate > 0.95
// регистрируется competence_risk 'operator_routine_dependency'.
//
// v0.0.02:
//   - P6:  approveDecision — atomic UPDATE WHERE status IN ('pending','deferred').
//   - P7:  rejectDecision — atomic UPDATE WHERE status IN ('pending','deferred').
//   - P8:  deferDecision — atomic UPDATE WHERE status = 'pending'.
//   - P9:  disableSection — atomic UPDATE WHERE enabled = true.
//   - P10: runDailyAudit — transaction: disable sections + revoke mandates.
//   - P11: удалён dead-code QueueFilter.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { logAction } from '../audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors.js';
import { Role, getTermPolicy } from '../roles.js';
import type { UUID, ISODateTime } from '../types.js';

import {
  createDecision as entityCreateDecision,
  approveDecision as entityApproveDecision,
  rejectDecision as entityRejectDecision,
  deferDecision as entityDeferDecision,
  createSection as entityCreateSection,
  disableSection as entityDisableSection,
  auditOperator as entityAuditOperator,
  canBeOperator,
  canCombineWith,
  shouldAudit,
  shouldRemove,
  type AutomationDecision,
  type AutomationDecisionStatus,
  type AutomationSection,
  type OperatorAudit,
  type AiRecommendation,
} from './entity.js';

// ─── Best-effort helper ──────────────────────────────────────────

async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `automation: ${label} failed (best-effort)`);
  }
}

// ─── Row-mapping ─────────────────────────────────────────────────

interface DecisionRow {
  id: string;
  type: string;
  content: Record<string, unknown>;
  ai_recommendation: AiRecommendation;
  deadline: Date;
  status: AutomationDecisionStatus;
  rejection_reason: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

function rowToDecision(r: DecisionRow): AutomationDecision {
  return {
    id: r.id,
    type: r.type,
    content: r.content ?? {},
    aiRecommendation: r.ai_recommendation,
    deadline: r.deadline.toISOString(),
    status: r.status,
    rejectionReason: r.rejection_reason,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

interface SectionRow {
  id: string;
  direction_id: string;
  enabled: boolean;
  operator_id: string | null;
  disabled_at: Date | null;
  disable_reason: string | null;
  created_at: Date;
}

function rowToSection(r: SectionRow): AutomationSection {
  return {
    id: r.id,
    directionId: r.direction_id,
    enabled: r.enabled,
    operatorId: r.operator_id,
    disabledAt: r.disabled_at ? r.disabled_at.toISOString() : null,
    disableReason: r.disable_reason,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Очередь решений ─────────────────────────────────────────────

// Оператор видит только pending-решения своего участка.
export async function getQueue(
  operatorId: UUID,
  requesterId: UUID,
): Promise<AutomationDecision[]> {
  void requesterId; // зарезервировано под фильтрацию по правам

  // Находим участки, где оператор — активный operator_id.
  const sections = await query<{ direction_id: string }>(
    `SELECT direction_id FROM automation_sections
      WHERE operator_id = $1 AND enabled = true`,
    [operatorId],
  );
  if (sections.length === 0) {
    return [];
  }

  // Решения без явной привязки к section — берём все pending, у которых
  // content->>'direction_id' попадает в направления оператора.
  const directionIds = sections.map((s) => s.direction_id);

  const rows = await query<DecisionRow>(
    `SELECT id, type, content, ai_recommendation, deadline, status,
            rejection_reason, decided_by, decided_at, created_at
       FROM automation_decisions
      WHERE status IN ('pending', 'deferred')
        AND (content->>'direction_id') = ANY($1::text[])
      ORDER BY
        CASE ai_recommendation WHEN 'approve' THEN 1 ELSE 2 END,
        deadline ASC
      LIMIT 200`,
    [directionIds],
  );
  return rows.map(rowToDecision);
}

// ─── Решения ─────────────────────────────────────────────────────

// P6: атомарный UPDATE с проверкой status. 0 rows → 409 (race-safe).
export async function approveDecision(
  decisionId: UUID,
  requesterId: UUID,
): Promise<AutomationDecision> {
  const row = await queryOne<DecisionRow>(
    `SELECT id, type, content, ai_recommendation, deadline, status,
            rejection_reason, decided_by, decided_at, created_at
       FROM automation_decisions WHERE id = $1`,
    [decisionId],
  );
  if (!row) { throw new NotFoundError('Решение', decisionId); }

  const updated = entityApproveDecision(rowToDecision(row), requesterId);

  const affected = await query<{ id: string }>(
    `UPDATE automation_decisions
        SET status = $2, decided_by = $3, decided_at = $4
      WHERE id = $1 AND status IN ('pending', 'deferred')
      RETURNING id`,
    [decisionId, updated.status, updated.decidedBy, updated.decidedAt],
  );
  if (affected.length === 0) {
    throw new ConflictError('Решение уже не в статусе pending/deferred');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.decision.approve',
    entityType: 'automation_decision',
    entityId: decisionId,
    newValue: { ai_recommendation: row.ai_recommendation },
  });

  return updated;
}

// P7: атомарный UPDATE с проверкой status. 0 rows → 409 (race-safe).
export async function rejectDecision(
  decisionId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<AutomationDecision> {
  const row = await queryOne<DecisionRow>(
    `SELECT id, type, content, ai_recommendation, deadline, status,
            rejection_reason, decided_by, decided_at, created_at
       FROM automation_decisions WHERE id = $1`,
    [decisionId],
  );
  if (!row) { throw new NotFoundError('Решение', decisionId); }

  const updated = entityRejectDecision(rowToDecision(row), reason, requesterId);

  const affected = await query<{ id: string }>(
    `UPDATE automation_decisions
        SET status = $2, rejection_reason = $3, decided_by = $4, decided_at = $5
      WHERE id = $1 AND status IN ('pending', 'deferred')
      RETURNING id`,
    [
      decisionId,
      updated.status,
      updated.rejectionReason,
      updated.decidedBy,
      updated.decidedAt,
    ],
  );
  if (affected.length === 0) {
    throw new ConflictError('Решение уже не в статусе pending/deferred');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.decision.reject',
    entityType: 'automation_decision',
    entityId: decisionId,
    newValue: { reason: updated.rejectionReason },
    reason: updated.rejectionReason ?? undefined,
  });

  return updated;
}

// P8: атомарный UPDATE с проверкой status = 'pending'. 0 rows → 409.
export async function deferDecision(
  decisionId: UUID,
  newDeadline: ISODateTime,
  requesterId: UUID,
): Promise<AutomationDecision> {
  const row = await queryOne<DecisionRow>(
    `SELECT id, type, content, ai_recommendation, deadline, status,
            rejection_reason, decided_by, decided_at, created_at
       FROM automation_decisions WHERE id = $1`,
    [decisionId],
  );
  if (!row) { throw new NotFoundError('Решение', decisionId); }

  const updated = entityDeferDecision(rowToDecision(row), newDeadline);

  const affected = await query<{ id: string }>(
    `UPDATE automation_decisions
        SET status = $2, deadline = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [decisionId, updated.status, updated.deadline],
  );
  if (affected.length === 0) {
    throw new ConflictError('Решение уже не в статусе pending');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.decision.defer',
    entityType: 'automation_decision',
    entityId: decisionId,
    newValue: { new_deadline: updated.deadline },
  });

  return updated;
}

// ─── Генерация решения (для ИИ-агентов) ──────────────────────────

export interface GenerateDecisionInput {
  type: string;
  content: Record<string, unknown>;
  aiRecommendation: AiRecommendation;
  deadline: ISODateTime;
}

export async function generateDecision(
  input: GenerateDecisionInput,
): Promise<AutomationDecision> {
  const entity = entityCreateDecision({
    id: newUUID(),
    type: input.type,
    content: input.content,
    aiRecommendation: input.aiRecommendation,
    deadline: input.deadline,
  });

  await query(
    `INSERT INTO automation_decisions
       (id, type, content, ai_recommendation, deadline, status)
     VALUES ($1, $2, $3::jsonb, $4, $5, 'pending')`,
    [
      entity.id,
      entity.type,
      JSON.stringify(entity.content),
      entity.aiRecommendation,
      entity.deadline,
    ],
  );

  // audit: actorType = 'ai', actorId = null.
  await logAction({
    actorId: null,
    actorType: 'ai',
    action: 'automation.decision.generate',
    entityType: 'automation_decision',
    entityId: entity.id,
    newValue: { type: entity.type, ai_recommendation: entity.aiRecommendation },
  });

  return entity;
}

// ─── Участки ─────────────────────────────────────────────────────

export async function getSection(
  sectionId: UUID,
  _requesterId: UUID,
): Promise<AutomationSection> {
  const row = await queryOne<SectionRow>(
    `SELECT id, direction_id, enabled, operator_id, disabled_at,
            disable_reason, created_at
       FROM automation_sections WHERE id = $1`,
    [sectionId],
  );
  if (!row) { throw new NotFoundError('Участок', sectionId); }
  return rowToSection(row);
}

export async function getSectionByDirection(
  directionId: UUID,
): Promise<AutomationSection | null> {
  const row = await queryOne<SectionRow>(
    `SELECT id, direction_id, enabled, operator_id, disabled_at,
            disable_reason, created_at
       FROM automation_sections WHERE direction_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [directionId],
  );
  return row ? rowToSection(row) : null;
}

export async function createSectionForDirection(
  directionId: UUID,
  requesterId: UUID,
): Promise<AutomationSection> {
  const existing = await getSectionByDirection(directionId);
  if (existing) {
    throw new ConflictError('Участок для этого направления уже существует', {
      sectionId: existing.id,
    });
  }

  const entity = entityCreateSection({ id: newUUID(), directionId });

  await query(
    `INSERT INTO automation_sections (id, direction_id, enabled)
     VALUES ($1, $2, true)`,
    [entity.id, entity.directionId],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.section.create',
    entityType: 'automation_section',
    entityId: entity.id,
    newValue: { direction_id: directionId },
  });

  return entity;
}

// Назначение оператора: проверка canBeOperator + canCombineWith +
// мандат 6 мес. × 2 срока (I.6.15.2) + cooldown 180 дней.
export async function assignOperator(
  sectionId: UUID,
  operatorId: UUID,
  requesterId: UUID,
): Promise<AutomationSection> {
  // 1. Кандидат: стаж + аттестация ИИ.
  const candidate = await queryOne<{
    entered_at: Date;
    ai_certified: boolean;
  }>(
    `SELECT p.entered_at,
            EXISTS(
              SELECT 1 FROM module_passes mp
               WHERE mp.participant_id = p.id
                 AND mp.module = 'ai_certification'
            ) AS ai_certified
       FROM participants p
      WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [operatorId],
  );
  if (!candidate) {
    throw new NotFoundError('Участник', operatorId);
  }
  const check = canBeOperator({
    enteredAt: candidate.entered_at.toISOString(),
    aiCertified: candidate.ai_certified,
  });
  if (!check.allowed) {
    throw new ValidationError(check.reason ?? 'Кандидат не может быть оператором');
  }

  // 2. Конфликты с активными ролями.
  const activeRoles = await query<{ role: string }>(
    `SELECT r.name AS role
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
      UNION
     SELECT m.function AS role
       FROM mandates m
      WHERE m.holder_id = $1
        AND m.status = 'active'
        AND m.expires_at > now()`,
    [operatorId],
  );
  for (const r of activeRoles) {
    if (!canCombineWith(r.role)) {
      throw new ConflictError(
        `OPERATOR не совмещается с ${r.role} (I.6.15.4)`,
        { conflict_role: r.role },
      );
    }
  }

  // 3. Мандат: 6 мес., не более 2 сроков, cooldown 180 дней.
  const policy = getTermPolicy(Role.OPERATOR);
  const termDays = policy.termDays ?? 180;
  const maxTerms = policy.maxTerms ?? 2;

  const pastTerms = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM mandates
      WHERE holder_id = $1 AND function = 'OPERATOR'`,
    [operatorId],
  );
  const termCount = parseInt(pastTerms?.cnt ?? '0', 10) + 1;
  if (maxTerms !== null && termCount > maxTerms) {
    throw new ConflictError(
      `Превышен лимит сроков OPERATOR (${maxTerms}), запрошен ${termCount} (I.6.15.2)`,
    );
  }

  const cooldown = await queryOne<{ valid_to: Date }>(
    `SELECT valid_to FROM cooldowns
      WHERE participant_id = $1
        AND reason LIKE 'rotation:OPERATOR%'
        AND valid_to > now()
      LIMIT 1`,
    [operatorId],
  );
  if (cooldown) {
    throw new ConflictError(
      `Участник в cooldown до ${cooldown.valid_to.toISOString()}`,
    );
  }

  // 4. Обновление участка + создание мандата.
  const expiresAt = new Date(
    Date.now() + termDays * 86_400_000,
  ).toISOString();

  await transaction(async (client) => {
    await client.query(
      `UPDATE automation_sections
          SET operator_id = $2, enabled = true,
              disabled_at = NULL, disable_reason = NULL
        WHERE id = $1`,
      [sectionId, operatorId],
    );
    await client.query(
      `INSERT INTO mandates
         (id, function, direction_id, holder_id, granted_by, expires_at, status)
       VALUES ($1, 'OPERATOR', NULL, $2, $3, $4, 'active')`,
      [newUUID(), operatorId, requesterId, expiresAt],
    );
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.operator.assign',
    entityType: 'automation_section',
    entityId: sectionId,
    newValue: { operator_id: operatorId, expires_at: expiresAt },
  });

  return getSection(sectionId, requesterId);
}

// P9: атомарный UPDATE с проверкой enabled = true. 0 rows → 409.
export async function disableSection(
  sectionId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<AutomationSection> {
  const section = await getSection(sectionId, requesterId);
  const updated = entityDisableSection(section, reason);

  const affected = await query<{ id: string }>(
    `UPDATE automation_sections
        SET enabled = false, disabled_at = $2, disable_reason = $3
      WHERE id = $1 AND enabled = true
      RETURNING id`,
    [sectionId, updated.disabledAt, updated.disableReason],
  );
  if (affected.length === 0) {
    throw new ConflictError('Участок уже отключён');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.section.disable',
    entityType: 'automation_section',
    entityId: sectionId,
    newValue: { reason: updated.disableReason },
  });

  return updated;
}

// ─── Аудит оператора ─────────────────────────────────────────────

export async function auditOperator(
  operatorId: UUID,
  requesterId: UUID,
): Promise<OperatorAudit> {
  // Решения за последние 3 месяца.
  const decisions = await query<DecisionRow>(
    `SELECT id, type, content, ai_recommendation, deadline, status,
            rejection_reason, decided_by, decided_at, created_at
       FROM automation_decisions
      WHERE decided_by = $1
        AND decided_at > now() - interval '3 months'
      LIMIT 1000`,
    [operatorId],
  );

  // Ошибки за последний месяц: решения, отклонённые, но потом
  // признанные верными (упрощённо — здесь нет поля 'error',
  // используем маркер в content->>'error' === 'true').
  const errorRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM automation_decisions
      WHERE decided_by = $1
        AND decided_at > now() - interval '1 month'
        AND (content->>'error') = 'true'`,
    [operatorId],
  );
  const errorCount = parseInt(errorRow?.cnt ?? '0', 10);

  const entity = entityAuditOperator({
    id: newUUID(),
    operatorId,
    decisions: decisions.map(rowToDecision),
    errorCount,
  });

  await query(
    `INSERT INTO operator_audits
       (id, operator_id, approval_rate, error_count, status, recommendations)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      entity.id,
      entity.operatorId,
      entity.approvalRate,
      entity.errorCount,
      entity.status,
      JSON.stringify(entity.recommendations),
    ],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'automation.operator.audit',
    entityType: 'operator_audit',
    entityId: entity.id,
    newValue: {
      operator_id: operatorId,
      approval_rate: entity.approvalRate,
      error_count: entity.errorCount,
      status: entity.status,
    },
  });

  // III.1.13а → Balance (best-effort).
  if (shouldAudit(entity.approvalRate)) {
    await bestEffort('balance.addCompetenceRisk', async () => {
      const { addCompetenceRisk } = await import('../balance/service.js');
      // Направление оператора — из его основного участка.
      const dir = await queryOne<{ direction_id: string }>(
        `SELECT direction_id FROM participants WHERE id = $1`,
        [operatorId],
      );
      if (dir) {
        await addCompetenceRisk(
          dir.direction_id,
          'operator_routine_dependency',
          requesterId,
        );
      }
    });
  }

  return entity;
}

export async function shouldAuditOperator(
  operatorId: UUID,
): Promise<boolean> {
  const row = await queryOne<{ approval_rate: string }>(
    `SELECT (approved::float / NULLIF(total, 0))::text AS approval_rate
       FROM (
         SELECT
           COUNT(*) FILTER (WHERE status = 'approved') AS approved,
           COUNT(*) AS total
           FROM automation_decisions
          WHERE decided_by = $1
            AND decided_at > now() - interval '3 months'
       ) t`,
    [operatorId],
  );
  const rate = parseFloat(row?.approval_rate ?? '0');
  return shouldAudit(rate);
}

export async function shouldRemoveOperator(
  operatorId: UUID,
): Promise<boolean> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM automation_decisions
      WHERE decided_by = $1
        AND decided_at > now() - interval '1 month'
        AND (content->>'error') = 'true'`,
    [operatorId],
  );
  return shouldRemove(parseInt(row?.cnt ?? '0', 10));
}

export async function checkCombineWith(
  operatorId: UUID,
  role: string,
): Promise<boolean> {
  void operatorId; // контракт для симметрии с entity
  return canCombineWith(role);
}

// ─── Cron: runDailyAudit ─────────────────────────────────────────

export async function runDailyAudit(): Promise<{
  audited: number;
  removed: number;
}> {
  // Все активные операторы.
  const operators = await query<{ operator_id: string }>(
    `SELECT DISTINCT operator_id
       FROM automation_sections
      WHERE operator_id IS NOT NULL AND enabled = true`,
  );

  let audited = 0;
  let removed = 0;

  for (const { operator_id } of operators) {
    try {
      // requesterId = operator_id (для audit), но logAction пометит system —
      // см. комментарий в auditOperator. В идеале нужно разделить:
      // actorId для logAction = null (system), а operatorId — параметр аудита.
      // Пока оставляем так — auditOperator сам логирует actorId=requesterId.
      const audit = await auditOperator(operator_id, operator_id);
      audited += 1;
      if (audit.status === 'removed') {
        removed += 1;
        // P10: Отключаем все участки + закрываем активные мандаты OPERATOR
        // в одной транзакции (атомарно — иначе оператор останется без
        // участков, но с активным мандатом, или наоборот).
        await transaction(async (client) => {
          await client.query(
            `UPDATE automation_sections
                SET enabled = false,
                    disabled_at = now(),
                    disable_reason = 'auto:operator_removed (III.1.13б)'
              WHERE operator_id = $1 AND enabled = true`,
            [operator_id],
          );
          await client.query(
            `UPDATE mandates
                SET status = 'revoked'
              WHERE holder_id = $1
                AND function = 'OPERATOR'
                AND status = 'active'`,
            [operator_id],
          );
        });
        logger.warn(
          { operatorId: operator_id, errorCount: audit.errorCount },
          'automation: operator removed by daily audit',
        );
      }
    } catch (e) {
      logger.warn(
        { err: e, operatorId: operator_id },
        'automation: runDailyAudit per-operator failed',
      );
    }
  }

  // entityId — реальный UUID (не zero): logAction в C.0.01.05 валидирует
  // существование entityId, zero-UUID может быть пропущен.
  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'automation.run_daily_audit',
    entityType: 'operator_audit_batch',
    entityId: newUUID(),
    newValue: { audited, removed },
  });

  return { audited, removed };
}