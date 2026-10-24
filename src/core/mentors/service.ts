// C.0.45.01 — Наставничество: назначение наставника ученику.
//
// Хартия 6.1/6.3: стажёр не имеет самостоятельного плана и прикреплён к
// наставнику; наставник отвечает за его первые шаги. Поэтому назначение
// наставника — не «поле в профиле», а событие: наставник получает карточку
// ученика, балансировка — +1 ученика, всё пишется в аудит.
//
// Реестр наставников — integrator_mentors (C.0.28.01): один наставник =
// одна строка на направление со списком учеников.

import { queryOne } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { send as sendNotification } from '../../lib/notifications.js';
import { listParticipantsWithRole } from '../../security/rbac.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import {
  addIntegratorMenteeService,
  assignIntegratorService,
  listIntegrators,
} from '../learning/service.js';
import { Role } from '../roles.js';
import type { UUID } from '../types.js';

export interface Mentorship {
  mentorId: UUID;
  menteeId: UUID;
  directionId: UUID;
}

interface PersonRow {
  id: string;
  name: string;
  external_id: string;
  direction_id: string | null;
}

async function notifySafely(
  recipientId: UUID,
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await sendNotification({
      recipientId,
      type,
      priority: 'standard',
      title,
      body,
      data,
    });
  } catch (e) {
    logger.warn({ err: e, recipientId, type }, 'mentorship notification failed');
  }
}

export async function assignMentorService(
  menteeId: UUID,
  mentorId: UUID,
  requesterId: UUID,
): Promise<Mentorship> {
  if (menteeId === mentorId) {
    throw new ValidationError('Участник не может быть наставником самому себе');
  }

  const mentee = await queryOne<PersonRow>(
    `SELECT id, name, external_id, direction_id
       FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [menteeId],
  );
  if (!mentee) {throw new NotFoundError('Участник', menteeId);}

  const mentor = await queryOne<PersonRow>(
    `SELECT id, name, external_id, direction_id
       FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [mentorId],
  );
  if (!mentor) {throw new NotFoundError('Наставник', mentorId);}

  const directionId = mentee.direction_id ?? mentor.direction_id;
  if (!directionId) {
    throw new ConflictError(
      'У участника и наставника нет направления — сначала назначьте направление',
    );
  }

  // Наставник может ещё не быть в реестре интеграторов — заводим строку.
  try {
    await assignIntegratorService(mentorId, directionId, requesterId);
  } catch (e) {
    if (!(e instanceof ConflictError)) {throw e;}
  }
  const registry = await addIntegratorMenteeService(mentorId, menteeId, requesterId);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'mentors.assign',
    entityType: 'participant',
    entityId: menteeId,
    newValue: { mentor_id: mentorId, direction_id: directionId },
  });

  const data = {
    participantId: menteeId,
    mentorId,
    link: `/admin/participants?selected=${menteeId}`,
  };

  // Наставник получает карточку ученика сразу — не нужно искать самому.
  await notifySafely(
    mentorId,
    'mentor.assigned',
    'У вас новый ученик',
    `${mentee.name} (${mentee.external_id}). Задачи и прогресс — в карточке участника.`,
    data,
  );

  // Балансировка: у наставника появился ученик.
  try {
    const balancers = await listParticipantsWithRole(Role.BALANCER);
    for (const recipientId of balancers) {
      await notifySafely(
        recipientId,
        'mentor.balancing',
        'Наставник получил ученика',
        `${mentor.name} → ${mentee.name} (${mentee.external_id}).`,
        data,
      );
    }
  } catch (e) {
    logger.warn({ err: e, mentorId }, 'balancing notification failed');
  }

  return {
    mentorId,
    menteeId,
    directionId,
    ...(registry ? {} : {}),
  };
}

/** Наставники направления (или все) — для выбора в админке. */
export async function listMentorRegistry(directionId?: UUID) {
  return listIntegrators(directionId);
}

/** Карточка ученика для наставника: кто он, что делает, как продвигается. */
export async function getMenteeCard(menteeId: UUID): Promise<{
  participant: { id: UUID; name: string; externalId: string; directionId: UUID | null };
  mentorId: string | null;
  tasks: { total: number; inWork: number; accepted: number };
  flows: number;
}> {
  const participant = await queryOne<PersonRow>(
    `SELECT id, name, external_id, direction_id
       FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [menteeId],
  );
  if (!participant) {throw new NotFoundError('Участник', menteeId);}

  const mentorRow = await queryOne<{ mentor_id: string }>(
    `SELECT mentor_id FROM integrator_mentors
      WHERE mentees @> to_jsonb(ARRAY[$1::text])
      LIMIT 1`,
    [menteeId],
  );

  const stats = await queryOne<{ total: string; in_work: string; accepted: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status IN ('assigned','in_progress','submitted'))::text AS in_work,
            COUNT(*) FILTER (WHERE status = 'accepted')::text AS accepted
       FROM tasks WHERE assigned_to = $1`,
    [menteeId],
  );

  const flows = await queryOne<{ sum: string | null }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS sum
       FROM flow_transactions WHERE participant_id = $1`,
    [menteeId],
  );

  return {
    participant: {
      id: participant.id as UUID,
      name: participant.name,
      externalId: participant.external_id,
      directionId: (participant.direction_id as UUID | null) ?? null,
    },
    mentorId: mentorRow?.mentor_id ?? null,
    tasks: {
      total: parseInt(stats?.total ?? '0', 10),
      inWork: parseInt(stats?.in_work ?? '0', 10),
      accepted: parseInt(stats?.accepted ?? '0', 10),
    },
    flows: parseInt(flows?.sum ?? '0', 10),
  };
}
