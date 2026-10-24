// A.1.41.01 — Dev-инструменты: вход под тестовым ником.
//
// Зачем: проверять продукт глазами разных ролей (новичок, ОТК, куратор) без
// ручного ввода паролей и без создания «настоящих» учёток на каждую проверку.
//
// Безопасность:
//   - маршруты вообще не регистрируются, если NODE_ENV === 'production'
//     (а не «возвращают 403» — их просто нет в таблице роутов);
//   - кроме этого, вызывать их может только FIRST_ARCHITECT;
//   - выдаётся полноценная сессия (issueTokens пишет её в Redis), поэтому
//     вход ограничен теми же сроками, что и обычный логин.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ForbiddenError, NotFoundError } from '../../core/errors.js';
import { getById } from '../../core/participants/service.js';
import { Role, pickPrimaryRole } from '../../core/roles.js';
import { query } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { issueTokens } from '../../security/jwt.js';
import { getEffectiveRoles, hasRole } from '../../security/rbac.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateParams } from '../middleware/validation.js';

const idParams = z.object({ id: z.string().uuid() });

interface DevParticipantRow {
  id: string;
  external_id: string;
  name: string;
  status: string;
  direction_number: number | null;
  direction_name: string | null;
}

async function requireArchitect(participantId: string): Promise<void> {
  if (!(await hasRole(participantId, Role.FIRST_ARCHITECT))) {
    throw new ForbiddenError('Dev-вход доступен только FIRST_ARCHITECT');
  }
}

export async function registerDevRoutes(app: FastifyInstance): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {return;}

  // GET /dev/participants — кого можно примерить.
  app.get('/dev/participants', { preHandler: [authMiddleware] }, async (req, reply) => {
    const auth = getAuthContext(req);
    await requireArchitect(auth.participantId);

    const rows = await query<DevParticipantRow>(
      `SELECT p.id, p.external_id, p.name, p.status,
              d.number AS direction_number, d.name AS direction_name
         FROM participants p
         LEFT JOIN directions d ON d.id = p.direction_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT 50`,
    );

    reply.send({
      data: rows.map((r) => ({
        id: r.id,
        externalId: r.external_id,
        name: r.name,
        status: r.status,
        direction:
          r.direction_number !== null && r.direction_name !== null
            ? { number: r.direction_number, name: r.direction_name }
            : null,
      })),
    });
  });

  // POST /dev/impersonate/:id — выдать сессию от имени участника.
  app.post(
    '/dev/impersonate/:id',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      await requireArchitect(auth.participantId);

      const { id } = req.params as z.infer<typeof idParams>;
      const participant = await getById(id).catch(() => {
        throw new NotFoundError('Участник', id);
      });

      const roles = await getEffectiveRoles(participant.id);
      const primaryRole = pickPrimaryRole(roles) ?? Role.ASSOCIATED;

      const tokens = await issueTokens({
        sub: participant.id,
        externalId: participant.externalId,
        role: primaryRole,
        directionId: participant.directionId,
        sessionId: newUUID(),
      });

      reply.send({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        role: primaryRole,
        participant: {
          id: participant.id,
          externalId: participant.externalId,
          name: participant.name,
        },
      });
    },
  );
}
