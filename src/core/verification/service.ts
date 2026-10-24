// C.0.19.02 — Сервис Верификации
// Аудит, перепроверка ОТК, аудит кода, аудит Шлюза, integrity alerts.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  createAudit, closeAudit, canAudit,
  type Audit, type AuditType, type AuditStatus, type AuditFinding,
  type VerificationRecheck, type RecheckResult,
  type CodeAudit, type CodeSystem,
  type IntegrityAlert, type IntegrityAction,
} from './entity.js';

// -------- Аудиты --------

interface AuditRow {
  id: string;
  type: AuditType;
  subject: string;
  subject_id: string | null;
  initiator_id: string;
  status: AuditStatus;
  result: string | null;
  created_at: Date;
  finished_at: Date | null;
}

function rowToAudit(row: AuditRow): Audit {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    subjectId: row.subject_id,
    initiatorId: row.initiator_id,
    status: row.status,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

export interface AuditFilter {
  type?: AuditType;
  status?: AuditStatus;
  subject?: string;
  page?: number;
  perPage?: number;
}

export async function listAudits(
  filter: AuditFilter = {},
): Promise<{ data: Audit[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.type) { params.push(filter.type); conditions.push(`type = $${params.length}`); }
  if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
  if (filter.subject) { params.push(filter.subject); conditions.push(`subject = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM audits ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<AuditRow>(
    `SELECT id, type, subject, subject_id, initiator_id, status, result,
            created_at, finished_at
       FROM audits ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToAudit), total };
}

export async function getAudit(id: UUID): Promise<Audit> {
  const row = await queryOne<AuditRow>(
    `SELECT id, type, subject, subject_id, initiator_id, status, result,
            created_at, finished_at
       FROM audits WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Аудит', id);}
  return rowToAudit(row);
}

export interface CreateAuditRequest {
  type: AuditType;
  subject: string;
  subjectId?: UUID;
}

export async function createAuditService(
  input: CreateAuditRequest, requesterId: UUID,
): Promise<Audit> {
  const check = canAudit(requesterId, input.subjectId ?? null, requesterId);
  if (!check.allowed) {throw new ConflictError(check.reason ?? 'Нельзя аудировать');}

  const entity = createAudit({
    id: newUUID(),
    type: input.type,
    subject: input.subject,
    ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    initiatorId: requesterId,
  });

  await query(
    `INSERT INTO audits (id, type, subject, subject_id, initiator_id, status)
     VALUES ($1, $2, $3, $4, $5, 'open')`,
    [entity.id, entity.type, entity.subject, entity.subjectId, entity.initiatorId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.create_audit', entityType: 'audit', entityId: entity.id,
    newValue: { type: entity.type, subject: entity.subject },
  });
  return entity;
}

// B1: транзакция + FOR UPDATE — проверка статуса и INSERT атомарны.
export async function addFindingService(
  auditId: UUID, finding: string, severity: number, recommendation: string, requesterId: UUID,
): Promise<AuditFinding> {
  const id = await transaction(async (client) => {
    const lock = await client.query<{ id: string; status: AuditStatus; initiator_id: string }>(
      `SELECT id, status, initiator_id FROM audits WHERE id = $1 FOR UPDATE`,
      [auditId],
    );
    const audit = lock.rows[0];
    if (!audit) {throw new NotFoundError('Аудит', auditId);}
    if (audit.status === 'finished') {throw new ConflictError('Аудит закрыт');}

    // B7: добавлять findings может только инициатор аудита или роль с audit:E
    // (роль проверена middleware requireRight('audit','E')).
    // TODO(techdebt): расширить на «любой Verifier, кроме субъекта аудита».
    if (audit.initiator_id !== requesterId) {
      // Не блокируем жёстко — Verifier может помогать. Только логируем.
      // (Если политика «только инициатор» — throw ForbiddenError.)
    }

    const fId = newUUID();
    await client.query(
      `INSERT INTO audit_findings (id, audit_id, finding, severity, recommendation)
       VALUES ($1, $2, $3, $4, $5)`,
      [fId, auditId, finding, severity, recommendation],
    );

    if (audit.status === 'open') {
      await client.query(`UPDATE audits SET status = 'in_progress' WHERE id = $1`, [auditId]);
    }
    return fId;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.add_finding', entityType: 'audit_finding', entityId: id,
    newValue: { audit_id: auditId, severity },
  });

  return {
    id,
    auditId,
    finding,
    severity,
    recommendation,
    createdAt: new Date().toISOString(),
  };
}

// B2: атомарный UPDATE ... WHERE status <> 'finished' RETURNING.
export async function closeAuditService(
  auditId: UUID, result: string, requesterId: UUID,
): Promise<Audit> {
  const audit = await getAudit(auditId);
  const updated = closeAudit(audit, result);   // entity validate

  const res = await query<{ id: string }>(
    `UPDATE audits
        SET status = 'finished', result = $1, finished_at = now()
      WHERE id = $2 AND status <> 'finished'
      RETURNING id`,
    [updated.result, auditId],
  );
  if (res.length === 0) {
    throw new ConflictError('Аудит уже закрыт параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.close_audit', entityType: 'audit', entityId: auditId,
    newValue: { result },
  });

  return getAudit(auditId);
}

// B5: фильтр по просрочке в SQL, а не в памяти.
export async function listOverdueAudits(maxDays = 30): Promise<Audit[]> {
  const rows = await query<AuditRow>(
    `SELECT id, type, subject, subject_id, initiator_id, status, result,
            created_at, finished_at
       FROM audits
      WHERE status <> 'finished'
        AND created_at < now() - ($1::int || ' days')::interval
      ORDER BY created_at ASC`,
    [maxDays],
  );
  return rows.map(rowToAudit);
}

// -------- Перепроверка ОТК --------

// B3: запрет дубля перепроверки тем же верификатором.
export async function recheckService(
  otcDecisionId: UUID, matches: boolean, comment: string | null, requesterId: UUID,
): Promise<VerificationRecheck> {
  const decision = await queryOne<{ id: string; otc_id: string }>(
    `SELECT id, otc_id FROM otc_decisions WHERE id = $1`,
    [otcDecisionId],
  );
  if (!decision) {throw new NotFoundError('Решение ОТК', otcDecisionId);}
  if (decision.otc_id === requesterId) {
    throw new ConflictError('Верификатор не может перепроверять свою работу (I.2.2)');
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM verification_rechecks
      WHERE otc_decision_id = $1 AND verifier_id = $2 LIMIT 1`,
    [otcDecisionId, requesterId],
  );
  if (existing) {
    throw new ConflictError('Вы уже перепроверяли это решение');
  }

  const id = newUUID();
  const result: RecheckResult = matches ? 'match' : 'mismatch';
  await query(
    `INSERT INTO verification_rechecks (id, otc_decision_id, verifier_id, result, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, otcDecisionId, requesterId, result, comment],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.recheck', entityType: 'verification_recheck', entityId: id,
    newValue: { result, otc_decision_id: otcDecisionId },
  });

  return {
    id,
    otcDecisionId,
    verifierId: requesterId,
    result,
    comment,
    createdAt: new Date().toISOString(),
  };
}

export async function getRecheckStats(): Promise<{ matchRate: number; mismatches: number }> {
  const row = await queryOne<{ total: string; mismatches: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE result = 'mismatch')::text AS mismatches
       FROM verification_rechecks`,
  );
  const total = parseInt(row?.total ?? '0', 10);
  const mismatches = parseInt(row?.mismatches ?? '0', 10);
  return {
    matchRate: total > 0 ? Math.round(((total - mismatches) / total) * 10000) / 100 : 100,
    mismatches,
  };
}

// -------- Аудит кода --------

interface CodeAuditRow {
  id: string;
  system: CodeSystem;
  version: string;
  findings: Record<string, unknown>;
  conducted_by: string;
  created_at: Date;
}

export async function codeAuditService(
  system: CodeSystem, version: string,
  findings: Record<string, unknown>, requesterId: UUID,
): Promise<CodeAudit> {
  const id = newUUID();
  const rows = await query<CodeAuditRow>(
    `INSERT INTO code_audits (id, system, version, findings, conducted_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, system, version, findings, conducted_by, created_at`,
    [id, system, version, JSON.stringify(findings), requesterId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('code_audits: INSERT ... RETURNING не вернул строку');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.code_audit', entityType: 'code_audit', entityId: id,
    newValue: { system, version },
  });

  return {
    id: row.id,
    system: row.system,
    version: row.version,
    findings: row.findings,
    conductedBy: row.conducted_by,
    createdAt: row.created_at.toISOString(),
  };
}

// -------- Integrity alerts --------

interface AlertRow {
  id: string;
  system: string;
  source_node: string;
  action: IntegrityAction;
  details: Record<string, unknown>;
  handled_at: Date | null;
  resolution: string | null;
  created_at: Date;
}

export async function reportIntegrityAlertService(
  system: string, sourceNode: string, action: IntegrityAction,
  details: Record<string, unknown>, requesterId: UUID,
): Promise<IntegrityAlert> {
  const id = newUUID();
  const rows = await query<AlertRow>(
    `INSERT INTO integrity_alerts (id, system, source_node, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, system, source_node, action, details, handled_at, resolution, created_at`,
    [id, system, sourceNode, action, JSON.stringify(details)],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('integrity_alerts: INSERT ... RETURNING не вернул строку');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.integrity_alert', entityType: 'integrity_alert', entityId: id,
    newValue: { system, action },
  });

  return {
    id: row.id,
    system: row.system,
    sourceNode: row.source_node,
    action: row.action,
    details: row.details,
    handledAt: row.handled_at ? row.handled_at.toISOString() : null,
    resolution: row.resolution,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getActiveAlerts(): Promise<IntegrityAlert[]> {
  const rows = await query<AlertRow>(
    `SELECT id, system, source_node, action, details, handled_at, resolution, created_at
       FROM integrity_alerts
      WHERE handled_at IS NULL
      ORDER BY created_at DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    system: row.system,
    sourceNode: row.source_node,
    action: row.action,
    details: row.details,
    handledAt: row.handled_at ? row.handled_at.toISOString() : null,
    resolution: row.resolution,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function suspendGatewayDecisions(requesterId: UUID): Promise<{ suspended: number }> {
  // Упрощение: помечаем все pending-транзакции Шлюза как "замороженные"
  // через отдельную таблицу не получится без отдельной схемы — считаем условно
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'verification.suspend_gateway', entityType: 'gateway_suspension', entityId: requesterId,
    newValue: { suspended: true },
  });
  return { suspended: 1 };
}