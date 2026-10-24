// A.1.32.01 — Контроллер Automation.
// 13 эндпоинтов: queue, decisions (approve/reject/defer),
// sections (get/create/assign operator/disable),
// operator (audit/should-audit/should-remove/combine), run-daily-audit.
//
// POST /automation/sections — роут сверх спеки (нужен для создания sectionId).
//
// Права: automation (V/C/E/A/Act). Оператор — I.6.15.
// Все мутации через requireRight — self-service нет.
//
// v0.0.02:
//   - P1: импорт assertRight + isRoleValid.
//   - P2: GET /automation/queue — self-service для своей очереди,
//         automation:V для чужой (operator_id ≠ auth.participantId).
//   - P3: GET /automation/sections/:id — requireRight('automation', 'V').
//   - P4: combineQuery.role — refine через isRoleValid; 4× GET /operator/*
//         получили requireRight('automation', 'V').
//   - P5: шапка 12 → 13 эндпоинтов (POST /automation/sections был сверх спеки).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getQueue,
  approveDecision,
  rejectDecision,
  deferDecision,
  getSection,
  createSectionForDirection,
  assignOperator,
  disableSection,
  auditOperator,
  shouldAuditOperator,
  shouldRemoveOperator,
  checkCombineWith,
  runDailyAudit,
} from '../../core/automation/service.js';
import { assertRight } from '../../core/rights.js';
import { isRoleValid } from '../../core/roles.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

const idParams = z.object({ id: uuidSchema });

const queueQuery = z.object({
  operator_id: uuidSchema.optional(),
});

const rejectBody = z.object({
  reason: z.string().min(1, 'Причина обязательна (I.6.15.5)').max(2000),
});

const deferBody = z.object({
  new_deadline: z.string().datetime({ offset: true }),
});

const assignOperatorBody = z.object({
  operator_id: uuidSchema,
});

const disableBody = z.object({
  reason: z.string().min(1, 'Причина обязательна (I.6.15.6)').max(2000),
});

const createSectionBody = z.object({
  direction_id: uuidSchema,
});

const operatorQuery = z.object({
  operator_id: uuidSchema,
});

// P4: combineQuery.role — только валидные роли из Role (см. core/roles.ts).
// Без refine можно было бы передать произвольную строку в checkCombineWith
// и получить false/мусор вместо 422.
const combineQuery = z.object({
  operator_id: uuidSchema,
  role: z.string().min(1).max(64),
}).refine(
  (q) => isRoleValid(q.role),
  { message: 'Неизвестная роль', path: ['role'] },
);

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerAutomationRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── Queue ───────────────────────────────────────────────────
  // GET /automation/queue
  // Без operator_id — берём из auth.participantId.
  // С operator_id — только с правом V (просмотр чужой очереди).
  app.get(
    '/automation/queue',
    { preHandler: [authMiddleware, validateQuery(queueQuery)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof queueQuery>;
      const operatorId = q.operator_id ?? auth.participantId;
      // P2: Self-service (своя очередь) — всегда; чужая — только с automation:V.
      if (operatorId !== auth.participantId) {
        await assertRight({
          participantId: auth.participantId,
          resource: 'automation',
          action: 'V',
          targetId: operatorId,
        });
      }
      const data = await getQueue(operatorId, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── Decisions ───────────────────────────────────────────────

  // POST /automation/decisions/:id/approve (право: automation:E)
  app.post(
    '/automation/decisions/:id/approve',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'E'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const d = await approveDecision(p.id, auth.participantId);
      reply.send({ ...d, audit_id: req.auditId });
    },
  );

  // POST /automation/decisions/:id/reject (право: automation:E)
  // Body: reason — обязателен (I.6.15.5).
  app.post(
    '/automation/decisions/:id/reject',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'E'),
        validateParams(idParams),
        validateBody(rejectBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof rejectBody>;
      const d = await rejectDecision(p.id, b.reason, auth.participantId);
      reply.send({ ...d, audit_id: req.auditId });
    },
  );

  // POST /automation/decisions/:id/defer (право: automation:E)
  app.post(
    '/automation/decisions/:id/defer',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'E'),
        validateParams(idParams),
        validateBody(deferBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof deferBody>;
      const d = await deferDecision(p.id, b.new_deadline, auth.participantId);
      reply.send({ ...d, audit_id: req.auditId });
    },
  );

  // ─── Sections ────────────────────────────────────────────────

  // GET /automation/sections/:id — P3: requireRight('automation', 'V').
  app.get(
    '/automation/sections/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const s = await getSection(p.id, auth.participantId);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  // POST /automation/sections — создать участок (право: automation:C).
  // В спеке этого роута нет, но без него не создать sectionId для
  // последующих операций. Зеркалит createSectionForDirection.
  app.post(
    '/automation/sections',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'C'),
        validateBody(createSectionBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createSectionBody>;
      const s = await createSectionForDirection(b.direction_id, auth.participantId);
      reply.status(201).send({ ...s, audit_id: req.auditId });
    },
  );

  // POST /automation/sections/:id/operator (право: automation:A)
  // Назначить оператора. Проверки canBeOperator + canCombineWith +
  // мандат 6 мес. × 2 срока (I.6.15.1/2/4).
  app.post(
    '/automation/sections/:id/operator',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'A'),
        validateParams(idParams),
        validateBody(assignOperatorBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof assignOperatorBody>;
      const s = await assignOperator(p.id, b.operator_id, auth.participantId);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  // POST /automation/sections/:id/disable (право: automation:A)
  // Ручной режим (I.6.15.6).
  app.post(
    '/automation/sections/:id/disable',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'A'),
        validateParams(idParams),
        validateBody(disableBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof disableBody>;
      const s = await disableSection(p.id, b.reason, auth.participantId);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  // ─── Operator ────────────────────────────────────────────────

  // GET /automation/operator/audit — P4: requireRight('automation', 'V').
  app.get(
    '/automation/operator/audit',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'V'),
        validateQuery(operatorQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof operatorQuery>;
      const a = await auditOperator(q.operator_id, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  // GET /automation/operator/should-audit — P4: requireRight('automation', 'V').
  app.get(
    '/automation/operator/should-audit',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'V'),
        validateQuery(operatorQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof operatorQuery>;
      const should_audit = await shouldAuditOperator(q.operator_id);
      reply.send({ should_audit, audit_id: req.auditId });
    },
  );

  // GET /automation/operator/should-remove — P4: requireRight('automation', 'V').
  app.get(
    '/automation/operator/should-remove',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'V'),
        validateQuery(operatorQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof operatorQuery>;
      const should_remove = await shouldRemoveOperator(q.operator_id);
      reply.send({ should_remove, audit_id: req.auditId });
    },
  );

  // GET /automation/operator/combine — P4: requireRight('automation', 'V').
  app.get(
    '/automation/operator/combine',
    {
      preHandler: [
        authMiddleware,
        requireRight('automation', 'V'),
        validateQuery(combineQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof combineQuery>;
      const can_combine = await checkCombineWith(q.operator_id, q.role);
      reply.send({ can_combine, audit_id: req.auditId });
    },
  );

  // ─── Cron ────────────────────────────────────────────────────

  // POST /automation/run-daily-audit (право: automation:Act)
  // Cron-задача (I.3.05.07). Идемпотентна — аудит пишется каждый раз,
  // но удаление происходит только при ошибках > 3.
  app.post(
    '/automation/run-daily-audit',
    { preHandler: [authMiddleware, requireRight('automation', 'Act')] },
    async (req, reply) => {
      const result = await runDailyAudit();
      reply.send({ ...result, audit_id: req.auditId });
    },
  );
}