// C.1.11.01 — Permit (§10.3, Фаза 3b).
//
// Permit НЕ выводится из уровней атомов (§10.3): высокий уровень P=9
// не даёт допуск. Допуск — отдельная процедура с эмитентом.
//
// A33–A37:
//   * issued_by — свободный текст (внешний орган), без интеграций.
//   * created_by — UUID актора (для аудита).
//   * Создание: FA | COUNCIL_MEMBER.
//   * Выдача: FA | OTC | COUNCIL_MEMBER.
//   * Отзыв: issued_by (participant_permits.issued_by) | FA.
//   * valid_until опционален (null = бессрочно).
//
// Effective valid_until = min(participant_permits.valid_until, permits.valid_until).
// isExpired вычисляется на чтении, status в БД не переписывается
// (cron-задача — Фаза 3c).
//
// event_type: permit_issued / permit_revoked.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import type {
  CreatePermitInput,
  IssuePermitInput,
  ParticipantPermit,
  ParticipantPermitRow,
  Permit,
  PermitRow,
  PermitStatus,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Роли
// ─────────────────────────────────────────────────────────────────────

const PERMIT_CREATOR_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER'] as const;
const PERMIT_ISSUER_ROLES = ['FIRST_ARCHITECT', 'OTC', 'COUNCIL_MEMBER'] as const;

async function hasAnyRole(
  participantId: UUID,
  roleNames: readonly string[],
): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [participantId, [...roleNames]],
  );
  return (row?.n ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────
// Маппинг
// ─────────────────────────────────────────────────────────────────────

function toPermit(r: PermitRow): Permit {
  return {
    permitId: r.permit_id,
    name: r.name,
    issuedBy: r.issued_by,
    scope: r.scope,
    validUntil: r.valid_until ? r.valid_until.toISOString() : null,
    verificationMethod: r.verification_method,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function toParticipantPermit(
  r: ParticipantPermitRow & { permit_valid_until: Date | null },
): ParticipantPermit {
  const effective = pickEffectiveValidUntil(r.valid_until, r.permit_valid_until);
  const now = new Date();
  const isExpired =
    r.status === 'expired' ||
    (effective !== null && effective.getTime() < now.getTime());
  return {
    id: r.id,
    participantId: r.participant_id,
    permitId: r.permit_id,
    issuedAt: r.issued_at.toISOString(),
    validUntil: r.valid_until ? r.valid_until.toISOString() : null,
    verificationData: r.verification_data,
    status: r.status,
    issuedBy: r.issued_by,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    revokedBy: r.revoked_by,
    revokeReason: r.revoke_reason,
    createdAt: r.created_at.toISOString(),
    effectiveValidUntil: effective ? effective.toISOString() : null,
    isExpired,
  };
}

export function pickEffectiveValidUntil(
  ppValidUntil: Date | null,
  permitValidUntil: Date | null,
): Date | null {
  if (ppValidUntil === null && permitValidUntil === null) {return null;}
  if (ppValidUntil === null) {return permitValidUntil;}
  if (permitValidUntil === null) {return ppValidUntil;}
  return ppValidUntil.getTime() < permitValidUntil.getTime()
    ? ppValidUntil
    : permitValidUntil;
}

// ─────────────────────────────────────────────────────────────────────
// Справочник: create / list
// ─────────────────────────────────────────────────────────────────────

export async function createPermit(
  actorId: UUID,
  input: CreatePermitInput,
): Promise<Permit> {
  if (!(await hasAnyRole(actorId, PERMIT_CREATOR_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER can create permits',
      { allowed_roles: [...PERMIT_CREATOR_ROLES] },
    );
  }
  if (!/^PERMIT\.[A-Z][A-Z0-9_]*\.[0-9]{4}$/.test(input.permitId)) {
    throw new ValidationError(
      'permitId must match PERMIT.NAME.NNNN (e.g. PERMIT.HEIGHT.0001)',
    );
  }
  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('name must not be empty');
  }
  if (!input.issuedBy || input.issuedBy.trim().length === 0) {
    throw new ValidationError('issuedBy must not be empty');
  }
  if (!input.verificationMethod || input.verificationMethod.trim().length === 0) {
    throw new ValidationError('verificationMethod must not be empty');
  }

  return transaction(async (client) => {
    const dup = await client.query<{ permit_id: string }>(
      `SELECT permit_id FROM permits WHERE permit_id = $1 FOR UPDATE`,
      [input.permitId],
    );
    if (dup.rows.length > 0) {
      throw new ConflictError('Permit already exists', {
        permit_id: input.permitId,
      });
    }

    const ins = await client.query<PermitRow>(
      `INSERT INTO permits
         (permit_id, name, issued_by, scope, valid_until,
          verification_method, status, created_by)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6,'active',$7)
       RETURNING permit_id, name, issued_by, scope, valid_until,
                 verification_method, status, created_by, created_at, updated_at`,
      [
        input.permitId,
        input.name.trim(),
        input.issuedBy.trim(),
        input.scope ?? null,
        input.validUntil ?? null,
        input.verificationMethod.trim(),
        actorId,
      ],
    );
    const row = ins.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'permit_issued', $2::jsonb, $3)`,
      [
        actorId,
        JSON.stringify({
          permit_id: row.permit_id,
          kind: 'catalog_created',
          name: row.name,
        }),
        actorId,
      ],
    );

    return toPermit(row);
  });
}

export async function listPermits(
  status: PermitStatus = 'active',
): Promise<Permit[]> {
  const rows = await query<PermitRow>(
    `SELECT permit_id, name, issued_by, scope, valid_until,
            verification_method, status, created_by, created_at, updated_at
       FROM permits
      WHERE status = $1
      ORDER BY permit_id`,
    [status],
  );
  return rows.map(toPermit);
}

// ─────────────────────────────────────────────────────────────────────
// Выдача участнику
// ─────────────────────────────────────────────────────────────────────

export async function issuePermitToParticipant(
  actorId: UUID,
  input: IssuePermitInput,
): Promise<ParticipantPermit> {
  if (!(await hasAnyRole(actorId, PERMIT_ISSUER_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | OTC | COUNCIL_MEMBER can issue permits',
      { allowed_roles: [...PERMIT_ISSUER_ROLES] },
    );
  }

  return transaction(async (client) => {
    const permitRes = await client.query<PermitRow>(
      `SELECT permit_id, name, issued_by, scope, valid_until,
              verification_method, status, created_by, created_at, updated_at
         FROM permits WHERE permit_id = $1
         FOR UPDATE`,
      [input.permitId],
    );
    const permit = permitRes.rows[0];
    if (!permit) {
      throw new NotFoundError('Permit', input.permitId);
    }
    if (permit.status !== 'active') {
      throw new ConflictError(
        `Permit is '${permit.status}', cannot issue`,
        { permit_id: permit.permit_id },
      );
    }

    const participant = await client.query<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
      [input.participantId],
    );
    if (participant.rows.length === 0) {
      throw new NotFoundError('Participant', input.participantId);
    }

    const active = await client.query<{ id: string }>(
      `SELECT id FROM participant_permits
        WHERE participant_id = $1 AND permit_id = $2 AND status = 'active'
        FOR UPDATE`,
      [input.participantId, input.permitId],
    );
    if (active.rows.length > 0) {
      throw new ConflictError('Active permit already issued', {
        participant_permit_id: active.rows[0]!.id,
      });
    }

    const id = newUUID();
    const ins = await client.query<
      ParticipantPermitRow & { permit_valid_until: Date | null }
    >(
      `INSERT INTO participant_permits
         (id, participant_id, permit_id, valid_until,
          verification_data, status, issued_by)
       VALUES ($1,$2,$3,$4::timestamptz,$5::jsonb,'active',$6)
       RETURNING id, participant_id, permit_id, issued_at, valid_until,
                 verification_data, status, issued_by,
                 revoked_at, revoked_by, revoke_reason, created_at,
                 (SELECT valid_until FROM permits WHERE permit_id = $3)
                   AS permit_valid_until`,
      [
        id,
        input.participantId,
        input.permitId,
        input.validUntil ?? null,
        JSON.stringify(input.verificationData ?? {}),
        actorId,
      ],
    );
    const row = ins.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'permit_issued', $2::jsonb, $3)`,
      [
        actorId,
        JSON.stringify({
          participant_permit_id: id,
          permit_id: input.permitId,
          subject_participant_id: input.participantId,
        }),
        actorId,
      ],
    );

    return toParticipantPermit(row);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Отзыв
// ─────────────────────────────────────────────────────────────────────

export async function revokeParticipantPermit(
  actorId: UUID,
  participantPermitId: UUID,
  reason: string,
): Promise<ParticipantPermit> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError('reason is required');
  }

  return transaction(async (client) => {
    const cur = await client.query<
      ParticipantPermitRow & { permit_valid_until: Date | null }
    >(
      `SELECT pp.id, pp.participant_id, pp.permit_id, pp.issued_at,
              pp.valid_until, pp.verification_data, pp.status, pp.issued_by,
              pp.revoked_at, pp.revoked_by, pp.revoke_reason, pp.created_at,
              p.valid_until AS permit_valid_until
         FROM participant_permits pp
         JOIN permits p ON p.permit_id = pp.permit_id
        WHERE pp.id = $1
        FOR UPDATE`,
      [participantPermitId],
    );
    const row = cur.rows[0];
    if (!row) {
      throw new NotFoundError('Participant permit', participantPermitId);
    }

    // Идемпотентно: уже revoked → возвращаем как есть.
    if (row.status === 'revoked') {
      return toParticipantPermit(row);
    }

    const isIssuer = row.issued_by === actorId;
    const isFA = await hasAnyRole(actorId, ['FIRST_ARCHITECT']);
    if (!isIssuer && !isFA) {
      throw new ForbiddenError(
        'Only the issuer or FIRST_ARCHITECT can revoke a permit',
      );
    }

    const upd = await client.query<
      ParticipantPermitRow & { permit_valid_until: Date | null }
    >(
      `UPDATE participant_permits
          SET status = 'revoked',
              revoked_at = now(),
              revoked_by = $2,
              revoke_reason = $3
        WHERE id = $1
        RETURNING id, participant_id, permit_id, issued_at, valid_until,
                  verification_data, status, issued_by,
                  revoked_at, revoked_by, revoke_reason, created_at,
                  (SELECT valid_until FROM permits
                    WHERE permit_id = participant_permits.permit_id)
                    AS permit_valid_until`,
      [participantPermitId, actorId, reason.trim()],
    );
    const updated = upd.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'permit_revoked', $2::jsonb, $3)`,
      [
        actorId,
        JSON.stringify({
          participant_permit_id: participantPermitId,
          permit_id: row.permit_id,
          subject_participant_id: row.participant_id,
          reason: reason.trim(),
        }),
        actorId,
      ],
    );

    return toParticipantPermit(updated);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Чтение: свои / чужие
// ─────────────────────────────────────────────────────────────────────

export async function getParticipantPermits(
  subjectId: UUID,
  viewerId: UUID,
): Promise<ParticipantPermit[]> {
  const isSelf = subjectId === viewerId;

  // Свои: все статусы (для истории).
  // Чужие: только active + без verification_data (§18.2).
  const sql = isSelf
    ? `SELECT pp.id, pp.participant_id, pp.permit_id, pp.issued_at,
              pp.valid_until, pp.verification_data, pp.status, pp.issued_by,
              pp.revoked_at, pp.revoked_by, pp.revoke_reason, pp.created_at,
              p.valid_until AS permit_valid_until
         FROM participant_permits pp
         JOIN permits p ON p.permit_id = pp.permit_id
        WHERE pp.participant_id = $1
        ORDER BY pp.created_at DESC`
    : `SELECT pp.id, pp.participant_id, pp.permit_id, pp.issued_at,
              pp.valid_until, '{}'::jsonb AS verification_data, pp.status,
              pp.issued_by, pp.revoked_at, pp.revoked_by, pp.revoke_reason,
              pp.created_at,
              p.valid_until AS permit_valid_until
         FROM participant_permits pp
         JOIN permits p ON p.permit_id = pp.permit_id
        WHERE pp.participant_id = $1 AND pp.status = 'active'
        ORDER BY pp.created_at DESC`;

  const rows = await query<
    ParticipantPermitRow & { permit_valid_until: Date | null }
  >(sql, [subjectId]);

  return rows.map(toParticipantPermit);
}