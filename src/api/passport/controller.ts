// A.1.48.01 — Контроллер «Профессиональный паспорт» (Фаза 1, шаги 3+4).
//
// Шаг 3 (read-only, каталог):
//   GET /passport/catalog              — каталожный список атомов
//   GET /passport/atoms/:atomId        — каталожная карточка атома
//   GET /passport/history              — своя история (participant_id = auth)
//
// Шаг 4 (запись и проекция):
//   GET  /passport/me                       — обзор (масштаб 1)
//   GET  /passport/atoms/:atomId/card       — персональная карточка (масштаб 3)
//   POST /passport/evidence                 — заявить доказательство
//   POST /passport/assessments              — оценка уполномоченным
//   POST /passport/appeals                  — апелляция
//   POST /passport/paths                    — фантомный маршрут (цель)
//
// Шаг 5 (приватность и чужой паспорт):
//   GET    /passport/visibility             — свои настройки видимости
//   PATCH  /passport/visibility             — изменить свои настройки
//   GET    /passport/people/:id             — чужой обзор (scope + grant)
//   GET    /passport/access-log             — свой журнал доступа
//   GET    /passport/grants                 — свои гранты
//   POST   /passport/grants                 — создать грант
//   DELETE /passport/grants/:grantId        — отозвать грант
//
// Не конфликтует со старым /me/passport (participants/controller.ts).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  disputeEvidence,
  resolveDispute,
  reuseEvidence,
} from '../../core/passport/evidence.js';
import { resolveAppeal } from '../../core/passport/appeal.js';
import {
  getAtomById,
  getCatalog,
  getRelationsForAtom,
} from '../../core/passport/catalog.js';
import { getAtomDirections, getDirections } from '../../core/passport/directions.js';
import { getHistory } from '../../core/passport/history.js';
import {
  submitEvidence,
  submitAssessment,
  submitAppeal,
  createPath,
} from '../../core/passport/assessment.js';
import { getAtomCard, getOverview } from '../../core/passport/projection.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';
import { uuidSchema, uuidIdParams } from '../../lib/validators.js';
import {
  getVisibilityAll,
  getVisibility,
  setVisibility,
  recordAccess,
  listAccessLog,
  maskOverview,
  resolveScopeGrant,
  listGrants,
  createGrant,
  revokeGrant,
} from '../../core/passport/visibility.js';
import { query, queryOne } from '../../lib/db.js';
import {
  createTaskProfile,
  getTaskProfile,
  updateTaskProfile,
} from '../../core/passport/task-profile.js';
import {
  assignRelation,
  computeReadiness,
  getMentorsForAtom,
  getMentorsForMentee,
  getStudentsForMentor,
  revokeRelation,
  answerMentorQuestion,
  createMentorQuestion,
  getMentorQuestions,
  getMyQuestions,
} from '../../core/passport/teaching.js';
import {
  getCandidates,
  matchTask,
} from '../../core/passport/matching.js';
import {
  createPermit,
  getParticipantPermits,
  issuePermitToParticipant,
  listPermits,
  revokeParticipantPermit,
} from '../../core/passport/permits.js';
import {
  assessTeam,
  createTeam,
  getTeam,
  getTeamHistory,
  listTeamsForViewer,
  updateTeam,
  deprecateTeam,
} from '../../core/passport/teams.js';
import {
  assignAnchor,
  createAnchor,
  createSession,
  getSession,
  getSessionReport,
  listAnchors,
  listSessions,
  scoreAssignment,
} from '../../core/passport/calibration.js';
import { getGraph } from '../../core/passport/graph.js';
import {
  createProposal,
  getProposal,
  listProposals,
  mergeProposal,
  setProposalStatus,
} from '../../core/passport/catalog-proposals.js';

// ─────────────────────────────────────────────────────────────────────
// Схемы валидации
// ─────────────────────────────────────────────────────────────────────

const ATOM_ID_RE = /^CYB\.ATOM\.\d{4}$/;
const DIMENSIONS = ['U', 'X', 'D', 'P', 'E'] as const;

const catalogQuerySchema = z.object({
  query: z.string().trim().max(256).optional(),
  cluster: z
    .enum([
      'requirements_and_computational_thinking',
      'software_development',
      'data_and_databases',
      'server_interfaces_and_api',
      'testing_and_quality',
      'software_security',
      'infrastructure_and_operations',
    ])
    .optional(),
  status: z
    .enum(['candidate', 'draft', 'in_review', 'approved', 'deprecated'])
    .optional(),
  direction: z.coerce.number().int().min(1).max(17).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const atomIdParams = z.object({
  atomId: z.string().regex(ATOM_ID_RE, 'Invalid atom_id format (CYB.ATOM.NNNN)'),
});

const historyQuerySchema = z.object({
  atom_id: z.string().regex(ATOM_ID_RE).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Шаг 4 ───

const reuseEvidenceBodySchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE).optional(),
});

const evidenceIdParams = z.object({ evidenceId: uuidSchema });

const disputeEvidenceBodySchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

const resolveDisputeBodySchema = z.object({
  resolution: z.enum(['accepted', 'rejected', 'invalidated']),
  note: z.string().trim().min(1).max(2000),
});

const evidenceBodySchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE),
  dimension: z.enum(DIMENSIONS),
  evidenceType: z.enum([
    'declaration', 'training', 'portfolio', 'practical_task', 'exam',
    'specialist_conclusion', 'independent_review', 'real_activity', 'regular_practice',
  ]),
  description: z.string().trim().min(1).max(2000),
  artifactUrl: z.string().url().max(2000).nullable().optional(),
  context: z.record(z.unknown()).optional(),
});

const assessmentBodySchema = z.object({
  participantId: uuidSchema,
  atomId: z.string().regex(ATOM_ID_RE),
  dimension: z.enum(DIMENSIONS),
  level: z.number().int().min(0).max(9),
  method: z.string().trim().min(1).max(64),
  context: z.record(z.unknown()).optional(),
  evidenceIds: z.array(uuidSchema).max(50).optional(),
});

const resolveAppealBodySchema = z.object({
  resolution: z.enum(['upheld', 'rejected', 'remanded']),
  note: z.string().trim().min(1).max(2000),
  replacementAssessmentId: uuidSchema.optional(),
  assignedTo: uuidSchema.optional(),
});

const appealIdParams = z.object({ appealId: uuidSchema });

const appealBodySchema = z.object({
  assessmentId: uuidSchema,
  reason: z.string().trim().min(1).max(2000),
});

const pathBodySchema = z.object({
  goal: z.string().trim().min(1).max(500),
  targetProfileSlug: z.string().trim().min(1).max(64).optional(),
});

const teachingAssignSchema = z.object({
  menteeId: uuidSchema,
  atomId: z.string().regex(ATOM_ID_RE),
  dimensions: z
    .array(z.enum(['U', 'X', 'D', 'P', 'E']))
    .min(1)
    .max(5)
    .optional(),
  reason: z.string().trim().max(500).optional(),
});

const mentorQuestionBodySchema = z.object({
  question: z.string().trim().min(1).max(5000),
  atomId: z.string().regex(ATOM_ID_RE).optional(),
  mentorId: uuidSchema.optional(),
  taskId: uuidSchema.optional(),
});

const mentorQuestionListQuerySchema = z.object({
  status: z.enum(['open', 'answered', 'escalated', 'closed']).optional(),
});

const mentorQuestionAnswerBodySchema = z.object({
  answer: z.string().trim().min(1).max(10000),
});

const mentorQuestionIdParams = z.object({ questionId: uuidSchema });

const relationIdParams = z.object({ relationId: uuidSchema });

const teachingRevokeSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const teachingMentorsQuerySchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const requiredAtomSchema = z.object({
  atom_id: z.string().regex(ATOM_ID_RE),
  min: z.record(
    z.enum(['U', 'X', 'D', 'P', 'E']),
    z.number().int().min(0).max(9),
  ),
  role: z.enum(['executor', 'designer', 'consultant', 'assessor']),
});

const taskProfileBodySchema = z.object({
  requiredAtoms: z.array(requiredAtomSchema).min(1).max(200),
  permitIds: z.array(z.string()).max(50).optional(),
  acceptanceCriteria: z.record(z.unknown()).nullable().optional(),
  evidenceForm: z.record(z.unknown()).nullable().optional(),
  securityConstraints: z.record(z.unknown()).nullable().optional(),
});

const taskProfilePatchSchema = taskProfileBodySchema.partial().extend({
  status: z.enum(['draft', 'active', 'deprecated']).optional(),
});

const taskIdParams = z.object({ taskId: uuidSchema });

const teamBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  expectedResult: z.string().trim().min(1).max(2000),
  participants: z.array(uuidSchema).min(2).max(50),
  criteria: z.record(z.record(z.unknown())).optional(),
});

const teamPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  expectedResult: z.string().trim().min(1).max(2000).optional(),
  participants: z.array(uuidSchema).min(2).max(50).optional(),
  criteria: z.record(z.record(z.unknown())).optional(),
});

const teamStatusBodySchema = z.object({
  status: z.literal('deprecated'),
  reason: z.string().trim().max(2000).optional(),
});

const batchParticipantsQuerySchema = z.object({
  ids: z.string().min(1).max(4000),  // comma-separated UUIDs
});

const teamAssessBodySchema = z.object({
  level: z.number().int().min(0).max(9),
  criteriaScores: z.record(z.number().int().min(0).max(9)),
  context: z.record(z.unknown()).optional(),
});

const teamIdParams = z.object({ teamId: uuidSchema });

const createAnchorSchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE),
  dimension: z.enum(['U', 'X', 'D', 'P', 'E']),
  level: z.number().int().min(0).max(9),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(3000).nullable().optional(),
  content: z.record(z.unknown()).optional(),
});

const listAnchorsQuerySchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE).optional(),
  dimension: z.enum(['U', 'X', 'D', 'P', 'E']).optional(),
});

const createSessionSchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE),
  dimension: z.enum(['U', 'X', 'D', 'P', 'E']),
  deadline: z.string().datetime().nullable().optional(),
});

const listSessionsQuerySchema = z.object({
  atomId: z.string().regex(ATOM_ID_RE).optional(),
});

const sessionIdParams = z.object({ sessionId: uuidSchema });
const assignmentIdParams = z.object({ assignmentId: uuidSchema });

const assignAnchorSchema = z.object({
  anchorExampleId: uuidSchema,
  assessorId: uuidSchema,
});

const scoreAssignmentSchema = z.object({
  level: z.number().int().min(0).max(9),
  note: z.string().trim().max(3000).optional(),
});

const PERMIT_ID_RE = /^PERMIT\.[A-Z][A-Z0-9_]*\.[0-9]{4}$/;

const createPermitSchema = z.object({
  permitId: z.string().regex(PERMIT_ID_RE),
  name: z.string().trim().min(1).max(200),
  issuedBy: z.string().trim().min(1).max(200),
  scope: z.string().trim().max(200).nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  verificationMethod: z.string().trim().min(1).max(500),
});

const listPermitsQuerySchema = z.object({
  status: z.enum(['active', 'revoked', 'expired']).optional(),
});

const issuePermitSchema = z.object({
  permitId: z.string().regex(PERMIT_ID_RE),
  validUntil: z.string().datetime().nullable().optional(),
  verificationData: z.record(z.unknown()).optional(),
});

const revokeParticipantPermitSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

const participantPermitIdParams = z.object({ participantPermitId: uuidSchema });

const matchingQuerySchema = z.object({
  participantId: uuidSchema.optional(),
});

const candidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const cardQuerySchema = z.object({
  participantId: uuidSchema.optional(),
});

const visibilityPatchSchema = z.object({
  scope: z.enum(['public', 'mentor', 'assessor', 'task']),
  visibility: z.enum(['private', 'summary', 'levels', 'full']),
  consent: z.boolean(),
});

const peopleQuerySchema = z.object({
  scope: z.enum(['public', 'mentor', 'assessor', 'task', 'team']).optional(),
  teamId: uuidSchema.optional(),
  taskId: uuidSchema.optional(),
});

const grantBodySchema = z.object({
  viewerId: uuidSchema,
  scope: z.enum(['mentor', 'assessor', 'task']),
  taskId: uuidSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  reason: z.string().trim().max(500).optional(),
});

const grantIdParams = z.object({ grantId: uuidSchema });

const graphQuerySchema = z.object({
  cluster: z
    .enum([
      'requirements_and_computational_thinking',
      'software_development',
      'data_and_databases',
      'server_interfaces_and_api',
      'testing_and_quality',
      'software_security',
      'infrastructure_and_operations',
    ])
    .optional(),
  direction: z.coerce.number().int().min(1).max(17).optional(),
  filter: z.enum(['all', 'assessed', 'not_assessed']).optional(),
});

const catalogProposalBodySchema = z.object({
  proposalType: z.enum(['new_atom', 'update_atom', 'deprecate_atom']),
  atomId: z.string().regex(ATOM_ID_RE).nullable().optional(),
  payload: z.record(z.unknown()),
});

const listCatalogProposalsQuerySchema = z.object({
  status: z
    .enum(['draft', 'submitted', 'in_review', 'approved', 'rejected', 'merged'])
    .optional(),
  atomId: z.string().regex(ATOM_ID_RE).optional(),
  createdBy: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const catalogProposalStatusSchema = z.object({
  status: z.enum(['submitted', 'in_review', 'approved', 'rejected']),
  reason: z.string().trim().max(2000).optional(),
  reviewNote: z.string().trim().max(2000).optional(),
});

const catalogProposalIdParams = z.object({ proposalId: uuidSchema });

// ─────────────────────────────────────────────────────────────────────
// Регистрация
// ─────────────────────────────────────────────────────────────────────

export async function registerPassportRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════
  // Шаг 3 — read-only каталог
  // ═══════════════════════════════════════════════════════════════

  // GET /passport/catalog — каталожный список атомов.
  app.get(
    '/passport/catalog',
    { preHandler: [authMiddleware, validateQuery(catalogQuerySchema)] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof catalogQuerySchema>;
      const result = await getCatalog(q);
      reply.send({
        data: result.items,
        meta: {
          total: result.total,
          limit: q.limit ?? 50,
          offset: q.offset ?? 0,
        },
        audit_id: request.auditId,
      });
    },
  );

  // GET /passport/directions — 17 направлений Хартии (справочник).
  app.get(
    '/passport/directions',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const items = await getDirections();
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // GET /passport/atoms/:atomId — каталожная карточка атома.
  // Персональные измерения/доказательства — шаг 4 (/passport/atoms/:id/card).
  app.get(
    '/passport/atoms/:atomId',
    { preHandler: [authMiddleware, validateParams(atomIdParams)] },
    async (request, reply) => {
      const { atomId } = request.params as z.infer<typeof atomIdParams>;
      const atom = await getAtomById(atomId);
      if (!atom) {
        return reply.code(404).send({
          code: 'ATOM_NOT_FOUND',
          message: `Atom ${atomId} not found`,
          audit_id: request.auditId,
        });
      }
      const relations = await getRelationsForAtom(atomId);
      const directions = await getAtomDirections(atomId);
      reply.send({
        atom,
        relations,
        directions,
        audit_id: request.auditId,
      });
    },
  );

  // GET /passport/history — своя история (append-only лента событий).
  app.get(
    '/passport/history',
    { preHandler: [authMiddleware, validateQuery(historyQuerySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof historyQuerySchema>;
      const result = await getHistory({
        participantId: auth.participantId,
        ...(q.atom_id ? { atomId: q.atom_id } : {}),
        ...(q.since ? { since: q.since } : {}),
        limit: q.limit ?? 100,
        offset: q.offset ?? 0,
      });
      reply.send({
        data: result.items,
        meta: {
          total: result.total,
          limit: q.limit ?? 100,
          offset: q.offset ?? 0,
        },
        audit_id: request.auditId,
      });
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // Шаг 4 — запись и проекция
  // ═══════════════════════════════════════════════════════════════

  // GET /passport/me — обзор (масштаб 1).
  app.get(
    '/passport/me',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const overview = await getOverview(auth.participantId);
      reply.send({ ...overview, audit_id: request.auditId });
    },
  );

  // GET /passport/atoms/:atomId/card — персональная карточка (масштаб 3).
  // В шаге 4 — только для себя. Чужой паспорт → 403 (visibility — шаг 5).
  app.get(
    '/passport/atoms/:atomId/card',
    {
      preHandler: [
        authMiddleware,
        validateParams(atomIdParams),
        validateQuery(cardQuerySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { atomId } = request.params as z.infer<typeof atomIdParams>;
      const q = request.query as z.infer<typeof cardQuerySchema>;
      const participantId = q.participantId ?? auth.participantId;

      if (participantId !== auth.participantId) {
        return reply.code(403).send({
          code: 'VISIBILITY_NOT_IMPLEMENTED',
          message:
            'Phase 1 step 4: foreign passport cards are not available; ' +
            'visibility scopes will be added in step 5',
          audit_id: request.auditId,
        });
      }

      const card = await getAtomCard(participantId, atomId);
      if (!card) {
        return reply.code(404).send({
          code: 'ATOM_NOT_FOUND',
          message: `Atom ${atomId} not found`,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...card, audit_id: request.auditId });
    },
  );

  // POST /passport/evidence — заявить доказательство (для себя).
  app.post(
    '/passport/evidence',
    { preHandler: [authMiddleware, validateBody(evidenceBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof evidenceBodySchema>;
      const { evidenceId } = await submitEvidence(
        {
          participantId: auth.participantId,
          atomId: body.atomId,
          dimension: body.dimension,
          evidenceType: body.evidenceType,
          description: body.description,
          ...(body.artifactUrl !== undefined ? { artifactUrl: body.artifactUrl } : {}),
          ...(body.context ? { context: body.context } : {}),
        },
        auth.participantId,
      );
      reply.code(201).send({ evidenceId, audit_id: request.auditId });
    },
  );

  // POST /passport/assessments — оценка уполномоченным проверяющим.
  app.post(
    '/passport/assessments',
    { preHandler: [authMiddleware, validateBody(assessmentBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof assessmentBodySchema>;
      const { assessmentId } = await submitAssessment(
        {
          participantId: body.participantId,
          atomId: body.atomId,
          dimension: body.dimension,
          level: body.level,
          method: body.method,
          ...(body.context ? { context: body.context } : {}),
          ...(body.evidenceIds ? { evidenceIds: body.evidenceIds } : {}),
        },
        auth.participantId,
      );
      reply.code(201).send({ assessmentId, audit_id: request.auditId });
    },
  );

  // POST /passport/appeals — апелляция (subject).
  app.post(
    '/passport/appeals',
    { preHandler: [authMiddleware, validateBody(appealBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof appealBodySchema>;
      await submitAppeal(body, auth.participantId);
      reply.send({ ok: true, audit_id: request.auditId });
    },
  );

  // POST /passport/appeals/:appealId/resolve — независимое разрешение апелляции.
  // 3 исхода: upheld / rejected / remanded. Повторный resolve → 409.
  app.post(
    '/passport/appeals/:appealId/resolve',
    {
      preHandler: [
        authMiddleware,
        validateParams(appealIdParams),
        validateBody(resolveAppealBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { appealId } = request.params as z.infer<typeof appealIdParams>;
      const body = request.body as z.infer<typeof resolveAppealBodySchema>;
      const result = await resolveAppeal(
        {
          appealId,
          resolution: body.resolution,
          note: body.note,
          ...(body.replacementAssessmentId
            ? { replacementAssessmentId: body.replacementAssessmentId }
            : {}),
          ...(body.assignedTo ? { assignedTo: body.assignedTo } : {}),
        },
        auth.participantId,
      );
      reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // POST /passport/paths — фантомный маршрут развития (для себя).
  app.post(
    '/passport/paths',
    { preHandler: [authMiddleware, validateBody(pathBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof pathBodySchema>;
      const { pathId } = await createPath(auth.participantId, {
        goal: body.goal,
        ...(body.targetProfileSlug ? { targetProfileSlug: body.targetProfileSlug } : {}),
      });
      reply.code(201).send({ pathId, audit_id: request.auditId });
    },
  );

  // POST /passport/evidence/:evidenceId/dispute — subject или связанный assessor.
  app.post(
    '/passport/evidence/:evidenceId/dispute',
    {
      preHandler: [
        authMiddleware,
        validateParams(evidenceIdParams),
        validateBody(disputeEvidenceBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { evidenceId } = request.params as z.infer<typeof evidenceIdParams>;
      const body = request.body as z.infer<typeof disputeEvidenceBodySchema>;
      const result = await disputeEvidence(evidenceId, auth.participantId, body.reason);
      reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // POST /passport/evidence/:evidenceId/resolve — FIRST_ARCHITECT|VERIFIER.
  app.post(
    '/passport/evidence/:evidenceId/resolve',
    {
      preHandler: [
        authMiddleware,
        validateParams(evidenceIdParams),
        validateBody(resolveDisputeBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { evidenceId } = request.params as z.infer<typeof evidenceIdParams>;
      const body = request.body as z.infer<typeof resolveDisputeBodySchema>;
      const result = await resolveDispute(
        evidenceId, auth.participantId, body.resolution, body.note,
      );
      reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // POST /passport/evidence/:evidenceId/reuse — кандидат на повторное
  // использование (§7.3, A18). Assessment не создаётся.
  app.post(
    '/passport/evidence/:evidenceId/reuse',
    {
      preHandler: [
        authMiddleware,
        validateParams(evidenceIdParams),
        validateBody(reuseEvidenceBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { evidenceId } = request.params as z.infer<typeof evidenceIdParams>;
      const body = request.body as z.infer<typeof reuseEvidenceBodySchema>;
      const result = await reuseEvidence(evidenceId, auth.participantId, {
        ...(body.atomId ? { atomId: body.atomId } : {}),
      });
      reply.code(201).send({ ...result, audit_id: request.auditId });
    },
  );

  // ─── Шаг 5: приватность и чужой паспорт ─────────────────────────────

  // GET /passport/visibility — текущие настройки (свои).
  app.get(
    '/passport/visibility',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const items = await getVisibilityAll(auth.participantId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // PATCH /passport/visibility — только для себя.
  app.patch(
    '/passport/visibility',
    { preHandler: [authMiddleware, validateBody(visibilityPatchSchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof visibilityPatchSchema>;
      await setVisibility(auth.participantId, auth.participantId, {
        scope: body.scope,
        visibility: body.visibility,
        consent: body.consent,
      });
      const updated = await getVisibility(auth.participantId, body.scope);
      reply.send({ ...updated, audit_id: request.auditId });
    },
  );

  // GET /passport/people/:id?scope=...&taskId=... — чужой обзор.
  // Записывает access_log ВСЕГДА (grant и deny), см. A9.
  app.get(
    '/passport/people/:id',
    {
      preHandler: [
        authMiddleware,
        validateParams(uuidIdParams),
        validateQuery(peopleQuerySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { id: subjectId } = request.params as z.infer<typeof uuidIdParams>;
      const q = request.query as z.infer<typeof peopleQuerySchema>;
      const scope = q.scope ?? 'public';

      // 1. Участник существует?
      const exists = await queryOne<{ id: string }>(
        `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
        [subjectId],
      );
      if (!exists) {
        return reply.code(404).send({
          code: 'PARTICIPANT_NOT_FOUND',
          message: `Participant ${subjectId} not found`,
          audit_id: request.auditId,
        });
      }

      // 2. Себя — без ограничений и без access_log (сам себя не «читаешь»).
      if (subjectId === auth.participantId) {
        const overview = await getOverview(subjectId);
        return reply.send({ ...overview, audit_id: request.auditId });
      }

      // 3. Чужой — проверяем видимость (включая явные гранты) и пишем
      //    access_log в обоих случаях.
      const decision = await resolveScopeGrant(
        subjectId, auth.participantId, scope, {
          ...(q.taskId ? { taskId: q.taskId } : {}),
          ...(q.teamId ? { teamId: q.teamId } : {}),
        },
      );

      if (!decision.granted) {
        await recordAccess(subjectId, auth.participantId, scope, decision.reason);
        // A9: даже boolean не отдаём — только факт отказа.
        return reply.code(403).send({
          code: 'PASSPORT_NOT_VISIBLE',
          message: 'Passport is not visible in this scope',
          scope,
          audit_id: request.auditId,
        });
      }

      await recordAccess(subjectId, auth.participantId, scope, decision.reason);
      const overview = await getOverview(subjectId);
      const masked = maskOverview(overview, decision.visibility);
      if (!masked) {
        // Страховка: в Фазе 1 'summary' не проходит через resolveScopeGrant,
        // но если попадёт — вернём 403, а не утечку.
        return reply.code(403).send({
          code: 'PASSPORT_NOT_VISIBLE',
          message: 'Passport visibility level does not allow overview',
          scope,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...masked, audit_id: request.auditId });
    },
  );

  // GET /passport/access-log — свой журнал доступа (кто смотрел меня).
  app.get(
    '/passport/access-log',
    {
      preHandler: [
        authMiddleware,
        validateQuery(
          z.object({
            limit: z.coerce.number().int().min(1).max(500).optional(),
            offset: z.coerce.number().int().min(0).optional(),
          }),
        ),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as { limit?: number; offset?: number };
      const result = await listAccessLog(
        auth.participantId,
        q.limit ?? 100,
        q.offset ?? 0,
      );
      reply.send({
        data: result.items,
        meta: {
          total: result.total,
          limit: q.limit ?? 100,
          offset: q.offset ?? 0,
        },
        audit_id: request.auditId,
      });
    },
  );

  // ─── Шаг 5b: явные гранты (миграция 059) ────────────────────────────

  // GET /passport/grants — свои гранты.
  app.get(
    '/passport/grants',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const grants = await listGrants(auth.participantId);
      reply.send({ data: grants, audit_id: request.auditId });
    },
  );

  // POST /passport/grants — создать грант (только subject).
  app.post(
    '/passport/grants',
    { preHandler: [authMiddleware, validateBody(grantBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof grantBodySchema>;
      const grant = await createGrant(auth.participantId, auth.participantId, {
        viewerId: body.viewerId,
        scope: body.scope,
        ...(body.taskId ? { taskId: body.taskId } : {}),
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
      });
      reply.code(201).send({ ...grant, audit_id: request.auditId });
    },
  );

  // DELETE /passport/grants/:grantId — отозвать (только subject).
  app.delete(
    '/passport/grants/:grantId',
    { preHandler: [authMiddleware, validateParams(grantIdParams)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { grantId } = request.params as z.infer<typeof grantIdParams>;
      await revokeGrant(grantId, auth.participantId);
      reply.send({ ok: true, audit_id: request.auditId });
    },
  );

  // ─── TaskProfile (Фаза 3a) ──────────────────────────────────────────

  // GET /passport/tasks/:taskId/profile
  app.get(
    '/passport/tasks/:taskId/profile',
    { preHandler: [authMiddleware, validateParams(taskIdParams)] },
    async (request, reply) => {
      const { taskId } = request.params as z.infer<typeof taskIdParams>;
      const profile = await getTaskProfile(taskId);
      if (!profile) {
        return reply.code(404).send({
          code: 'TASK_PROFILE_NOT_FOUND',
          message: `Task ${taskId} has no passport profile`,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...profile, audit_id: request.auditId });
    },
  );

  // POST /passport/tasks/:taskId/profile
  app.post(
    '/passport/tasks/:taskId/profile',
    {
      preHandler: [
        authMiddleware,
        validateParams(taskIdParams),
        validateBody(taskProfileBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { taskId } = request.params as z.infer<typeof taskIdParams>;
      const body = request.body as z.infer<typeof taskProfileBodySchema>;
      const profile = await createTaskProfile(taskId, auth.participantId, {
        requiredAtoms: body.requiredAtoms,
        ...(body.permitIds ? { permitIds: body.permitIds } : {}),
        ...(body.acceptanceCriteria !== undefined ? { acceptanceCriteria: body.acceptanceCriteria } : {}),
        ...(body.evidenceForm !== undefined ? { evidenceForm: body.evidenceForm } : {}),
        ...(body.securityConstraints !== undefined ? { securityConstraints: body.securityConstraints } : {}),
      });
      reply.code(201).send({ ...profile, audit_id: request.auditId });
    },
  );

  // PATCH /passport/tasks/:taskId/profile
  app.patch(
    '/passport/tasks/:taskId/profile',
    {
      preHandler: [
        authMiddleware,
        validateParams(taskIdParams),
        validateBody(taskProfilePatchSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { taskId } = request.params as z.infer<typeof taskIdParams>;
      const body = request.body as z.infer<typeof taskProfilePatchSchema>;
      const profile = await updateTaskProfile(taskId, auth.participantId, {
        ...(body.requiredAtoms !== undefined ? { requiredAtoms: body.requiredAtoms } : {}),
        ...(body.permitIds !== undefined ? { permitIds: body.permitIds } : {}),
        ...(body.acceptanceCriteria !== undefined ? { acceptanceCriteria: body.acceptanceCriteria } : {}),
        ...(body.evidenceForm !== undefined ? { evidenceForm: body.evidenceForm } : {}),
        ...(body.securityConstraints !== undefined ? { securityConstraints: body.securityConstraints } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      });
      reply.send({ ...profile, audit_id: request.auditId });
    },
  );

  // GET /passport/tasks/:taskId/matching?participantId=...
  // Если participantId не указан — субъект = auth.participantId.
  app.get(
    '/passport/tasks/:taskId/matching',
    {
      preHandler: [
        authMiddleware,
        validateParams(taskIdParams),
        validateQuery(matchingQuerySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { taskId } = request.params as z.infer<typeof taskIdParams>;
      const q = request.query as z.infer<typeof matchingQuerySchema>;
      const participantId = q.participantId ?? auth.participantId;
      const result = await matchTask(taskId, participantId, auth.participantId);
      reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // GET /passport/tasks/:taskId/candidates?limit=N — top-N участников.
  // Уровни не раскрываются (только matches / gaps / status).
  app.get(
    '/passport/tasks/:taskId/candidates',
    {
      preHandler: [
        authMiddleware,
        validateParams(taskIdParams),
        validateQuery(candidatesQuerySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { taskId } = request.params as z.infer<typeof taskIdParams>;
      const q = request.query as z.infer<typeof candidatesQuerySchema>;
      const items = await getCandidates(taskId, auth.participantId, q.limit ?? 20);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // ─── TeachingRelation (Фаза 3a) ──────────────────────────────────────

  // GET /passport/teaching/students — кого я учу (per-atom).
  app.get(
    '/passport/teaching/students',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const items = await getStudentsForMentor(auth.participantId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // GET /passport/teaching/mentors-for-me — кто учит меня (primary + per-atom).
  app.get(
    '/passport/teaching/mentors-for-me',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const items = await getMentorsForMentee(auth.participantId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // GET /passport/teaching/mentors?atomId=... — кандидаты с readiness.
  app.get(
    '/passport/teaching/mentors',
    {
      preHandler: [authMiddleware, validateQuery(teachingMentorsQuerySchema)],
    },
    async (request, reply) => {
      const q = request.query as z.infer<typeof teachingMentorsQuerySchema>;
      const items = await getMentorsForAtom(q.atomId, q.limit ?? 100);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // POST /passport/teaching/assign — mentor назначает mentee.
  app.post(
    '/passport/teaching/assign',
    { preHandler: [authMiddleware, validateBody(teachingAssignSchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof teachingAssignSchema>;
      const relation = await assignRelation(auth.participantId, {
        menteeId: body.menteeId,
        atomId: body.atomId,
        ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
      });
      reply.code(201).send({ ...relation, audit_id: request.auditId });
    },
  );

  // POST /passport/teaching/:relationId/revoke — mentor or FIRST_ARCHITECT.
  app.post(
    '/passport/teaching/:relationId/revoke',
    {
      preHandler: [
        authMiddleware,
        validateParams(relationIdParams),
        validateBody(teachingRevokeSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { relationId } = request.params as z.infer<typeof relationIdParams>;
      const body = request.body as z.infer<typeof teachingRevokeSchema>;
      const relation = await revokeRelation(
        auth.participantId,
        relationId,
        body.reason,
      );
      reply.send({ ...relation, audit_id: request.auditId });
    },
  );

  // GET /passport/teaching/my-readiness?atomId=... — моя готовность.
  const readinessQuerySchema = z.object({ atomId: z.string().regex(ATOM_ID_RE) });
  app.get(
    '/passport/teaching/my-readiness',
    { preHandler: [authMiddleware, validateQuery(readinessQuerySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof readinessQuerySchema>;
      const readiness = await computeReadiness(auth.participantId, q.atomId);
      if (!readiness) {
        return reply.code(404).send({
          code: 'ATOM_NOT_FOUND',
          message: `Atom ${q.atomId} not found`,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...readiness, audit_id: request.auditId });
    },
  );

  // ─── Permit (Фаза 3b, §10.3) ────────────────────────────────────────

  // POST /passport/permits — создать permit в справочнике (FA | COUNCIL).
  app.post(
    '/passport/permits',
    { preHandler: [authMiddleware, validateBody(createPermitSchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof createPermitSchema>;
      const permit = await createPermit(auth.participantId, {
        permitId: body.permitId,
        name: body.name,
        issuedBy: body.issuedBy,
        ...(body.scope !== undefined ? { scope: body.scope } : {}),
        ...(body.validUntil !== undefined ? { validUntil: body.validUntil } : {}),
        verificationMethod: body.verificationMethod,
      });
      reply.code(201).send({ ...permit, audit_id: request.auditId });
    },
  );

  // GET /passport/permits — справочник (по умолчанию active).
  app.get(
    '/passport/permits',
    {
      preHandler: [authMiddleware, validateQuery(listPermitsQuerySchema)],
    },
    async (request, reply) => {
      const q = request.query as z.infer<typeof listPermitsQuerySchema>;
      const items = await listPermits(q.status ?? 'active');
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // POST /passport/participants/:id/permits — выдать (FA | OTC | COUNCIL).
  app.post(
    '/passport/participants/:id/permits',
    {
      preHandler: [
        authMiddleware,
        validateParams(uuidIdParams),
        validateBody(issuePermitSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { id } = request.params as z.infer<typeof uuidIdParams>;
      const body = request.body as z.infer<typeof issuePermitSchema>;
      const pp = await issuePermitToParticipant(auth.participantId, {
        participantId: id,
        permitId: body.permitId,
        ...(body.validUntil !== undefined ? { validUntil: body.validUntil } : {}),
        ...(body.verificationData ? { verificationData: body.verificationData } : {}),
      });
      reply.code(201).send({ ...pp, audit_id: request.auditId });
    },
  );

  // GET /passport/participants/:id/permits — свои: все; чужие: active.
  app.get(
    '/passport/participants/:id/permits',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { id } = request.params as z.infer<typeof uuidIdParams>;
      const items = await getParticipantPermits(id, auth.participantId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // POST /passport/participant-permits/:participantPermitId/revoke
  app.post(
    '/passport/participant-permits/:participantPermitId/revoke',
    {
      preHandler: [
        authMiddleware,
        validateParams(participantPermitIdParams),
        validateBody(revokeParticipantPermitSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { participantPermitId } = request.params as z.infer<
        typeof participantPermitIdParams
      >;
      const body = request.body as z.infer<typeof revokeParticipantPermitSchema>;
      const pp = await revokeParticipantPermit(
        auth.participantId,
        participantPermitId,
        body.reason,
      );
      reply.send({ ...pp, audit_id: request.auditId });
    },
  );

  // ─── mentor_questions (Фаза 3b, A28, A40, A41) ─────────────────────

  // POST /passport/teaching/questions — задать вопрос.
  app.post(
    '/passport/teaching/questions',
    {
      preHandler: [authMiddleware, validateBody(mentorQuestionBodySchema)],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof mentorQuestionBodySchema>;
      const q = await createMentorQuestion(auth.participantId, {
        question: body.question,
        ...(body.atomId ? { atomId: body.atomId } : {}),
        ...(body.mentorId ? { mentorId: body.mentorId } : {}),
        ...(body.taskId ? { taskId: body.taskId } : {}),
      });
      reply.code(201).send({ ...q, audit_id: request.auditId });
    },
  );

  // GET /passport/teaching/questions — мои вопросы.
  app.get(
    '/passport/teaching/questions',
    {
      preHandler: [authMiddleware, validateQuery(mentorQuestionListQuerySchema)],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof mentorQuestionListQuerySchema>;
      const items = await getMyQuestions(auth.participantId, q.status);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // GET /passport/teaching/mentor-questions — вопросы ко мне (mentor).
  app.get(
    '/passport/teaching/mentor-questions',
    {
      preHandler: [authMiddleware, validateQuery(mentorQuestionListQuerySchema)],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof mentorQuestionListQuerySchema>;
      const items = await getMentorQuestions(auth.participantId, q.status);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // POST /passport/teaching/mentor-questions/:questionId/answer
  app.post(
    '/passport/teaching/mentor-questions/:questionId/answer',
    {
      preHandler: [
        authMiddleware,
        validateParams(mentorQuestionIdParams),
        validateBody(mentorQuestionAnswerBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { questionId } = request.params as z.infer<
        typeof mentorQuestionIdParams
      >;
      const body = request.body as z.infer<typeof mentorQuestionAnswerBodySchema>;
      const q = await answerMentorQuestion(
        auth.participantId,
        questionId,
        body.answer,
      );
      reply.send({ ...q, audit_id: request.auditId });
    },
  );

  // ─── TeamCapability (Фаза 3c, §11.4) ────────────────────────────────

  // GET /passport/teams — список команд, где я участник или assessor (N7).
  app.get(
    '/passport/teams',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const items = await listTeamsForViewer(auth.participantId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // POST /passport/teams — создать (FA | COUNCIL | OTC).
  app.post(
    '/passport/teams',
    { preHandler: [authMiddleware, validateBody(teamBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof teamBodySchema>;
      const team = await createTeam(auth.participantId, {
        name: body.name,
        expectedResult: body.expectedResult,
        participants: body.participants,
        ...(body.criteria ? { criteria: body.criteria } : {}),
      });
      reply.code(201).send({ ...team, audit_id: request.auditId });
    },
  );

  // GET /passport/teams/:teamId — read. Доступ: участник или assessor.
  app.get(
    '/passport/teams/:teamId',
    { preHandler: [authMiddleware, validateParams(teamIdParams)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { teamId } = request.params as z.infer<typeof teamIdParams>;
      const team = await getTeam(teamId);
      if (!team) {
        return reply.code(404).send({
          code: 'TEAM_NOT_FOUND',
          message: `Team ${teamId} not found`,
          audit_id: request.auditId,
        });
      }
      const isMember = team.participants.includes(auth.participantId);
      const isAssessor = team.assessorId === auth.participantId;
      // FA тоже видит (гарант процедуры).
      const faRows = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM participant_roles pr
           JOIN roles r ON r.id = pr.role_id
          WHERE pr.participant_id = $1
            AND pr.status = 'active'
            AND (pr.valid_to IS NULL OR pr.valid_to > now())
            AND r.name = ANY($2::text[])`,
        [auth.participantId, ['FIRST_ARCHITECT']],
      );
      const isAdmin = (faRows?.n ?? 0) > 0;
      if (!isMember && !isAssessor && !isAdmin) {
        return reply.code(403).send({
          code: 'TEAM_ACCESS_DENIED',
          message: 'Team is not visible',
          audit_id: request.auditId,
        });
      }
      reply.send({ ...team, audit_id: request.auditId });
    },
  );

  // POST /passport/teams/:teamId/assess — оценка (FA | VERIFIER, не участник).
  app.post(
    '/passport/teams/:teamId/assess',
    {
      preHandler: [
        authMiddleware,
        validateParams(teamIdParams),
        validateBody(teamAssessBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { teamId } = request.params as z.infer<typeof teamIdParams>;
      const body = request.body as z.infer<typeof teamAssessBodySchema>;
      const assessment = await assessTeam(auth.participantId, {
        teamId,
        level: body.level,
        criteriaScores: body.criteriaScores,
        ...(body.context ? { context: body.context } : {}),
      });
      reply.code(201).send({ ...assessment, audit_id: request.auditId });
    },
  );

  // PATCH /passport/teams/:teamId — update (техдолг 3c, A64).
  app.patch(
    '/passport/teams/:teamId',
    {
      preHandler: [
        authMiddleware,
        validateParams(teamIdParams),
        validateBody(teamPatchSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { teamId } = request.params as z.infer<typeof teamIdParams>;
      const body = request.body as z.infer<typeof teamPatchSchema>;
      const team = await updateTeam(teamId, auth.participantId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.expectedResult !== undefined ? { expectedResult: body.expectedResult } : {}),
        ...(body.participants !== undefined ? { participants: body.participants } : {}),
        ...(body.criteria !== undefined ? { criteria: body.criteria } : {}),
      });
      reply.send({ ...team, audit_id: request.auditId });
    },
  );

  // PATCH /passport/teams/:teamId/status — deprecated (A75).
  app.patch(
    '/passport/teams/:teamId/status',
    {
      preHandler: [
        authMiddleware,
        validateParams(teamIdParams),
        validateBody(teamStatusBodySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { teamId } = request.params as z.infer<typeof teamIdParams>;
      const body = request.body as z.infer<typeof teamStatusBodySchema>;
      const team = await deprecateTeam(teamId, auth.participantId, body.reason);
      reply.send({ ...team, audit_id: request.auditId });
    },
  );

  // GET /passport/participants?ids=uuid1,uuid2 — batch (техдолг 3c, A65).
  // Возвращает {id, externalId, name, status} для каждого известного UUID.
  // Отсутствующие/удалённые — пропускаются.
  app.get(
    '/passport/participants',
    { preHandler: [authMiddleware, validateQuery(batchParticipantsQuerySchema)] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof batchParticipantsQuerySchema>;
      const parts = q.ids.split(',').map((s) => s.trim()).filter(Boolean);
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = Array.from(new Set(parts.filter((p) => UUID_RE.test(p)))).slice(0, 100);
      if (ids.length === 0) {
        return reply.send({ data: [], audit_id: request.auditId });
      }
      const list = await query<{
        id: string;
        external_id: string;
        name: string;
        status: string;
      }>(
        `SELECT id, external_id, name, status
           FROM participants
          WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
          ORDER BY entered_at ASC`,
        [ids],
      );
      reply.send({
        data: list.map((r) => ({
          id: r.id,
          externalId: r.external_id,
          name: r.name,
          status: r.status,
        })),
        audit_id: request.auditId,
      });
    },
  );
  
  // GET /passport/teams/:teamId/history — история оценок.
  app.get(
    '/passport/teams/:teamId/history',
    { preHandler: [authMiddleware, validateParams(teamIdParams)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { teamId } = request.params as z.infer<typeof teamIdParams>;
      // Проверка доступа такая же, как в GET /teams/:id (упрощённо — member/assessor/FA).
      const team = await getTeam(teamId);
      if (!team) {
        return reply.code(404).send({
          code: 'TEAM_NOT_FOUND',
          message: `Team ${teamId} not found`,
          audit_id: request.auditId,
        });
      }
      const isMember = team.participants.includes(auth.participantId);
      const isAssessor = team.assessorId === auth.participantId;
      if (!isMember && !isAssessor) {
        return reply.code(403).send({
          code: 'TEAM_ACCESS_DENIED',
          message: 'Team history is not visible',
          audit_id: request.auditId,
        });
      }
      const items = await getTeamHistory(teamId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );
  // ─── Calibration (Фаза 3d, §6.5) ────────────────────────────────────

  // POST /passport/calibration/anchors — создать эталон (FA | COUNCIL).
  app.post(
    '/passport/calibration/anchors',
    { preHandler: [authMiddleware, validateBody(createAnchorSchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof createAnchorSchema>;
      const anchor = await createAnchor(auth.participantId, {
        atomId: body.atomId,
        dimension: body.dimension,
        level: body.level,
        title: body.title,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.content ? { content: body.content } : {}),
      });
      reply.code(201).send({ ...anchor, audit_id: request.auditId });
    },
  );

  // GET /passport/calibration/anchors — список эталонов.
  app.get(
    '/passport/calibration/anchors',
    { preHandler: [authMiddleware, validateQuery(listAnchorsQuerySchema)] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof listAnchorsQuerySchema>;
      const items = await listAnchors({
        ...(q.atomId ? { atomId: q.atomId } : {}),
        ...(q.dimension ? { dimension: q.dimension } : {}),
      });
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // POST /passport/calibration/sessions — создать сессию.
  app.post(
    '/passport/calibration/sessions',
    { preHandler: [authMiddleware, validateBody(createSessionSchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof createSessionSchema>;
      const session = await createSession(auth.participantId, {
        atomId: body.atomId,
        dimension: body.dimension,
        ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
      });
      reply.code(201).send({ ...session, audit_id: request.auditId });
    },
  );

  // GET /passport/calibration/sessions — список.
  app.get(
    '/passport/calibration/sessions',
    { preHandler: [authMiddleware, validateQuery(listSessionsQuerySchema)] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof listSessionsQuerySchema>;
      const items = await listSessions(q.atomId);
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // GET /passport/calibration/sessions/:sessionId — одна.
  app.get(
    '/passport/calibration/sessions/:sessionId',
    { preHandler: [authMiddleware, validateParams(sessionIdParams)] },
    async (request, reply) => {
      const { sessionId } = request.params as z.infer<typeof sessionIdParams>;
      const session = await getSession(sessionId);
      if (!session) {
        return reply.code(404).send({
          code: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...session, audit_id: request.auditId });
    },
  );

  // POST /passport/calibration/sessions/:sessionId/assign
  app.post(
    '/passport/calibration/sessions/:sessionId/assign',
    {
      preHandler: [
        authMiddleware,
        validateParams(sessionIdParams),
        validateBody(assignAnchorSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { sessionId } = request.params as z.infer<typeof sessionIdParams>;
      const body = request.body as z.infer<typeof assignAnchorSchema>;
      const a = await assignAnchor(auth.participantId, {
        sessionId,
        anchorExampleId: body.anchorExampleId,
        assessorId: body.assessorId,
      });
      reply.code(201).send({ ...a, audit_id: request.auditId });
    },
  );

  // POST /passport/calibration/assignments/:assignmentId/score
  app.post(
    '/passport/calibration/assignments/:assignmentId/score',
    {
      preHandler: [
        authMiddleware,
        validateParams(assignmentIdParams),
        validateBody(scoreAssignmentSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { assignmentId } = request.params as z.infer<typeof assignmentIdParams>;
      const body = request.body as z.infer<typeof scoreAssignmentSchema>;
      const a = await scoreAssignment(auth.participantId, {
        assignmentId,
        level: body.level,
        ...(body.note ? { note: body.note } : {}),
      });
      reply.send({ ...a, audit_id: request.auditId });
    },
  );

  // GET /passport/calibration/sessions/:sessionId/report
  app.get(
    '/passport/calibration/sessions/:sessionId/report',
    { preHandler: [authMiddleware, validateParams(sessionIdParams)] },
    async (request, reply) => {
      const { sessionId } = request.params as z.infer<typeof sessionIdParams>;
      const report = await getSessionReport(sessionId);
      if (!report) {
        return reply.code(404).send({
          code: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...report, audit_id: request.auditId });
    },
  );
  // ─── Graph (Фаза 3d, §8.4) ──────────────────────────────────────────

  // GET /passport/graph — 54 узла + рёбра + метаданные viewer'а.
  app.get(
    '/passport/graph',
    { preHandler: [authMiddleware, validateQuery(graphQuerySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof graphQuerySchema>;
      const graph = await getGraph(auth.participantId, {
        ...(q.cluster ? { cluster: q.cluster } : {}),
        ...(q.direction !== undefined ? { direction: q.direction } : {}),
        ...(q.filter ? { filter: q.filter } : {}),
      });
      reply.send({ ...graph, audit_id: request.auditId });
    },
  );
  // ─── Каталог v0.4 — workflow предложений (§16.1) ──────────────────

  // POST /passport/catalog/proposals — создать (любой авторизованный).
  app.post(
    '/passport/catalog/proposals',
    { preHandler: [authMiddleware, validateBody(catalogProposalBodySchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof catalogProposalBodySchema>;
      const proposal = await createProposal(auth.participantId, {
        proposalType: body.proposalType,
        atomId: body.atomId ?? null,
        payload: body.payload,
      });
      reply.code(201).send({ ...proposal, audit_id: request.auditId });
    },
  );

  // GET /passport/catalog/proposals — список (фильтры).
  app.get(
    '/passport/catalog/proposals',
    { preHandler: [authMiddleware, validateQuery(listCatalogProposalsQuerySchema)] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof listCatalogProposalsQuerySchema>;
      const items = await listProposals({
        ...(q.status ? { status: q.status } : {}),
        ...(q.atomId ? { atomId: q.atomId } : {}),
        ...(q.createdBy ? { createdBy: q.createdBy } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // GET /passport/catalog/proposals/:proposalId
  app.get(
    '/passport/catalog/proposals/:proposalId',
    { preHandler: [authMiddleware, validateParams(catalogProposalIdParams)] },
    async (request, reply) => {
      const { proposalId } = request.params as z.infer<typeof catalogProposalIdParams>;
      const p = await getProposal(proposalId);
      if (!p) {
        return reply.code(404).send({
          code: 'PROPOSAL_NOT_FOUND',
          message: `Proposal ${proposalId} not found`,
          audit_id: request.auditId,
        });
      }
      reply.send({ ...p, audit_id: request.auditId });
    },
  );

  // PATCH /passport/catalog/proposals/:proposalId — setProposalStatus.
  app.patch(
    '/passport/catalog/proposals/:proposalId',
    {
      preHandler: [
        authMiddleware,
        validateParams(catalogProposalIdParams),
        validateBody(catalogProposalStatusSchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { proposalId } = request.params as z.infer<typeof catalogProposalIdParams>;
      const body = request.body as z.infer<typeof catalogProposalStatusSchema>;
      const p = await setProposalStatus(auth.participantId, proposalId, {
        status: body.status,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(body.reviewNote !== undefined ? { reviewNote: body.reviewNote } : {}),
      });
      reply.send({ ...p, audit_id: request.auditId });
    },
  );

  // POST /passport/catalog/proposals/:proposalId/merge — merge (FA | COUNCIL).
  app.post(
    '/passport/catalog/proposals/:proposalId/merge',
    { preHandler: [authMiddleware, validateParams(catalogProposalIdParams)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const { proposalId } = request.params as z.infer<typeof catalogProposalIdParams>;
      const p = await mergeProposal(auth.participantId, proposalId);
      reply.send({ ...p, audit_id: request.auditId });
    },
  );  
  
}