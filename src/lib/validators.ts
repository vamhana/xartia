// L.0.01.03 — Валидаторы Zod
// Единый источник валидации входных данных API.
// Схемы синхронизированы с OpenAPI через zod-to-openapi (позже).

import { z } from 'zod';

import { ValidationError } from '../core/errors.js';

// -------- Примитивы --------

export const uuidSchema = z.string().uuid('Некорректный UUID');

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Телефон должен быть в формате E.164');

export const emailSchema = z.string().email('Некорректный email');

export const messengerSchema = z
  .object({
    telegram: z.string().optional(),
    whatsapp: z.string().optional(),
    signal: z.string().optional(),
  })
  .refine(
    (m) => Object.values(m).some((v) => typeof v === 'string' && v.length > 0),
    { message: 'Хотя бы один мессенджер обязателен' },
  );

// -------- Перечисления --------

const priorityValues = ['critical', 'high', 'standard', 'background'] as const;
export const prioritySchema = z.enum(priorityValues);

const participantStatusValues = [
  'compatible', 'conditionally_compatible', 'associated', 'full',
  'paused', 'outside_trust_network', 'master', 'integrator', 'pioneer', 'excluded',
] as const;
export const participantStatusSchema = z.enum(participantStatusValues);

const directionStatusValues = ['active', 'empty', 'delegated', 'blocked', 'abolished'] as const;
export const directionStatusSchema = z.enum(directionStatusValues);

const regimeTypeValues = [
  'red_circuit', 'steel_bell', 'ptt', 'info_blockade',
  'quantum_acceleration', 'global_red_circuit',
] as const;
export const regimeTypeSchema = z.enum(regimeTypeValues);

const taskStatusValues = [
  'created', 'assigned', 'in_progress', 'submitted', 'accepted', 'returned',
] as const;
export const taskStatusSchema = z.enum(taskStatusValues);

const connectionStatusValues = ['started', 'diagnostics', 'finished'] as const;
export const connectionStatusSchema = z.enum(connectionStatusValues);

const connectionResultValues = [
  'resolved', 'divergent', 'variant_found', 'incompatible', 'undetermined',
] as const;
export const connectionResultSchema = z.enum(connectionResultValues);

const arbitrationTypeValues = ['procedural', 'ownership'] as const;
export const arbitrationTypeSchema = z.enum(arbitrationTypeValues);

const arbitrationStatusValues = [
  'submitted', 'in_progress', 'decided', 'escalated_to_jury',
] as const;
export const arbitrationStatusSchema = z.enum(arbitrationStatusValues);

const planStatusValues = [
  'draft', 'run', 'approved', 'in_progress', 'completed', 'cancelled',
] as const;
export const planStatusSchema = z.enum(planStatusValues);

const planTypeValues = ['standard', 'crisis', 'excess', 'dissident'] as const;
export const planTypeSchema = z.enum(planTypeValues);

const goodStatusValues = ['draft', 'test', 'active', 'obsolete', 'liquidated'] as const;
export const goodStatusSchema = z.enum(goodStatusValues);

const signalStatusValues = ['new', 'run', 'connect', 'plan', 'completed', 'rejected'] as const;
export const signalStatusSchema = z.enum(signalStatusValues);

const signalTypeValues = ['need', 'problem', 'idea', 'failure'] as const;
export const signalTypeSchema = z.enum(signalTypeValues);

const signalResponseValues = ['support', 'object', 'clarify', 'amend', 'no_influence'] as const;
export const signalResponseSchema = z.enum(signalResponseValues);

const flowTypeValues = [
  'main', 'reflective', 'council', 'mentoring', 'creation', 'cross_direction',
] as const;
export const flowTypeSchema = z.enum(flowTypeValues);

const mandateStatusValues = ['active', 'expired', 'revoked'] as const;
export const mandateStatusSchema = z.enum(mandateStatusValues);

const quantumStatusValues = [
  'detected', 'audit', 'testing', 'scaling', 'active', 'cancelled',
] as const;
export const quantumStatusSchema = z.enum(quantumStatusValues);

const complaintTypeValues = ['violence', 'threat', 'coercion', 'harassment'] as const;
export const complaintTypeSchema = z.enum(complaintTypeValues);

const sanctionTypeValues = [
  'restorative_talk', 'temporary_isolation', 'resocialization', 'exclusion', 'not_imputable',
] as const;
export const sanctionTypeSchema = z.enum(sanctionTypeValues);

const rightActionValues = ['V', 'C', 'E', 'D', 'A', 'Dg', 'R', 'Vo', 'Act', 'Ar', 'S', 'F'] as const;
export const rightActionSchema = z.enum(rightActionValues);

const rightScopeValues = ['self', 'dir', 'all', 'agg', 'raw', 'arch'] as const;
export const rightScopeSchema = z.enum(rightScopeValues);

const runTypeValues = ['sequential', 'parallel', 'crisis'] as const;
export const runTypeSchema = z.enum(runTypeValues);

const runStatusValues = ['started', 'collecting', 'aggregated', 'finished'] as const;
export const runStatusSchema = z.enum(runStatusValues);

const goodTypeValues = ['material', 'nonmaterial'] as const;
export const goodTypeSchema = z.enum(goodTypeValues);

const projectResourceSignRoleValues = ['council', 'balance', 'verifier'] as const;
export const projectResourceSignRoleSchema = z.enum(projectResourceSignRoleValues);

export const uuidDecisionParams = z.object({ decision_id: uuidSchema });

export const uuidMobilizationParams = z.object({ mid: uuidSchema });

export const uuidChainParams = z.object({ chain_id: uuidSchema });

export const uuidVersionParams = z.object({
  id: uuidSchema,
  version: z.coerce.number().int().min(1),
});

export const uuidWidgetParams = z.object({
  id: uuidSchema,
  wid: uuidSchema,
});

// -------- ID-схемы --------

export const participantIdSchema = z
  .string()
  .regex(/^[А-Я]?\d{5}-\d{1,2}(:.+)?$/, 'Некорректный ID участника');

export const cellIdSchema = z
  .string()
  .regex(/^\d+×5-[^-]+(-.+)?$/, 'Некорректный ID ячейки');

export const taskIdSchema = z
  .string()
  .regex(/^[А-Я]{3}-\d{4}-\d{2}-\d{2}-\d{3}$/, 'Некорректный ID задачи');

export const signalIdSchema = z
  .string()
  .regex(/^SIG-\d{4}-\d{2}-\d{2}-\d{3}$/, 'Некорректный ID сигнала');

export const planIdSchema = z
  .string()
  .regex(/^PLAN-\d{4}-\d{2}-\d{2}-\d{3}$/, 'Некорректный ID плана');

export const externalIdSchema = z.union([
  participantIdSchema,
  cellIdSchema,
  taskIdSchema,
  signalIdSchema,
  planIdSchema,
  z.string().min(1),
]);

// -------- Path-params --------

/**
 * Стандартные path-параметры `:id` — UUID.
 * Используется во всех роутах вида `/resource/:id`.
 *
 * Для параметров с другим именем (например, `/auth/status/:request_id`)
 * объявляйте локально: `z.object({ request_id: uuidSchema })` — это не дубль,
 * а разная семантика.
 *
 * Роуты с составным ключом (`/cells/:id/members/:participant_id`) используют
 * `.extend({ participant_id: uuidSchema })`.
 */
export const uuidIdParams = z.object({ id: uuidSchema });

/**
 * Path-параметр `:task_id` — UUID. Аналог `uuidIdParams`, но с именем
 * `task_id` (для роутов `/tasks/:task_id/...`).
 */
export const uuidTaskParams = z.object({ task_id: uuidSchema });

/**
 * Path-параметр `:signal_id` — UUID.
 */
export const uuidSignalParams = z.object({ signal_id: uuidSchema });

/**
 * Path-параметр `:direction_id` — UUID.
 */
export const uuidDirectionParams = z.object({ direction_id: uuidSchema });

// -------- Составные --------

export const dateRangeSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((r) => new Date(r.from) < new Date(r.to), {
    message: 'Дата начала должна быть раньше даты окончания',
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

// -------- Утилиты --------

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    throw new ValidationError('Ошибка валидации', details);
  }
  return result.data;
}

export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return validate(schema, data);
}

// -------- Search (A.1.95.01) --------

const searchTypeValues = [
  'participant', 'signal', 'good', 'archive', 'task',
] as const;
export const searchTypeSchema = z.enum(searchTypeValues);

/**
 * Универсальный query для /search.
 *
 * types в query может прийти:
 *   - ?types=signal             (строка)
 *   - ?types=signal&types=good  (массив строк — Fastify)
 *   - ?types=signal,good        (comma-separated — некоторые клиенты)
 *
 * Нормализуем в массив SearchType[].
 */
const typesRawSchema = z.union([z.string(), z.array(z.string())]).optional();

export const searchQuerySchema = z.object({
  q: z.string().min(2, 'Минимум 2 символа').max(200),
  types: typesRawSchema.transform((v) => {
    if (v === undefined) {return undefined;}
    const items = Array.isArray(v) ? v : v.split(',');
    const out: Array<(typeof searchTypeValues)[number]> = [];
    for (const item of items) {
      const trimmed = item.trim();
      const parsed = searchTypeSchema.safeParse(trimmed);
      if (parsed.success) {out.push(parsed.data);}
    }
    return out.length > 0 ? out : undefined;
  }),
  direction_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(20),
});