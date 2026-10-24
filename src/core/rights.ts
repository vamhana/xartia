// C.0.01.06 — Модуль проверки прав.
// Уровни: роли → scope → режим → матрица.
// Матрица читается из rights_matrix (БД) с кэшем Redis (TTL 30 сек).
// Fallback на hardcoded PERMISSIONS — для ролей/ресурсов, которых нет в БД.

import { query } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { getEffectiveRoles } from '../security/rbac.js';

import { ForbiddenError } from './errors.js';
import { Role, getConflicts, rolesConflict } from './roles.js';
import type { UUID, RightAction, RightScope, RegimeType } from './types.js';

export interface RightCheckInput {
  participantId: UUID;
  resource: string;
  action: RightAction;
  targetId?: UUID | null;
  scope?: RightScope;
}

export interface RightCheckResult {
  allowed: boolean;
  reason: string;
  constraints: {
    cooldown?: boolean;
    regime?: RegimeType;
    conflict?: boolean;
    expired?: boolean;
  };
  matchedRole?: Role;
}

// ─── Fallback-матрица (для ролей, которых нет в rights_matrix) ───

type RolePermissions = Partial<Record<Role, Partial<Record<string, RightAction[]>>>>;

const FIRST_ARCHITECT_ALL: Partial<Record<string, RightAction[]>> = {
  '*': ['V', 'C', 'E', 'D', 'A', 'Dg', 'R', 'Vo', 'Act', 'Ar', 'S', 'F'],
};

export const FALLBACK_PERMISSIONS: RolePermissions = {
  [Role.FIRST_ARCHITECT]: FIRST_ARCHITECT_ALL,
  [Role.ASSOCIATED]: {
    participant: ['V'], direction: ['V'], task: ['V'],
    signal: ['V', 'C'], flow: ['V'], good: ['V'],
    report: ['V', 'C'], connection: ['V'],
    arbitration: ['V'], regime: ['V'],
  },
  [Role.OPERATOR]: {
    automation: ['V', 'C', 'E', 'A', 'Act'],
    participant: ['V'],   // нужно для canBeOperator (SELECT participants)
    // mandate: ['V']    — не нужно: мандаты уже доступны через getRoles
  },
  [Role.COUNCIL_MEMBER]: {
    participant: ['V', 'E'], direction: ['V', 'E'],
    cell: ['V', 'C', 'E', 'D'],
    task: ['V', 'C', 'E', 'A'], signal: ['V', 'C', 'E'],
    connection: ['V', 'C', 'E'], arbitration: ['V', 'C', 'E'],
    plan: ['V', 'C', 'E', 'A'], flow: ['V', 'C'],
    good: ['V', 'C', 'E', 'A'], report: ['V', 'A'],
    regime: ['V', 'Act'], mandate: ['V', 'C', 'D', 'R'],
    automation: ['V', 'A'],
    experiment: ['V', 'C', 'E', 'A'],
    bulk: ['V', 'C'],
    recovery_request: ['A'],
  },
  [Role.OTC]: {
    participant: ['V'], task: ['V', 'A'],
    report: ['V', 'A', 'E'], flow: ['V', 'C'],
    direction: ['V'], otc: ['V', 'C'],
  },
  [Role.VERIFIER]: {
    audit: ['V', 'C', 'E', 'A', 'S'], participant: ['V'],
    task: ['V', 'A'], report: ['V'], archive: ['V'],
    gateway: ['V', 'A'], regime: ['V', 'A'],
    jury: ['V', 'C'], flow: ['V', 'C'],
    automation: ['V', 'A'],
    webhook: ['V'],
    quantum: ['V', 'A', 'E'],
    convergence: ['V', 'A'],
    experiment: ['V', 'A'],
    export: ['V', 'C'],
    import: ['V'],
    bulk: ['V'],
  },
  [Role.KEEPER]: {
    archive: ['V', 'C', 'E', 'S', 'Ar'],
    plan: ['V', 'S'], signal: ['V'], participant: ['V'],
    export: ['V', 'C'],
  },
  [Role.LIAISON]: {
    signal: ['V', 'C', 'E'],
    connectivity: ['V', 'C', 'E'],
    task: ['V'], participant: ['V'],
  },
  [Role.BALANCER]: {
    balance: ['V', 'C', 'E', 'A', 'D'], direction: ['V'],
    signal: ['V'], participant: ['V'], regime: ['V', 'Act'],
    quantum: ['V', 'C'],
    export: ['V', 'C'],
  },
  [Role.PSY]: { psy_session: ['V', 'C', 'E', 'Act'], participant: ['V'] },
  [Role.JUSTICE]: {
    justice: ['V', 'C', 'E'], participant: ['V'],
    regime: ['V', 'Act'], jury: ['V', 'C', 'E'],
  },
  [Role.MASTER]: {
    participant: ['V', 'E'], direction: ['V'],
    task: ['V', 'C'], learning: ['V', 'C'],
  },
  [Role.NOOLOG]: {
    direction: ['V'], signal: ['V'], regime: ['V', 'Act'],
    connection: ['V', 'C', 'E'],
    quantum: ['V', 'C', 'E', 'Act'],
    convergence: ['V', 'E'],
    // Act — только для cron-задачи I.3.05.11 (process-suspensions).
    experiment: ['V', 'C', 'Act'],
  },
  [Role.OBLIVION]: { good: ['V', 'D'] },
  [Role.SEMANTIC_GUARDIAN]: { semantic: ['V', 'C', 'Act'], signal: ['V'] },

  [Role.AGGREGATOR]: {
    signal: ['V', 'C', 'E'], aggregator: ['V', 'C', 'E', 'Act'],
  },
  [Role.GATEWAY_COUNCIL]: {
    gateway: ['V', 'C', 'E', 'A', 'Dg'], direction: ['V'],
  },
  [Role.GUARANTOR]: { gateway: ['V'] },
  [Role.PROTOCOL_COUNCIL]: {
    planetary: ['V', 'C', 'E', 'A', 'Dg'],
    webhook: ['V', 'C', 'E', 'D', 'Act'],
    convergence: ['V', 'C', 'E', 'A'],
  },
  [Role.EXTERNAL_WITNESS]: { planetary: ['V'] },
  [Role.JURY]: { jury: ['V', 'Vo'] },
  [Role.ARBITRATOR]: {
    arbitration: ['V', 'C', 'E', 'A'], jury: ['V', 'C', 'Act'],
  },
  [Role.INTEGRATOR]: {
    learning: ['V', 'C', 'E'], participant: ['V', 'E'],
  },
  [Role.PIONEER]: { learning: ['V'] },
  [Role.EXPANSIONIST]: { planetary: ['V', 'C'] },
  [Role.OUTSIDE_TRUST]: {},
  [Role.PAUSED]: {},
  [Role.REMOTE]: {},
};

// ─── Кэш матрицы из БД ───────────────────────────────────────────

// v2: в матрице учтён scope, структура изменилась.
// Старый ключ v1 — в Redis может жить до TTL 30 сек; не читаем его.
const CACHE_KEY = 'rights:matrix:v2';
const CACHE_TTL_SEC = 30;

// role → resource → action → список scope'ов ('all' = без ограничений)
type MatrixMap = Map<Role, Map<string, Map<RightAction, RightScope[]>>>;

function isRoleString(s: string): s is Role {
  return Object.values(Role).includes(s as Role);
}

async function loadMatrixFromDb(): Promise<MatrixMap> {
  const rows = await query<{
    role_name: string;
    resource: string;
    action: RightAction;
    scope: RightScope;
  }>(`
    SELECT r.name AS role_name, rm.resource, rm.action, rm.scope
      FROM rights_matrix rm
      JOIN roles r ON r.id = rm.role_id
  `);

  const matrix: MatrixMap = new Map();
  for (const row of rows) {
    if (!isRoleString(row.role_name)) {continue;}
    let rolePerms = matrix.get(row.role_name);
    if (!rolePerms) {
      rolePerms = new Map();
      matrix.set(row.role_name, rolePerms);
    }
    let actions = rolePerms.get(row.resource);
    if (!actions) {
      actions = new Map();
      rolePerms.set(row.resource, actions);
    }
    const scopes = actions.get(row.action) ?? [];
    if (!scopes.includes(row.scope)) {
      scopes.push(row.scope);
    }
    actions.set(row.action, scopes);
  }
  return matrix;
}

type SerializedMatrix = Record<
  string,
  Record<string, Record<string, RightScope[]>>
>;

async function loadMatrix(): Promise<MatrixMap> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as SerializedMatrix;
      const matrix: MatrixMap = new Map();
      for (const [role, resources] of Object.entries(parsed)) {
        if (!isRoleString(role)) {continue;}
        const resourceMap = new Map<string, Map<RightAction, RightScope[]>>();
        for (const [resource, actions] of Object.entries(resources)) {
          const actionMap = new Map<RightAction, RightScope[]>();
          for (const [action, scopes] of Object.entries(actions)) {
            actionMap.set(action as RightAction, scopes);
          }
          resourceMap.set(resource, actionMap);
        }
        matrix.set(role, resourceMap);
      }
      return matrix;
    }
  } catch (e) {
    logger.warn({ err: e }, 'rights: cache read failed');
  }

  const matrix = await loadMatrixFromDb();

  try {
    const serializable: SerializedMatrix = {};
    for (const [role, resources] of matrix) {
      serializable[role] = {};
      for (const [resource, actions] of resources) {
        serializable[role][resource] = {};
        for (const [action, scopes] of actions) {
          serializable[role][resource][action] = scopes;
        }
      }
    }
    await redis.set(CACHE_KEY, JSON.stringify(serializable), 'EX', CACHE_TTL_SEC);
  } catch (e) {
    logger.warn({ err: e }, 'rights: cache write failed');
  }

  return matrix;
}

export async function invalidateRightsMatrixCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
  } catch (e) {
    logger.warn({ err: e }, 'rights: invalidate failed');
  }
}

// ─── Проверка в матрице + fallback ──────────────────────────────

function scopeMatches(
  allowedScopes: RightScope[],
  requested?: RightScope,
): boolean {
  if (!requested) {return true;}
  return allowedScopes.includes('all') || allowedScopes.includes(requested);
}

function checkInMatrix(
  matrix: MatrixMap,
  role: Role,
  resource: string,
  action: RightAction,
  requestedScope?: RightScope,
): { matched: boolean; reason: 'universal' | 'resource' } | null {
  const rolePerms = matrix.get(role);
  if (rolePerms) {
    const universal = rolePerms.get('*')?.get(action);
    if (universal && scopeMatches(universal, requestedScope)) {
      return { matched: true, reason: 'universal' };
    }
    const resourcePerms = rolePerms.get(resource)?.get(action);
    if (resourcePerms && scopeMatches(resourcePerms, requestedScope)) {
      return { matched: true, reason: 'resource' };
    }
  }
  const fb = FALLBACK_PERMISSIONS[role];
  if (fb) {
    // Fallback не знает про scope — считаем, что это 'all'.
    const universal = fb['*'];
    if (universal && universal.includes(action)) {
      return { matched: true, reason: 'universal' };
    }
    const resourcePerms = fb[resource];
    if (resourcePerms && resourcePerms.includes(action)) {
      return { matched: true, reason: 'resource' };
    }
  }
  return null;
}

// ─── Публичный API ───────────────────────────────────────────────

// Sync-ядро: работает на уже загруженных ролях и матрице.
// Используется и в checkRight (одиночно), и в checkRightBatch (батчем),
// чтобы не делать N round-trip'ов к Redis при 500+ проверках.
function checkRightFromLoaded(
  input: RightCheckInput,
  roles: Role[],
  matrix: MatrixMap,
): RightCheckResult {
  if (roles.length === 0) {
    return {
      allowed: false,
      reason: 'Нет активных ролей',
      constraints: {},
    };
  }

  for (const role of roles) {
    const hit = checkInMatrix(
      matrix,
      role,
      input.resource,
      input.action,
      input.scope,
    );
    if (!hit) {continue;}

    const reason =
      hit.reason === 'universal'
        ? `Роль ${role} имеет универсальное право`
        : `Роль ${role} разрешает ${input.action} на ${input.resource}`;

    const constraints: RightCheckResult['constraints'] = {};

    // conflict: у участника есть ещё одна активная роль, которая конфликтует
    // с matchedRole. Право есть, но вызывающий должен это учесть.
    const conflicts = getConflicts(role);
    if (conflicts.length > 0) {
      const conflicting = roles.find(
        (r) => r !== role && conflicts.includes(r),
      );
      if (conflicting) {
        constraints.conflict = true;
      }
    }

    return { allowed: true, reason, constraints, matchedRole: role };
  }

  return {
    allowed: false,
    reason: `Ни одна из ролей не разрешает ${input.action} на ${input.resource}`,
    constraints: {},
  };
}

export async function checkRight(
  input: RightCheckInput,
): Promise<RightCheckResult> {
  const roles = await getEffectiveRoles(input.participantId);
  const matrix = await loadMatrix();
  return checkRightFromLoaded(input, roles, matrix);
}

export async function assertRight(input: RightCheckInput): Promise<void> {
  const result = await checkRight(input);
  if (!result.allowed) {
    throw new ForbiddenError(result.reason, {
      resource: input.resource,
      action: input.action,
    });
  }
}

export async function checkRightBatch(
  inputs: RightCheckInput[],
): Promise<RightCheckResult[]> {
  if (inputs.length === 0) {
    return [];
  }

  // Все входы в /permissions/me — один participantId. Даже если разных —
  // роли грузим по одному разу на участника, матрицу — один раз глобально.
  const uniqueParticipants = [...new Set(inputs.map((i) => i.participantId))];
  const rolesByParticipant = new Map<UUID, Role[]>();
  await Promise.all(
    uniqueParticipants.map(async (pid) => {
      rolesByParticipant.set(pid, await getEffectiveRoles(pid));
    }),
  );
  const matrix = await loadMatrix();

  return inputs.map((input) =>
    checkRightFromLoaded(
      input,
      rolesByParticipant.get(input.participantId) ?? [],
      matrix,
    ),
  );
}

export async function getConflictsForParticipant(
  participantId: UUID,
): Promise<Role[]> {
  const roles = await getEffectiveRoles(participantId);
  const found = new Set<Role>();
  for (let i = 0; i < roles.length; i++) {
    const a = roles[i];
    if (!a) {continue;}
    for (let j = i + 1; j < roles.length; j++) {
      const b = roles[j];
      if (!b) {continue;}
      if (rolesConflict(a, b)) {
        found.add(a);
        found.add(b);
      }
    }
  }
  return Array.from(found);
}

// ─── Чтение матрицы для UI (A.1.94.01) ─────────────────────────

export interface RoleRightEntry {
  resource: string;
  action: RightAction;
  scope: RightScope;
}

export async function listRightsForRole(
  roleId: UUID,
): Promise<RoleRightEntry[]> {
  const rows = await query<RoleRightEntry>(
    `SELECT DISTINCT rm.resource, rm.action, rm.scope
       FROM rights_matrix rm
      WHERE rm.role_id = $1
      ORDER BY rm.resource, rm.action, rm.scope`,
    [roleId],
  );
  return rows;
}

export interface MatrixEntry {
  roleId: UUID;
  roleName: Role;
  resource: string;
  action: RightAction;
  scope: RightScope;
  version: number;
}

export async function listRightsMatrix(): Promise<MatrixEntry[]> {
  const rows = await query<{
    role_id: UUID;
    role_name: string;
    resource: string;
    action: RightAction;
    scope: RightScope;
    version: number;
  }>(
    `SELECT rm.role_id, r.name AS role_name, rm.resource, rm.action,
            rm.scope, rm.version
       FROM rights_matrix rm
       JOIN roles r ON r.id = rm.role_id
      ORDER BY r.name, rm.resource, rm.action, rm.scope`,
  );
  return rows
    .filter((r) => isRoleString(r.role_name))
    .map((r) => ({
      roleId: r.role_id,
      roleName: r.role_name as Role,
      resource: r.resource,
      action: r.action,
      scope: r.scope,
      version: r.version,
    }));
}

export { getConflicts };