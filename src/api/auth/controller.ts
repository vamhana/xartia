// A.1.01.01 — Контроллер Auth
// Регистрация, вход, refresh, logout, статус заявки.
// Восстановление доступа (флоу B): request → approve → confirm.
//
// v0.0.05:
//   - P4: ALLOW_DEV_TOKEN — fail-closed. isDevEnv = NODE_ENV ∈
//     {development, dev, local}. Незаданный NODE_ENV → dev-token НЕ
//     выдаётся (было: !== 'production' → fail-open).
//   - P5: refreshSchema.refresh_token — regex JWT-формата, .max(2000).
//     "a" теперь даёт 422, а не 401 из rotateRefresh.
//   - P8: /auth/logout и /auth/recover/approve — pre-auth rate-limit
//     по IP (до authMiddleware), иначе невалидный Bearer не тратит quota.
//   - P11: GET /auth/status/:request_id больше не отдаёт interview_at
//     (PII утекала на публичном роуте).
//   - P13: ApproveRecoveryResult.token защищён toJSON(): never в C.0.02.02.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { logAction } from '../../core/audit.js';
import { UnauthorizedError } from '../../core/errors.js';
import {
  register,
  verifyCredentials,
  getRegistrationStatus,
  createRecoveryRequest,
  approveRecoveryRequest,
  consumeRecoveryToken,
} from '../../core/participants/service.js';
import { Role, pickPrimaryRole } from '../../core/roles.js';
import { phoneSchema, messengerSchema, uuidSchema } from '../../lib/validators.js';
import { issueTokens, rotateRefresh, revokeSession, revokeToken } from '../../security/jwt.js';
import { validatePasswordOrThrow, DEFAULT_POLICY } from '../../security/password.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { getEffectiveRoles } from '../../security/rbac.js';
import { authMiddleware, extractBearer, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

// -------- Схемы --------

const registerSchema = z.object({
  phone: phoneSchema,
  messengers: messengerSchema,
  password: z.string().min(12).max(128),
  consent_video: z.literal(true),
  consent_data: z.literal(true),
});

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(128),
});

// P5: "a" — не JWT. Раньше проходил min(1), падал в rotateRefresh → 401.
// Теперь 422 на уровне Zod. .max(2000) — защита от огромных строк.
const refreshSchema = z.object({
  refresh_token: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      'Не JWT-формат',
    )
    .max(2000),
});

const requestIdParams = z.object({ request_id: uuidSchema });

const recoveryRequestBody = z.object({
  phone: phoneSchema,
});

const recoveryConfirmBody = z.object({
  token: z.string().min(32).max(128),
  new_password: z.string().min(12).max(128),
});

// P8: pre-auth лимит для /auth/logout и /auth/recover/approve.
// Инлайн-конфиг (scenario — для уникального Redis-ключа).
// 30/мин на IP — с запасом на легитимные логины/approve, но отсекает
// анонимный спам невалидными Bearer (иначе authMiddleware отклоняет
// ДО rateLimit, и quota не тратится).
const authPreLimit = (scenario: string) => ({
  config: {
    windowMs: 60_000,
    max: 30,
    keyBy: 'ip' as const,
    scenario,
  },
});

// -------- Регистрация роутов --------

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/register
  app.post(
    '/auth/register',
    {
      preHandler: [
        rateLimit({ config: mustGetLimit('auth.register') }),
        validateBody(registerSchema),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof registerSchema>;

      validatePasswordOrThrow(body.password, DEFAULT_POLICY, { phone: body.phone });

      const result = await register({
        phone: body.phone,
        messengers: body.messengers,
        password: body.password,
        consentVideo: body.consent_video,
        consentData: body.consent_data,
      });

      reply.status(201).send({
        request_id: result.requestId,
        status: result.status,
        audit_id: request.auditId,
      });
    },
  );

  // POST /auth/login
  app.post(
    '/auth/login',
    {
      preHandler: [
        rateLimit({ config: mustGetLimit('auth.login') }),
        validateBody(loginSchema),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof loginSchema>;

      const { participant, sessionId } = await verifyCredentials(body.phone, body.password);

      const effectiveRoles = await getEffectiveRoles(participant.id);
      const primaryRole = pickPrimaryRole(effectiveRoles) ?? Role.ASSOCIATED;

      const tokens = await issueTokens({
        sub: participant.id,
        externalId: participant.externalId,
        role: primaryRole,
        directionId: participant.directionId,
        sessionId,
      });

      reply.send({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        token_type: tokens.tokenType,
        participant: {
          id: participant.id,
          external_id: participant.externalId,
          name: participant.name,
          direction_id: participant.directionId,
        },
        audit_id: request.auditId,
      });
    },
  );

  // POST /auth/refresh
  app.post(
    '/auth/refresh',
    {
      preHandler: [
        rateLimit({ config: mustGetLimit('auth.refresh') }),
        validateBody(refreshSchema),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof refreshSchema>;
      const tokens = await rotateRefresh(body.refresh_token, async (participantId) => {
        const roles = await getEffectiveRoles(participantId);
        return pickPrimaryRole(roles) ?? Role.ASSOCIATED;
      });
      reply.send({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        token_type: tokens.tokenType,
        audit_id: request.auditId,
      });
    },
  );

  // POST /auth/logout
  // P8: pre-auth rateLimit по IP → authMiddleware → api.write.
  app.post(
    '/auth/logout',
    {
      preHandler: [
        rateLimit(authPreLimit('auth.logout.pre')),
        authMiddleware,
        rateLimit({ config: mustGetLimit('api.write') }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = getAuthContext(request);
      const token = extractBearer(request);
      if (!token) {
        throw new UnauthorizedError('Требуется авторизация', 'NO_TOKEN');
      }

      await revokeSession(auth.sessionId);
      await revokeToken(token, 'logout');

      await logAction({
        actorId: auth.participantId,
        actorType: 'participant',
        action: 'auth.logout',
        entityType: 'participant',
        entityId: auth.participantId,
      });

      reply.status(204).send();
    },
  );

  // GET /auth/status/:request_id
  // P11: interview_at — PII, убрано из публичного ответа. Если нужно
  // показывать кандидату — отдельный защищённый endpoint (по токену).
  app.get(
    '/auth/status/:request_id',
    {
      preHandler: [
        rateLimit({ config: mustGetLimit('auth.status') }),
        validateParams(requestIdParams),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as z.infer<typeof requestIdParams>;
      const status = await getRegistrationStatus(params.request_id);
      reply.send({
        request_id: status.requestId,
        status: status.status,
        audit_id: request.auditId,
      });
    },
  );

  // ─────── Recovery (флоу B, S.0.01.04) ───────

  // POST /auth/recover/request
  app.post(
    '/auth/recover/request',
    {
      preHandler: [
        rateLimit({ config: mustGetLimit('auth.recover.request') }),
        validateBody(recoveryRequestBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof recoveryRequestBody>;

      const result = await createRecoveryRequest({
        phone: body.phone,
        requestedIp: request.ip,
      });

      reply.status(201).send({
        request_id: result.requestId,
        status: result.status,
        audit_id: request.auditId,
      });
    },
  );

  // POST /auth/recover/approve/:request_id
  // P8: pre-auth rateLimit по IP до authMiddleware.
  app.post<{ Params: { request_id: string } }>(
    '/auth/recover/approve/:request_id',
    {
      preHandler: [
        rateLimit(authPreLimit('auth.recover.approve.pre')),
        authMiddleware,
        rateLimit({ config: mustGetLimit('auth.recover.approve') }),
        validateParams(requestIdParams),
        requireRight(
          'recovery_request',
          'A',
          undefined,
          (req: FastifyRequest) => (req.params as { request_id: string }).request_id,
        ),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = getAuthContext(request);
      const params = request.params as z.infer<typeof requestIdParams>;

      const result = await approveRecoveryRequest(params.request_id, auth.participantId);

      // P4: fail-closed. NODE_ENV не задан → dev-token НЕ выдаётся.
      // Раньше было `!== 'production'` — новый стенд без NODE_ENV
      // утекал токен восстановления в HTTP-ответ.
      const nodeEnv = process.env['NODE_ENV'];
      const isDevEnv =
        nodeEnv === 'development' ||
        nodeEnv === 'dev' ||
        nodeEnv === 'local';
      const allowDevToken =
        isDevEnv &&
        (process.env['ALLOW_DEV_TOKEN'] === 'true' ||
          process.env['ALLOW_DEV_TOKEN'] === '1');

      const payload: Record<string, unknown> = {
        request_id: result.requestId,
        expires_at: result.expiresAt,
        delivered_via: result.deliveredVia,
        audit_id: request.auditId,
      };
      if (result.deliveredVia.length === 0) {
        payload['warning'] =
          'Токен сгенерирован, но не доставлен — сбой сервиса уведомлений. Заявка в статусе approved; отклоните и создайте новую, когда сервис восстановится';
        payload['undelivered'] = true;
      }
      if (allowDevToken) {
        payload['dev_token'] = result.token;
      }

      reply.send(payload);
    },
  );

  // POST /auth/recover/confirm
  app.post(
    '/auth/recover/confirm',
    {
      preHandler: [
        rateLimit({ config: mustGetLimit('auth.recover.confirm') }),
        validateBody(recoveryConfirmBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof recoveryConfirmBody>;

      validatePasswordOrThrow(body.new_password, DEFAULT_POLICY);

      await consumeRecoveryToken(body.token, body.new_password);

      reply.send({
        ok: true,
        audit_id: request.auditId,
      });
    },
  );
}