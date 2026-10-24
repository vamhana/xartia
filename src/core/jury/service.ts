// C.0.22.02 — Сервис Жюри
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B2: voteService проверяет «voterId === requesterId ИЛИ requesterId === moderatorId».
//   - B3: atomic jsonb-merge (votes || jsonb_build_object(...)).
//   - B5: decideService — проверка moderator + atomic UPDATE WHERE decided_at IS NULL.
//   - B6: assignOutsideTrustService — catch isUniqueViolation → 409.
//   - B7: reviewOutsideTrust — atomic UPDATE WHERE status='active'.
//   - B8: createAppeal — pre-check jury_session FK.
//   - B9: assignOutsideTrustService — participant existence.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - decideService — эвристика: normal_12 → 9/12 (для not_imputable тоже 9/12).
//     Правильное решение — явный `decision_type` (B10).

import { randomBytes } from '../../lib/crypto.js';
import { query, queryOne, isUniqueViolation } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  assembleSession, vote, countVotes, decide,
  canDecideOutsideTrust, canDecideNotImputable, getRequiredSize,
  assignOutsideTrust, canReviewOutsideTrust,
  type JurySession, type JurySessionType, type Vote, type OutsideTrust,
  type VoteCount, type Appeal, type OutsideTrustStatus,
} from './entity.js';

interface SessionRow {
  id: string;
  type: JurySessionType;
  subject_id: string;
  participants: UUID[] | null;
  moderator_id: string;
  votes: Record<string, Vote> | null;
  decision: string | null;
  created_at: Date;
  decided_at: Date | null;
}

function rowToSession(row: SessionRow): JurySession {
  return {
    id: row.id,
    type: row.type,
    subjectId: row.subject_id,
    participants: row.participants ?? [],
    moderatorId: row.moderator_id,
    votes: row.votes ?? {},
    decision: row.decision,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  };
}

// -------- Случайная выборка --------

function pickRandom<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = randomBelow(pool.length);
    const [picked] = pool.splice(idx, 1);
    if (picked === undefined) {
      throw new Error('unreachable: idx out of bounds');
    }
    result.push(picked);
  }
  return result;
}

// Криптостойкий [0, maxExclusive) без modulo bias (rejection sampling).
// Отбраковка редка: доля = (2^32 mod max) / 2^32.
function randomBelow(maxExclusive: number): number {
  if (maxExclusive <= 0) {throw new Error('maxExclusive must be > 0');}
  if (maxExclusive === 1) {return 0;}
  const RANGE = 2 ** 32;
  const limit = RANGE - (RANGE % maxExclusive);
  let x: number;
  do {
    x = randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return x % maxExclusive;
}

export async function assembleRandomSelection(
  type: JurySessionType,
  excludeIds: UUID[] = [],
): Promise<UUID[]> {
  const need = getRequiredSize(type);

  // Пул: активные участники, не excluded, не outside_trust, не в excludeIds
  const params: unknown[] = [];
  const excludeClause = excludeIds.length > 0
    ? `AND p.id NOT IN (${excludeIds.map((_, i) => `$${params.push(excludeIds[i])}`).join(',')})`
    : '';

  const rows = await query<{ id: string }>(
    `SELECT p.id
       FROM participants p
      WHERE p.deleted_at IS NULL
        AND p.status NOT IN ('excluded', 'outside_trust_network')
        ${excludeClause}
      LIMIT 1000`,
    params,
  );
  if (rows.length < need) {
    throw new ConflictError(
      `Недостаточно участников для Жюри: нужно ${need}, доступно ${rows.length}`,
    );
  }

  return pickRandom(rows.map((r) => r.id), need);
}

// -------- Сессии --------

export interface CreateSessionRequest {
  type: JurySessionType;
  subjectId: UUID;
  excludeIds?: UUID[];
}

export async function createSession(
  input: CreateSessionRequest,
  requesterId: UUID,
): Promise<JurySession> {
  const participants = await assembleRandomSelection(
    input.type,
    input.excludeIds ?? [],
  );

  const entity = assembleSession({
    id: newUUID(),
    type: input.type,
    subjectId: input.subjectId,
    participants,
    moderatorId: requesterId,
  });

  await query(
    `INSERT INTO jury_sessions
       (id, type, subject_id, participants, moderator_id, votes)
     VALUES ($1, $2, $3, $4::jsonb, $5, '{}'::jsonb)`,
    [
      entity.id, entity.type, entity.subjectId,
      JSON.stringify(entity.participants),
      entity.moderatorId,
    ],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'jury.create_session', entityType: 'jury_session', entityId: entity.id,
    newValue: { type: entity.type, subject_id: entity.subjectId },
  });

  return entity;
}

export async function getSession(sessionId: UUID): Promise<JurySession> {
  const row = await queryOne<SessionRow>(
    `SELECT id, type, subject_id, participants, moderator_id, votes,
            decision, created_at, decided_at
       FROM jury_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!row) {throw new NotFoundError('Сессия Жюри', sessionId);}
  return rowToSession(row);
}

// B2, B3: atomic jsonb-merge + проверка модератора.
// NOTE: сигнатура изменена — добавлен 4-й аргумент requesterId.
//       Контроллер должен передавать auth.participantId.
export async function voteService(
  sessionId: UUID,
  participantId: UUID,
  v: Vote,
  requesterId: UUID,
): Promise<JurySession> {
  const session = await getSession(sessionId);
  if (session.decidedAt) {throw new ConflictError('Сессия уже завершена');}

  // B2: если voter ≠ requester — requester должен быть модератором.
  if (participantId !== requesterId && requesterId !== session.moderatorId) {
    throw new ForbiddenError(
      'Голосовать за других может только модератор сессии',
    );
  }

  // entity-validate (participant в сессии + no re-vote).
  vote(session, participantId, v);

  // B3: atomic — append vote только если для этого participantId ещё нет ключа.
  const result = await query<{ votes: Record<string, Vote> }>(
    `UPDATE jury_sessions
        SET votes = votes || jsonb_build_object($1, $2::text)
      WHERE id = $3
        AND decided_at IS NULL
        AND (votes -> $1) IS NULL
      RETURNING votes`,
    [participantId, v, sessionId],
  );
  const updated = result[0];
  if (!updated) {
    throw new ConflictError('Голос уже отдан или сессия завершена');
  }

  return { ...session, votes: updated.votes };
}

// B5: moderator check + atomic UPDATE.
export async function decideService(
  sessionId: UUID,
  decisionText: string,
  requesterId: UUID,
): Promise<JurySession> {
  const session = await getSession(sessionId);
  if (session.decidedAt) {throw new ConflictError('Сессия уже решена');}

  // B5: только модератор сессии.
  if (requesterId !== session.moderatorId) {
    throw new ForbiddenError('Решение принимает только модератор сессии');
  }

  const voteCount = countVotes(session);
  if (session.type === 'normal_12' && !canDecideOutsideTrust(session)) {
    throw new ConflictError(`Нужно 9 из 12 голосов «за», получено ${voteCount.yes}`);
  }
  if (session.type === 'extended_24' && !canDecideNotImputable(session)) {
    throw new ConflictError(`Нужно 18 из 24 голосов «за», получено ${voteCount.yes}`);
  }

  const updated = decide(session, decisionText);

  const result = await query<{ id: string }>(
    `UPDATE jury_sessions
        SET decision = $1, decided_at = now()
      WHERE id = $2 AND decided_at IS NULL
      RETURNING id`,
    [updated.decision, sessionId],
  );
  if (result.length === 0) {
    throw new ConflictError('Сессия уже решена параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'jury.decide', entityType: 'jury_session', entityId: sessionId,
    newValue: { decision: decisionText },
  });
  return updated;
}

export async function countVotesService(sessionId: UUID): Promise<VoteCount> {
  const session = await getSession(sessionId);
  return countVotes(session);
}

// -------- Вне сети доверия --------

interface OutsideRow {
  id: string;
  participant_id: string;
  reason: string;
  valid_from: Date;
  review_at: Date;
  status: OutsideTrustStatus;
  lifted_at: Date | null;
}

function rowToOutside(row: OutsideRow): OutsideTrust {
  return {
    participantId: row.participant_id,
    reason: row.reason,
    validFrom: row.valid_from.toISOString(),
    reviewAt: row.review_at.toISOString(),
    status: row.status,
    liftedAt: row.lifted_at ? row.lifted_at.toISOString() : null,
  };
}

// B6, B9: participant existence + atomic INSERT с catch unique.
export async function assignOutsideTrustService(
  participantId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<OutsideTrust> {
  // B9: participant должен существовать.
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!p) {throw new NotFoundError('Участник', participantId);}

  const entity = assignOutsideTrust({ participantId, reason });

  // B6: atomic INSERT — race с параллельным assign → unique violation → 409.
  try {
    await query(
      `INSERT INTO outside_trust_network
         (id, participant_id, reason, valid_from, review_at, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [newUUID(), entity.participantId, entity.reason, entity.validFrom, entity.reviewAt],
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError('Участник уже вне сети доверия');
    }
    throw e;
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'jury.outside_trust', entityType: 'outside_trust', entityId: participantId,
    newValue: { reason },
  });

  return entity;
}

export async function getOutsideTrust(participantId: UUID): Promise<OutsideTrust | null> {
  const row = await queryOne<OutsideRow>(
    `SELECT id, participant_id, reason, valid_from, review_at, status, lifted_at
       FROM outside_trust_network WHERE participant_id = $1 AND status = 'active' LIMIT 1`,
    [participantId],
  );
  return row ? rowToOutside(row) : null;
}

// B7: atomic UPDATE.
export async function reviewOutsideTrust(
  participantId: UUID,
  requesterId: UUID,
): Promise<OutsideTrust> {
  const current = await getOutsideTrust(participantId);
  if (!current) {throw new NotFoundError('Статус вне сети доверия', participantId);}
  if (!canReviewOutsideTrust(current)) {
    throw new ConflictError(`Пересмотр возможен с ${current.reviewAt}`);
  }

  // B7: atomic — 0 rows → параллельный review.
  const result = await query<{ id: string }>(
    `UPDATE outside_trust_network
        SET status = 'lifted', lifted_at = now()
      WHERE participant_id = $1 AND status = 'active'
      RETURNING id`,
    [participantId],
  );
  if (result.length === 0) {
    throw new ConflictError('Статус уже снят параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'jury.review_outside_trust', entityType: 'outside_trust', entityId: participantId,
  });

  return { ...current, status: 'lifted', liftedAt: new Date().toISOString() };
}

// -------- Апелляции --------

interface AppealRow {
  id: string;
  jury_session_id: string | null;
  council_type: string;
  subject_id: string;
  result: string | null;
  decided_at: Date | null;
  created_at: Date;
}

function rowToAppeal(row: AppealRow): Appeal {
  return {
    id: row.id,
    jurySessionId: row.jury_session_id,
    councilType: row.council_type,
    subjectId: row.subject_id,
    result: row.result,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

// B8: pre-check jury_session FK.
export async function createAppeal(
  jurySessionId: UUID | null,
  councilType: string,
  subjectId: UUID,
  requesterId: UUID,
): Promise<Appeal> {
  if (!councilType.trim()) {throw new ValidationError('councilType обязателен');}

  // B8: если передан — сессия должна существовать.
  if (jurySessionId) {
    const s = await queryOne<{ id: string }>(
      `SELECT id FROM jury_sessions WHERE id = $1`,
      [jurySessionId],
    );
    if (!s) {throw new NotFoundError('Сессия Жюри', jurySessionId);}
  }

  const id = newUUID();
  await query(
    `INSERT INTO appeals (id, jury_session_id, council_type, subject_id)
     VALUES ($1, $2, $3, $4)`,
    [id, jurySessionId, councilType, subjectId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'jury.appeal', entityType: 'appeal', entityId: id,
    newValue: { council_type: councilType, subject_id: subjectId },
  });

  const row = await queryOne<AppealRow>(
    `SELECT id, jury_session_id, council_type, subject_id, result, decided_at, created_at
       FROM appeals WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Appeal', id);}
  return rowToAppeal(row);
}