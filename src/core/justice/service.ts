// C.0.21.02 — Сервис Правозащиты.
// Заявления, расследования, изоляция, ресоциализация, санкции,
// Красный Контур, необратимое отчуждение, права жертвы.
//
// v0.0.03:
//   - listComplaints(filter, _requesterId?) — 2-й аргумент для совместимости
//     с data-loaders (C.0.26.03), где complaints вызывается как
//     listComplaints(filter, ctx.participantId).
//     TECHDEBT: _requesterId пока не используется — PII в списке заявлений
//     течёт к любому, у кого есть доступ к loader'у. Реальная фильтрация
//     по направлению/участнику — отдельная задача.
//
// Ранее (v0.0.02):
//   - B2: closeInvestigation — atomic UPDATE WHERE status <> 'closed'.
//   - B3: extendInvestigation — atomic UPDATE WHERE status<>'closed' AND deadline=original.
//   - B4: imposeIsolation — target existence.
//   - B5: createSanction — target existence.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ForbiddenError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

import {
  fileComplaint as entityFileComplaint,
  startInvestigation as entityStartInvestigation,
  imposeIsolation as entityImposeIsolation,
  createSanction as entityCreateSanction,
  validateNoCollectiveResponsibility,
  canApplyNotImputable,
  getVictimRights as entityGetVictimRights,
  getInvestigationDeadline,
  canExtendInvestigation,
  extendInvestigationDeadline,
  JUSTICE_CONSTANTS,
  type Complaint,
  type Investigation,
  type Isolation,
  type Resocialization,
  type Sanction,
  type VictimRights,
  type ComplaintType,
  type SanctionType,
} from './entity.js';

// ─── Маппинг из БД ───────────────────────────────────────────────

interface ComplaintRow {
  id: string;
  type: ComplaintType;
  applicant_id: string | null;
  anonymous: boolean;
  description: string;
  status: 'filed' | 'investigation' | 'closed';
  created_at: Date;
  closed_at: Date | null;
}

function rowToComplaint(r: ComplaintRow): Complaint {
  return {
    id: r.id,
    type: r.type,
    applicantId: r.applicant_id,
    anonymous: r.anonymous,
    description: r.description,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

interface InvestigationRow {
  id: string;
  complaint_id: string;
  investigator_ids: string[];
  target_id: string;
  status: 'open' | 'in_progress' | 'closed';
  deadline: Date;
  result: string | null;
  victim_rights: VictimRights;
  audited_by: string | null;
  created_at: Date;
}

function rowToInvestigation(r: InvestigationRow): Investigation {
  return {
    id: r.id,
    complaintId: r.complaint_id,
    investigatorIds: r.investigator_ids ?? [],
    targetId: r.target_id,
    status: r.status,
    deadline: r.deadline.toISOString(),
    result: r.result,
    victimRights: r.victim_rights ?? {
      anonymity: false,
      relocationProvided: false,
      psychologistAssigned: false,
      participation: false,
    },
    auditedBy: r.audited_by,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Заявления ───────────────────────────────────────────────────

export interface ComplaintCreate {
  type: ComplaintType;
  description: string;
  anonymous: boolean;
}

export interface ComplaintFilter {
  status?: 'filed' | 'investigation' | 'closed';
  page?: number;
  perPage?: number;
}

export async function fileComplaint(
  input: ComplaintCreate,
  requesterId: UUID,
): Promise<Complaint> {
  const id = newUUID();
  const c = entityFileComplaint({
    id,
    type: input.type,
    applicantId: requesterId,
    anonymous: input.anonymous,
    description: input.description,
  });

  await query(
    `INSERT INTO complaints (id, type, applicant_id, anonymous, description, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.id, c.type, requesterId, c.anonymous, c.description, c.status],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.complaint.filed',
    entityType: 'complaint',
    entityId: c.id,
    newValue: { type: c.type, anonymous: c.anonymous },
  });

  return c;
}

// TECHDEBT: _requesterId не используется — PII в списке заявлений течёт
// к любому, у кого есть доступ к loader'у. Аргумент фиксирует intent
// (вызовы передают requesterId), но не закрывает утечку. Реальная фильтрация
// должна быть добавлена вместе с фильтром по направлению/участнику.
export async function listComplaints(
  filter: ComplaintFilter,
  _requesterId?: UUID,
): Promise<Complaint[]> {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;
  const offset = (page - 1) * perPage;
  const params: unknown[] = [];
  let where = '';
  if (filter.status) {
    params.push(filter.status);
    where = `WHERE status = $${params.length}`;
  }
  params.push(perPage, offset);
  const rows = await query<ComplaintRow>(
    `SELECT * FROM complaints ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToComplaint);
}

export async function getComplaint(complaintId: UUID): Promise<Complaint> {
  const r = await queryOne<ComplaintRow>(
    `SELECT * FROM complaints WHERE id = $1`,
    [complaintId],
  );
  if (!r) {throw new NotFoundError('Заявление', complaintId);}
  return rowToComplaint(r);
}

// ─── Расследования ───────────────────────────────────────────────

export interface InvestigationCreate {
  complaintId: UUID;
  targetId: UUID;
  investigatorIds?: UUID[];
}

export async function startInvestigation(
  input: InvestigationCreate,
  requesterId: UUID,
): Promise<Investigation> {
  // Проверяем, что заявление существует
  const complaint = await getComplaint(input.complaintId);

  const investigators = input.investigatorIds ?? [requesterId];
  const victimRights: VictimRights = {
    anonymity: complaint.anonymous,
    relocationProvided: false,
    psychologistAssigned: false,
    participation: true,
  };

  const i = entityStartInvestigation(
    complaint.id,
    input.targetId,
    investigators,
    victimRights,
  );

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO investigations
         (id, complaint_id, investigator_ids, target_id, status, deadline, victim_rights)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb)`,
      [
        i.id,
        i.complaintId,
        JSON.stringify(i.investigatorIds),
        i.targetId,
        i.status,
        i.deadline,
        JSON.stringify(i.victimRights),
      ],
    );
    await client.query(
      `UPDATE complaints SET status = 'investigation' WHERE id = $1`,
      [i.complaintId],
    );
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.investigation.started',
    entityType: 'investigation',
    entityId: i.id,
    newValue: { complaintId: i.complaintId, targetId: i.targetId },
  });

  return i;
}

export async function getInvestigation(
  investigationId: UUID,
): Promise<Investigation> {
  const r = await queryOne<InvestigationRow>(
    `SELECT * FROM investigations WHERE id = $1`,
    [investigationId],
  );
  if (!r) {throw new NotFoundError('Расследование', investigationId);}
  return rowToInvestigation(r);
}

// B2: atomic UPDATE — WHERE status <> 'closed'.
export async function closeInvestigation(
  investigationId: UUID,
  result: string,
  requesterId: UUID,
): Promise<Investigation> {
  const i = await getInvestigation(investigationId);
  if (i.status === 'closed') {throw new ConflictError('Расследование уже закрыто');}

  const res = await query<{ id: string }>(
    `UPDATE investigations
        SET status = 'closed', result = $2
      WHERE id = $1 AND status <> 'closed'
      RETURNING id`,
    [investigationId, result],
  );
  if (res.length === 0) {
    throw new ConflictError('Расследование изменено параллельным запросом');
  }

  await query(
    `UPDATE complaints SET status = 'closed', closed_at = now() WHERE id = $1`,
    [i.complaintId],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.investigation.closed',
    entityType: 'investigation',
    entityId: investigationId,
    newValue: { result },
  });
  return { ...i, status: 'closed', result };
}

// B3: atomic UPDATE — WHERE status <> 'closed' AND deadline = original.
export async function extendInvestigation(
  investigationId: UUID,
  requesterId: UUID,
): Promise<Investigation> {
  const i = await getInvestigation(investigationId);
  const now = new Date().toISOString();
  if (!canExtendInvestigation(i, now)) {
    throw new ConflictError(
      'Продление доступно только после истечения первоначального срока',
    );
  }
  const updated = extendInvestigationDeadline(i);

  const res = await query<{ id: string }>(
    `UPDATE investigations
        SET deadline = $2
      WHERE id = $1 AND status <> 'closed' AND deadline = $3
      RETURNING id`,
    [investigationId, updated.deadline, i.deadline],
  );
  if (res.length === 0) {
    throw new ConflictError('Расследование изменено параллельным запросом');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.investigation.extended',
    entityType: 'investigation',
    entityId: investigationId,
    newValue: { deadline: updated.deadline },
  });
  return updated;
}

export async function listOverdueInvestigations(): Promise<Investigation[]> {
  const rows = await query<InvestigationRow>(
    `SELECT * FROM investigations
      WHERE status IN ('open', 'in_progress') AND deadline < now()
      ORDER BY deadline ASC
      LIMIT 500`,
  );
  return rows.map(rowToInvestigation);
}

// ─── Изоляция ────────────────────────────────────────────────────

export interface IsolationCreate {
  targetId: UUID;
  validTo: ISODateTime;
  conditions: Record<string, unknown>;
}

// B4: target должен существовать.
export async function imposeIsolation(
  input: IsolationCreate,
  requesterId: UUID,
): Promise<Isolation> {
  const target = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [input.targetId],
  );
  if (!target) {throw new NotFoundError('Участник', input.targetId);}

  const isolation = entityImposeIsolation(
    input.targetId,
    input.validTo,
    input.conditions,
    requesterId,
  );
  await query(
    `INSERT INTO isolation
       (id, target_id, valid_from, valid_to, conditions, imposed_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      isolation.id,
      isolation.targetId,
      isolation.validFrom,
      isolation.validTo,
      JSON.stringify(isolation.conditions),
      isolation.imposedBy,
    ],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.isolation.imposed',
    entityType: 'isolation',
    entityId: isolation.id,
    newValue: { targetId: isolation.targetId, validTo: isolation.validTo },
  });
  return isolation;
}

export async function liftIsolation(
  isolationId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<void> {
  const r = await queryOne<{ id: string; lifted_at: Date | null }>(
    `SELECT id, lifted_at FROM isolation WHERE id = $1`,
    [isolationId],
  );
  if (!r) {throw new NotFoundError('Изоляция', isolationId);}
  if (r.lifted_at) {throw new ConflictError('Изоляция уже снята');}

  await query(
    `UPDATE isolation
        SET lifted_at = now(), lifted_by = $2, lift_reason = $3
      WHERE id = $1`,
    [isolationId, requesterId, reason],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.isolation.lifted',
    entityType: 'isolation',
    entityId: isolationId,
    newValue: { reason },
  });
}

// ─── Ресоциализация ──────────────────────────────────────────────

export interface ResocializationCreate {
  targetId: UUID;
  program: Record<string, unknown>;
  mentors?: UUID[];
}

export async function createResocialization(
  input: ResocializationCreate,
  requesterId: UUID,
): Promise<Resocialization> {
  const mentors = input.mentors ?? [];
  const id = newUUID();
  const now = new Date().toISOString();

  await query(
    `INSERT INTO resocialization
       (id, target_id, program, mentors, status)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, 'active')`,
    [id, input.targetId, JSON.stringify(input.program), JSON.stringify(mentors)],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.resocialization.created',
    entityType: 'resocialization',
    entityId: id,
    newValue: { targetId: input.targetId },
  });

  return {
    id,
    targetId: input.targetId,
    program: input.program,
    mentors,
    status: 'active',
    startedAt: now,
    finishedAt: null,
  };
}

// ─── Санкции ─────────────────────────────────────────────────────

export interface SanctionCreate {
  targetId: UUID;
  type: SanctionType;
  basis: string;
}

// B5: target должен существовать.
export async function createSanction(
  input: SanctionCreate,
  requesterId: UUID,
): Promise<Sanction> {
  const target = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [input.targetId],
  );
  if (!target) {throw new NotFoundError('Участник', input.targetId);}

  const s = entityCreateSanction(
    input.targetId,
    input.type,
    input.basis,
    requesterId,
  );

  await query(
    `INSERT INTO sanctions
       (id, target_id, type, basis, decided_by, status, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [s.id, s.targetId, s.type, s.basis, s.decidedBy, s.status, s.decidedAt],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.sanction.imposed',
    entityType: 'sanction',
    entityId: s.id,
    newValue: { targetId: s.targetId, type: s.type },
  });

  return s;
}

export async function createNotImputable(
  targetId: UUID,
  decisionRef: UUID,
  requesterId: UUID,
): Promise<Sanction> {
  const { getSession, countVotesService } = await import('../jury/service.js');
  const session = await getSession(decisionRef);
  const votes = await countVotesService(session.id);
  if (
    !canApplyNotImputable(
      { yes: votes.yes, no: votes.no, total: votes.total },
      Boolean(session.decision),
    )
  ) {
    throw new ForbiddenError(
      'Необратимое отчуждение требует 20 из 24 голосов Жюри (I.2.5.1)',
    );
  }
  return createSanction(
    { targetId, type: 'not_imputable', basis: `jury_session:${decisionRef}` },
    requesterId,
  );
}

// ─── Красный Контур ──────────────────────────────────────────────

export async function activateRedCircuit(
  reason: string,
  requesterId: UUID,
): Promise<{ regimeId: UUID | null }> {
  const { activateService } = await import('../regimes/service.js');
  const regime = await activateService(
    {
      type: 'red_circuit',
      reason: `justice: ${reason}`,
      context: { isRedCircuitRequested: true },
    },
    requesterId,
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.red_circuit.activated',
    entityType: 'regime',
    entityId: regime.id,
    newValue: { reason },
  });
  return { regimeId: regime.id };
}

// ─── Права жертвы ────────────────────────────────────────────────

export async function getVictimRights(
  participantId: UUID,
): Promise<VictimRights> {
  const r = await queryOne<{ victim_rights: VictimRights }>(
    `SELECT victim_rights FROM investigations
      WHERE target_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [participantId],
  );
  if (r?.victim_rights) {return r.victim_rights;}
  return entityGetVictimRights({
    anonymity: true,
    relocationProvided: true,
    psychologistAssigned: true,
    participation: true,
  });
}

// ─── Процессуальный аудит ────────────────────────────────────────

export async function auditProcess(
  investigationId: UUID,
  requesterId: UUID,
): Promise<{ findings: string[] }> {
  const i = await getInvestigation(investigationId);
  const findings: string[] = [];

  const now = Date.now();
  const deadline = new Date(i.deadline).getTime();
  if (i.status !== 'closed' && deadline < now) {
    findings.push(`Просрочка расследования: deadline ${i.deadline}`);
  }
  if (i.investigatorIds.length === 0) {
    findings.push('Нет следователей');
  }
  if (i.investigatorIds.includes(i.targetId)) {
    findings.push('Следователь = подозреваемый (конфликт интересов)');
  }
  if (i.status === 'closed' && !i.result) {
    findings.push('Расследование закрыто без результата');
  }

  await query(
    `UPDATE investigations SET audited_by = $2 WHERE id = $1`,
    [investigationId, requesterId],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'justice.process.audited',
    entityType: 'investigation',
    entityId: investigationId,
    newValue: { findings },
  });
  return { findings };
}

export async function coordinateWithRedCircuit(
  investigationId: UUID,
  requesterId: UUID,
): Promise<{ coordinated: boolean }> {
  const { isActive } = await import('../regimes/service.js');
  const redCircuitActive = await isActive('red_circuit');
  if (redCircuitActive) {
    await logAction({
      actorId: requesterId,
      actorType: 'participant',
      action: 'justice.red_circuit.coordinated',
      entityType: 'investigation',
      entityId: investigationId,
    });
  }
  return { coordinated: redCircuitActive };
}

export async function validateCollective(
  targetId: UUID,
  relatives: UUID[],
): Promise<{ valid: boolean; violations: string[] }> {
  const sanctions = await query<{ id: string; target_id: string; type: SanctionType }>(
    `SELECT id, target_id, type FROM sanctions WHERE target_id = ANY($1::uuid[])`,
    [relatives],
  );
  return validateNoCollectiveResponsibility(
    targetId,
    relatives,
    sanctions.map((s) => ({
      id: s.id,
      targetId: s.target_id,
      type: s.type,
      basis: '',
      decidedBy: '',
      decidedAt: '',
      status: 'imposed' as const,
    })),
  );
}

export { JUSTICE_CONSTANTS, getInvestigationDeadline };