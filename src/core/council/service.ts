// C.0.46.01 — Совет направления.
//
// Хартия: в Совет входит самый опытный участник направления — по числу
// полученных Потоков (приёмок), не считая основной деятельности. Ротация
// обязательна, дисквалификация возможна. Если подходящего участника нет,
// ответственность ложится на Архитектора.
//
// Почему «опыт» = принятые задачи в направлении: каждая приёмка начисляет
// один Поток (C.0.14.01), а tasks.direction_id — единственная надёжная связь
// Потока с направлением (в flow_transactions направления нет).

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { listParticipantsWithRole, assignRole, revokeRole } from '../../security/rbac.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { Role } from '../roles.js';
import type { UUID } from '../types.js';

export interface CouncilCandidate {
  participantId: UUID;
  name: string;
  externalId: string;
  score: number;
}

export interface CouncilState {
  directionId: UUID;
  directionNumber: number | null;
  directionName: string | null;
  /** Избранный советник или null, если ложится на Архитектора. */
  member: CouncilCandidate | null;
  termEndsAt: string | null;
  electedAt: string | null;
  /** Кто исполняет функцию, если избранного нет. */
  fallback: { participantId: UUID; name: string; externalId: string } | null;
  disqualified: Array<{ participantId: UUID; name: string; reason: string }>;
}

async function getArchitect(): Promise<{ participantId: UUID; name: string; externalId: string } | null> {
  const row = await queryOne<{ id: string; name: string; external_id: string }>(
    `SELECT id, name, external_id FROM participants
      WHERE is_first_architect = true AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
  );
  return row
    ? { participantId: row.id as UUID, name: row.name, externalId: row.external_id }
    : null;
}

/**
 * Рейтинг опыта в направлении: сколько задач принято у каждого участника.
 * Архитектор и дисквалифицированные исключаются: Совет — не начальник,
 * а самый опытный из равных.
 */
export async function rankCandidates(directionId: UUID): Promise<CouncilCandidate[]> {
  const rows = await query<{
    id: string;
    name: string;
    external_id: string;
    score: string;
  }>(
    `SELECT p.id, p.name, p.external_id,
            COUNT(t.id)::text AS score
       FROM participants p
       JOIN tasks t ON t.assigned_to = p.id
      WHERE t.direction_id = $1
        AND t.status = 'accepted'
        AND p.deleted_at IS NULL
        AND p.is_first_architect = false
        AND NOT EXISTS (
          SELECT 1 FROM council_disqualifications d
           WHERE d.participant_id = p.id AND d.direction_id = $1 AND d.active = true
        )
      GROUP BY p.id, p.name, p.external_id
      ORDER BY COUNT(t.id) DESC, p.name
      LIMIT 20`,
    [directionId],
  );
  return rows.map((r) => ({
    participantId: r.id as UUID,
    name: r.name,
    externalId: r.external_id,
    score: parseInt(r.score, 10),
  }));
}

export async function getCouncilState(directionId: UUID): Promise<CouncilState> {
  const dir = await queryOne<{ number: number; name: string }>(
    `SELECT number, name FROM directions WHERE id = $1`,
    [directionId],
  );
  if (!dir) {throw new NotFoundError('Направление', directionId);}

  const memberRows = await query<{
    participant_id: string;
    name: string;
    external_id: string;
    valid_to: Date | null;
  }>(
    `SELECT pr.participant_id, p.name, p.external_id, pr.valid_to
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
       JOIN participants p ON p.id = pr.participant_id
      WHERE r.name = 'COUNCIL_MEMBER'
        AND pr.direction_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
      ORDER BY pr.valid_from DESC
      LIMIT 1`,
    [directionId],
  );

  const election = await queryOne<{ elected_at: Date; term_ends_at: Date | null }>(
    `SELECT elected_at, term_ends_at FROM council_elections
      WHERE direction_id = $1 ORDER BY elected_at DESC LIMIT 1`,
    [directionId],
  );

  const disq = await query<{ participant_id: string; name: string; reason: string }>(
    `SELECT d.participant_id, p.name, d.reason
       FROM council_disqualifications d
       JOIN participants p ON p.id = d.participant_id
      WHERE d.direction_id = $1 AND d.active = true`,
    [directionId],
  );

  const memberRow = memberRows[0];
  const member: CouncilCandidate | null = memberRow
    ? {
        participantId: memberRow.participant_id as UUID,
        name: memberRow.name,
        externalId: memberRow.external_id,
        // Опыт считаем текущий, а не на момент выборов.
        score: (await rankCandidates(directionId)).find(
          (c) => c.participantId === memberRow.participant_id,
        )?.score ?? 0,
      }
    : null;

  return {
    directionId,
    directionNumber: dir.number,
    directionName: dir.name,
    member,
    termEndsAt: memberRow?.valid_to ? memberRow.valid_to.toISOString() : null,
    electedAt: election?.elected_at ? election.elected_at.toISOString() : null,
    fallback: member ? null : await getArchitect(),
    disqualified: disq.map((d) => ({
      participantId: d.participant_id as UUID,
      name: d.name,
      reason: d.reason,
    })),
  };
}

export async function listCouncils(): Promise<CouncilState[]> {
  const dirs = await query<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' ORDER BY number`,
  );
  const result: CouncilState[] = [];
  for (const d of dirs) {result.push(await getCouncilState(d.id as UUID));}
  return result;
}

/**
 * Избрать Совет направления: самый опытный участник, ротация предыдущего.
 * Если кандидатов нет — роль никому не выдаётся, функция ложится на
 * Архитектора (и это явно возвращается в ответе).
 */
export async function electCouncil(
  directionId: UUID,
  requesterId: UUID,
): Promise<CouncilState> {
  const candidates = await rankCandidates(directionId);
  const best = candidates[0];

  if (!best) {
    await logAction({
      actorId: requesterId,
      actorType: 'participant',
      action: 'council.elect.fallback',
      entityType: 'direction',
      entityId: directionId,
      newValue: { reason: 'нет участников с принятыми задачами — функция у Архитектора' },
    });
    return getCouncilState(directionId);
  }

  // Ротация: снимаем прежних советников направления (кроме избранного).
  const current = await listParticipantsWithRole(Role.COUNCIL_MEMBER, directionId);
  for (const pid of current) {
    if (pid === best.participantId) {continue;}
    await revokeRole(pid, Role.COUNCIL_MEMBER, `Ротация: избран ${best.name}`, requesterId);
  }

  const role = await queryOne<{ max_term_days: number | null }>(
    `SELECT max_term_days FROM roles
      WHERE direction_id = $1 AND name = 'COUNCIL_MEMBER' LIMIT 1`,
    [directionId],
  );
  if (!role) {
    throw new ConflictError('В направлении нет роли COUNCIL_MEMBER — сначала seed ролей');
  }
  const termDays = role.max_term_days ?? 730;
  const validTo = new Date(Date.now() + termDays * 24 * 3600 * 1000).toISOString();

  if (!current.includes(best.participantId)) {
    await assignRole({
      participantId: best.participantId,
      role: Role.COUNCIL_MEMBER,
      directionId,
      grantedBy: requesterId,
      validTo,
    });
  }

  await query(
    `INSERT INTO council_elections
       (id, direction_id, participant_id, score, term_ends_at, reason)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6)`,
    [
      newUUID(),
      directionId,
      best.participantId,
      best.score,
      validTo,
      `Избран как самый опытный: принято задач ${best.score}`,
    ],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'council.elect',
    entityType: 'direction',
    entityId: directionId,
    newValue: { participant_id: best.participantId, score: best.score, term_days: termDays },
  });

  return getCouncilState(directionId);
}

/** Дисквалификация: снять с роли и запомнить причину. */
export async function disqualifyCouncilMember(input: {
  directionId: UUID;
  participantId: UUID;
  reason: string;
  requesterId: UUID;
}): Promise<CouncilState> {
  if (!input.reason.trim()) {throw new ValidationError('Причина дисквалификации обязательна');}

  await query(
    `INSERT INTO council_disqualifications (id, participant_id, direction_id, reason, active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (participant_id, direction_id)
     DO UPDATE SET reason = EXCLUDED.reason, active = true`,
    [newUUID(), input.participantId, input.directionId, input.reason],
  );

  await revokeRole(
    input.participantId,
    Role.COUNCIL_MEMBER,
    `Дисквалификация: ${input.reason}`,
    input.requesterId,
  );

  await logAction({
    actorId: input.requesterId,
    actorType: 'participant',
    action: 'council.disqualify',
    entityType: 'direction',
    entityId: input.directionId,
    newValue: { participant_id: input.participantId, reason: input.reason },
  });

  return getCouncilState(input.directionId);
}


export interface CouncilHistory {
  elections: Array<{
    participantId: UUID;
    name: string;
    score: number;
    electedAt: string;
    termEndsAt: string | null;
    reason: string | null;
  }>;
  disqualifications: Array<{
    participantId: UUID;
    name: string;
    reason: string;
    createdAt: string;
  }>;
}

/** История выборов и дисквалификаций — для вкладки «Советы». */
export async function getCouncilHistory(directionId: UUID): Promise<CouncilHistory> {
  const elections = await query<{
    participant_id: string;
    name: string;
    score: number;
    elected_at: Date;
    term_ends_at: Date | null;
    reason: string | null;
  }>(
    `SELECT e.participant_id, p.name, e.score, e.elected_at, e.term_ends_at, e.reason
       FROM council_elections e
       JOIN participants p ON p.id = e.participant_id
      WHERE e.direction_id = $1
      ORDER BY e.elected_at DESC
      LIMIT 50`,
    [directionId],
  );

  const disq = await query<{
    participant_id: string;
    name: string;
    reason: string;
    created_at: Date;
    active: boolean;
  }>(
    `SELECT d.participant_id, p.name, d.reason, d.created_at, d.active
       FROM council_disqualifications d
       JOIN participants p ON p.id = d.participant_id
      WHERE d.direction_id = $1
      ORDER BY d.created_at DESC
      LIMIT 50`,
    [directionId],
  );

  return {
    elections: elections.map((e) => ({
      participantId: e.participant_id as UUID,
      name: e.name,
      score: e.score,
      electedAt: e.elected_at.toISOString(),
      termEndsAt: e.term_ends_at ? e.term_ends_at.toISOString() : null,
      reason: e.reason,
    })),
    disqualifications: disq.map((d) => ({
      participantId: d.participant_id as UUID,
      name: d.name,
      reason: d.reason,
      createdAt: d.created_at.toISOString(),
    })),
  };
}
