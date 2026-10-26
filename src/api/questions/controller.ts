// A.1.04.22 — Вопросы наставнику.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createQuestion,
  listQuestions,
  answerQuestion,
  escalateQuestion,
  getQuestionsSla,
} from '../../core/questions/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  status: z.enum(['open', 'answered', 'escalated', 'closed']).optional(),
  mentor_id: uuidSchema.optional(),
  cell_id: uuidSchema.optional(),
  mine: z.coerce.boolean().optional(),
});

const createBody = z.object({
  question: z.string().min(10).max(4000),
  mentor_id: uuidSchema.optional(),
  cell_id: uuidSchema.optional(),
  task_id: uuidSchema.optional(),
  channel_id: z.string().max(64).optional(),
});

const answerBody = z.object({ answer: z.string().min(5).max(8000) });

export async function registerQuestionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/questions/sla',
    { preHandler: [authMiddleware] },
    async (req, reply) => {
      reply.send({ ...(await getQuestionsSla()), audit_id: req.auditId });
    },
  );

  app.get(
    '/questions',
    { preHandler: [authMiddleware, validateQuery(listQuery)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listQuery>;
      const data = await listQuestions({
        ...(q.status ? { status: q.status } : {}),
        ...(q.mentor_id ? { mentorId: q.mentor_id } : {}),
        ...(q.cell_id ? { cellId: q.cell_id } : {}),
        ...(q.mine ? { mine: auth.participantId } : {}),
      });
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.post(
    '/questions',
    { preHandler: [authMiddleware, validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const question = await createQuestion({
        question: b.question,
        mentorId: b.mentor_id ?? null,
        cellId: b.cell_id ?? null,
        taskId: b.task_id ?? null,
        channelId: b.channel_id ?? null,
      }, auth.participantId);
      reply.status(201).send({ ...question, audit_id: req.auditId });
    },
  );

  app.post(
    '/questions/:id/answer',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(answerBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof answerBody>;
      reply.send({
        ...(await answerQuestion(p.id, b.answer, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/questions/:id/escalate',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      reply.send({
        ...(await escalateQuestion(p.id, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );
}
