// src/api/permissions/controller.ts
/**
 * A.1.94.01 — Permissions controller.
 *
 * Проверка прав текущего пользователя. Синхронизация с клиентом.
 * Эффективные роли. Кэш 30 сек (на клиенте).
 */

import type { FastifyInstance } from 'fastify';

import {
  checkRight,
  checkRightBatch,
  listRightsForRole,
  listRightsMatrix,
} from '../../core/rights.js';
import type { RightAction, RightScope, UUID } from '../../core/types.js';
import {
  getRoles,
  getEffectiveRoles,
  getActiveMandates,
} from '../../security/rbac.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';

// ─── Справочники ─────────────────────────────────────────────────

const RESOURCES = [
  'participant', 'direction', 'cell', 'mandate', 'plan', 'task',
  'report', 'otc_decision', 'signal', 'connection', 'arbitration',
  'universal_run', 'flow', 'capsule', 'good', 'standard', 'modifier',
  'regime', 'balance', 'anomaly', 'verification', 'audit', 'archive',
  'complaint', 'investigation', 'isolation', 'sanction', 'jury_session',
  'outside_trust', 'psy_session', 'gateway', 'transaction', 'quantum',
  'panel', 'widget', 'community', 'convergence', 'semantic', 'experiment',
  'learning', 'automation',   // ← есть
  'aggregator', 'connectivity', 'chat','webhook', 'export', 'import',
  'bulk',
] as const;

const ACTIONS: RightAction[] = [
  'V', 'C', 'E', 'D', 'A',
  'Dg', 'R', 'Vo', 'Act', 'Ar', 'S', 'F',
];

const SCOPES: RightScope[] = ['self', 'dir', 'all', 'agg', 'raw', 'arch'];

// UUID-валидатор для параметров пути и тел запросов.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Типы тел запросов ───────────────────────────────────────────

interface CheckBody {
  resource: string;
  action: RightAction;
  target_id?: UUID;
  scope?: RightScope;
}

interface CheckBatchBody {
  checks: CheckBody[];
}

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerPermissionsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── GET /permissions/me ───────────────────────────────────────
  app.get(
    '/permissions/me',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const ctx = getAuthContext(request);

      const [roleAssignments, effective, mandates] = await Promise.all([
        getRoles(ctx.participantId),
        getEffectiveRoles(ctx.participantId),
        getActiveMandates(ctx.participantId),
      ]);

      // Массовая проверка: все ресурсы × все действия
      const checks = RESOURCES.flatMap((resource) =>
        ACTIONS.map((action) => ({
          participantId: ctx.participantId,
          resource,
          action,
        })),
      );
      const results = await checkRightBatch(checks);

      const rights: Record<string, RightAction[]> = {};
      let i = 0;
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          if (results[i]?.allowed) {
            (rights[resource] ??= []).push(action);
          }
          i += 1;
        }
      }

      return reply.send({
        roles: roleAssignments.map((r) => r.role),
        effective,
        mandates: mandates.map((m) => ({
          role: m.role,
          directionId: m.directionId,
          mandateId: m.mandateId,
          validFrom: m.validFrom,
          validTo: m.validTo,
        })),
        rights,
        audit_id: request.auditId,
      });
    },
  );

  // ─── POST /permissions/check ───────────────────────────────────
  app.post<{ Body: CheckBody }>(
    '/permissions/check',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const body = request.body;

      if (
        !body ||
        typeof body.resource !== 'string' ||
        typeof body.action !== 'string'
      ) {
        return reply.status(422).send({
          code: 'VALIDATION_ERROR',
          message: 'resource and action are required',
          audit_id: request.auditId,
        });
      }

      const result = await checkRight({
        participantId: ctx.participantId,
        resource: body.resource,
        action: body.action,
        targetId: body.target_id ?? null,
        ...(body.scope ? { scope: body.scope } : {}),
      });

      return reply.send({
        allowed: result.allowed,
        reason: result.reason,
        constraints: result.constraints,
        matchedRole: result.matchedRole,
        audit_id: request.auditId,
      });
    },
  );

  // ─── POST /permissions/check-batch ─────────────────────────────
  app.post<{ Body: CheckBatchBody }>(
    '/permissions/check-batch',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const body = request.body;

      if (!body || !Array.isArray(body.checks)) {
        return reply.status(422).send({
          code: 'VALIDATION_ERROR',
          message: 'checks must be an array',
          audit_id: request.auditId,
        });
      }

      const results = await checkRightBatch(
        body.checks.map((c) => ({
          participantId: ctx.participantId,
          resource: c.resource,
          action: c.action,
          targetId: c.target_id ?? null,
          ...(c.scope ? { scope: c.scope } : {}),
        })),
      );

      return reply.send({
        results: results.map((r) => ({
          allowed: r.allowed,
          reason: r.reason,
          constraints: r.constraints,
          matchedRole: r.matchedRole,
        })),
        audit_id: request.auditId,
      });
    },
  );

  // ─── GET /permissions/roles/:role_id ───────────────────────────
  app.get<{ Params: { role_id: string } }>(
    '/permissions/roles/:role_id',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { role_id: roleId } = request.params;

      if (!UUID_RE.test(roleId)) {
        return reply.status(422).send({
          code: 'VALIDATION_ERROR',
          message: 'role_id must be a UUID',
          audit_id: request.auditId,
        });
      }

      const rights = await listRightsForRole(roleId);

      return reply.send({
        role_id: roleId,
        rights,
        audit_id: request.auditId,
      });
    },
  );

  // ─── GET /permissions/matrix ───────────────────────────────────
  app.get(
    '/permissions/matrix',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const entries = await listRightsMatrix();
      return reply.send({
        entries,
        audit_id: request.auditId,
      });
    },
  );

  // ─── GET /permissions/resources ────────────────────────────────
  app.get(
    '/permissions/resources',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      return reply.send({
        resources: RESOURCES,
        audit_id: request.auditId,
      });
    },
  );

  // ─── GET /permissions/actions ──────────────────────────────────
  app.get(
    '/permissions/actions',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      return reply.send({
        actions: ACTIONS,
        audit_id: request.auditId,
      });
    },
  );

  // ─── GET /permissions/scopes ───────────────────────────────────
  app.get(
    '/permissions/scopes',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      return reply.send({
        scopes: SCOPES,
        audit_id: request.auditId,
      });
    },
  );
}