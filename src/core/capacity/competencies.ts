// C.0.28.06 — Компетенции участника.
//
// Нужны для расчёта ёмкости: спрос задач против наличия людей.
// Уровень 1..5; verified выставляет ОТК/Архитектор (пока не проверяется).

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

export interface Competency {
  competency: string;
  level: number;
  verified: boolean;
}

export async function listCompetencies(participantId: UUID): Promise<Competency[]> {
  const rows = await query<{ competency: string; level: number; verified: boolean }>(
    `SELECT competency, level, verified
       FROM participant_competencies
      WHERE participant_id = $1
      ORDER BY competency`,
    [participantId],
  );
  return rows.map((r) => ({ competency: r.competency, level: r.level, verified: r.verified }));
}

export async function setCompetency(
  participantId: UUID,
  input: { competency: string; level: number; verified?: boolean },
  requesterId: UUID,
): Promise<Competency> {
  const competency = input.competency.trim();
  if (competency.length === 0 || competency.length > 64) {
    throw new ValidationError('Компетенция: 1..64 символа');
  }
  if (!Number.isInteger(input.level) || input.level < 1 || input.level > 5) {
    throw new ValidationError('Уровень компетенции: целое 1..5');
  }

  const exists = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!exists) {throw new NotFoundError('Участник', participantId);}

  await query(
    `INSERT INTO participant_competencies (id, participant_id, competency, level, verified)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (participant_id, competency)
     DO UPDATE SET level = EXCLUDED.level,
                   verified = participant_competencies.verified OR EXCLUDED.verified,
                   updated_at = now()`,
    [newUUID(), participantId, competency, input.level, input.verified ?? false],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'competencies.set', entityType: 'participant', entityId: participantId,
    newValue: { competency, level: input.level, verified: input.verified ?? false },
  });

  return {
    competency,
    level: input.level,
    verified: input.verified ?? false,
  };
}

export async function removeCompetency(
  participantId: UUID,
  competency: string,
  requesterId: UUID,
): Promise<void> {
  await query(
    `DELETE FROM participant_competencies WHERE participant_id = $1 AND competency = $2`,
    [participantId, competency],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'competencies.remove', entityType: 'participant', entityId: participantId,
    newValue: { competency },
  });
}
