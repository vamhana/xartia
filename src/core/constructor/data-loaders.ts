// C.0.26.03 — Data loaders для виджетов Конструктора.
//
// Реестр loader'ов: entity → функция, которая возвращает данные для виджета.
// Loader вызывается ОТ ИМЕНИ участника — все фильтры по направлению и
// участнику применяются здесь, чтобы виджет не показал чужое.
//
// Формат данных — "натуральный" для типа виджета:
//   - Card            → одиночный объект
//   - Table/List/Chart/Timeline/Tree → массив объектов
//   - Metric/Progress/Circular → { value, max? }
//   - Map             → массив { id, lat, lon, label?, type? }
//
// Ошибки одного loader'а не роняют панель — Promise.allSettled в loadPanelData.
//
// v0.0.02:
//   - LoaderContext.directionId: UUID | null (участник может быть без направления).
//   - DIRECTION_SCOPED: набор entity, которые без directionId не имеют смысла;
//     каждый такой loader дополнительно проверяет ctx.directionId (защита в
//     глубину — даже если loader вызовут вне loadPanelData).
//   - Все direction-scoped loader'ы объявлены async, чтобы TS сводил ветки
//     `return []` / `return null` с `Promise<T>` в `Promise<...>`.
//   - complaints: listComplaints(filter, requesterId) — 2-й аргумент.
//   - jury_session / jury_votes: только модератор, участник сессии или Архитектор.
//   - archive_search: только FIRST_ARCHITECT / KEEPER / VERIFIER.
//   - audits / rechecks: только VERIFIER / FIRST_ARCHITECT.
//   - arbitrations / arbitrations_overdue: только ARBITRATOR / FIRST_ARCHITECT.
//   - transactions / assets: только GATEWAY_COUNCIL / GUARANTOR / FIRST_ARCHITECT.

import {
  list as listRegimes,
  getActive as getActiveRegimes,
  getCurrentDeadlines,
} from '../regimes/service.js';

import {
  listGoods,
  getById as getGoodById,
} from '../goods/service.js';

import {
  listPlans,
  getById as getPlanById,
  getDailyPlan,
} from '../plans/service.js';

import {
  getSession as getJurySession,
  countVotesService as getJuryVotes,
} from '../jury/service.js';

import {
  listDrift,
  listAlarms,
  listDictionary,
} from '../semantic/service.js';

import {
  listDocuments as listArchive,
  searchDocuments,
} from '../archive/service.js';

import {
  listCourses,
  getPtt,
  listRoutes,
} from '../learning/service.js';

import {
  listAudits,
  getRecheckStats,
} from '../verification/service.js';

import {
  listComplaints,
  getInvestigation,
} from '../justice/service.js';

import {
  listCommunities,
  listBridges,
  getPulse as getPlanetaryPulse,
} from '../planetary/service.js';

import {
  listTransactions,
  listAssets,
  getCouncil as getGatewayCouncil,
} from '../gateway/service.js';

import {
  getQueue as getConnectivityQueue,
  getOverdue as getConnectivityOverdue,
} from '../connectivity/service.js';

import {
  getHistory as getNotificationsHistory,
  getUnreadCount,
} from '../../lib/notifications.js';

import { listMyChannels } from '../chat/service.js';

import {
  listStandards,
  listModifiers,
} from '../standards/service.js';

import {
  listMandates,
  listDue,
  getActiveCooldowns,
} from '../mandates/service.js';

import {
  list as listDirections,
  listRoles,
} from '../directions/service.js';

import {
  listByTask as listReportsByTask,
  listByParticipant as listReportsByParticipant,
} from '../reports/service.js';

import {
  listArbitrations,
  listOverdue as listArbitrationsOverdue,
} from '../arbitrations/service.js';

import {
  listAnomalies,
  getPulse as getBalancePulse,
  getMetrics as getBalanceMetrics,
  listIndices,
  listNormativeSpeeds,
  listCompetenceRisks,
} from '../balance/service.js';

import {
  listCells,
  getById as getCellById,
  buildTree,
} from '../cells/service.js';

import {
  getBySignal as getConnectionBySignal,
  listByDirection as listConnectionsByDirection,
  listAll as listAllConnections,
} from '../connections/service.js';

import {
  getBalance,
  getCapsule,
  getReturns,
  getDeferredFlow,
  getFreedomReserve,
  getPlanetaryReserve,
} from '../flows/service.js';

import {
  getQueue as getOtcQueue,
  getStats as getOtcStats,
} from '../otc/service.js';

import {
  getPassport,
  listParticipants,
} from '../participants/service.js';

import { Role } from '../roles.js';

import {
  listSignals,
  getById as getSignalById,
} from '../signals/service.js';

import {
  listTasks,
  listMyTasks,
  getById as getTaskById,
} from '../tasks/service.js';

import type { UUID } from '../types.js';

import { listBySignal as listRunsBySignal } from '../universal-runs/service.js';

import type { WidgetInstance } from './entity.js';

// ─── Типы ────────────────────────────────────────────────────────

export interface LoaderContext {
  participantId: UUID;
  directionId: UUID | null;   // может быть null: участник без направления
  role: Role;
}

export interface LoaderInput {
  ctx: LoaderContext;
  instance: WidgetInstance;
}

type LoaderFn = (input: LoaderInput) => Promise<unknown>;

interface LoaderEntry {
  fn: LoaderFn;
  /**
   * true  — кэшируется по entity (list-type, не зависит от instance)
   * false — кэшируется по `${entity}:${instanceId}` (single-item)
   */
  cacheByEntity: boolean;
}

// ─── Direction-scoped ────────────────────────────────────────────
//
// Entity, которые без directionId не имеют смысла (чужое направление или
// пустая страница). loadPanelData (C.0.26.02) может пропускать их при
// ctx.directionId === null; каждый loader ниже дублирует проверку —
// защита в глубину.

export const DIRECTION_SCOPED: ReadonlySet<string> = new Set([
  'tasks', 'signals', 'cells', 'goods', 'plans', 'archive',
  'mandates', 'roles', 'connectivity_queue', 'otc_queue', 'otc_stats',
  'anomalies', 'balance_pulse', 'balance_metrics', 'connections',
  'daily_plan', 'complaints',
]);

// ─── Вспомогательные ─────────────────────────────────────────────
//
// Некоторые сервисы возвращают { data, total } — виджетам нужен чистый
// массив. Разворачиваем здесь.

interface PagedLike<T> {
  data: T[];
  total?: number;
}

function unwrap<T>(p: PagedLike<T> | T[]): T[] {
  return Array.isArray(p) ? p : p.data;
}

/** Читает строку из overrides виджета, с fallback. */
function ovrStr(inst: WidgetInstance, key: string): string | null {
  const v = inst.overrides[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ─── Реестр ──────────────────────────────────────────────────────

export const DATA_LOADERS: Record<string, LoaderEntry> = {
  // ─── participants ──────────────────────────────────────────────
  // Контейнер-виджет — собственных данных не имеет. Заглушка, чтобы не
  // попадала в missingEntities.
  layout: {
    cacheByEntity: true,
    fn: async () => null,
  },
  passport: {
    cacheByEntity: true,
    fn: async ({ ctx }) => getPassport(ctx.participantId, ctx.participantId),
  },
  me: {
    cacheByEntity: true,
    fn: async ({ ctx }) => getPassport(ctx.participantId, ctx.participantId),
  },
  participants: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      const r = await listParticipants(
        { page: 1, perPage: 50 },
        ctx.participantId,
      );
      return unwrap(r);
    },
  },

  // ─── flows ─────────────────────────────────────────────────────
  flows: {
    cacheByEntity: true,
    fn: async ({ ctx }) => getBalance(ctx.participantId),
  },
  capsule: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      const c = await getCapsule(ctx.participantId);
      return { value: c.balance, max: 180 };
    },
  },
  // Агрегатные метрики Потоков (для widget.type=metric/progress/circular).
  // Если виджет на entity='flows' ожидает { value }, он не сможет читать
  // массив FlowBalance[] — для этого отдельные сущности с готовым { value }.
  main_balance: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      const balances = await getBalance(ctx.participantId);
      const main = balances.find((b) => b.type === 'main');
      return { value: main?.balance ?? 0 };
    },
  },
  // Алиас для библиотечного виджета chart/balance: в widgets.entity лежит
  // 'balance', а loader'а с таким именем не было — виджет попадал в
  // missingEntities и рисовал пустоту. Показываем основной Поток участника.
  balance: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      const balances = await getBalance(ctx.participantId);
      const main = balances.find((b) => b.type === 'main');
      return { value: main?.balance ?? 0 };
    },
  },
  total_flow: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      const balances = await getBalance(ctx.participantId);
      const total = balances.reduce((acc, b) => acc + (b.balance ?? 0), 0);
      return { value: total };
    },
  },
  returns: {
    cacheByEntity: true,
    fn: async ({ ctx }) => getReturns(ctx.participantId),
  },
  deferred: {
    cacheByEntity: true,
    fn: async () => getDeferredFlow(),
  },
  freedom_reserve: {
    cacheByEntity: true,
    fn: async () => getFreedomReserve(),
  },
  planetary_reserve: {
    cacheByEntity: true,
    fn: async () => getPlanetaryReserve(),
  },

  // ─── tasks ─────────────────────────────────────────────────────
  tasks: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listTasks({
        directionId: ctx.directionId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  my_tasks: {
    cacheByEntity: true,
    fn: async ({ ctx }) => listMyTasks(ctx.participantId),
  },
  task: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'task_id');
      return id ? getTaskById(id) : null;
    },
  },

  // ─── signals ───────────────────────────────────────────────────
  signals: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listSignals({
        leadDirectionId: ctx.directionId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  signal: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'signal_id');
      return id ? getSignalById(id) : null;
    },
  },

  // ─── otc ───────────────────────────────────────────────────────
  otc_queue: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      return getOtcQueue(ctx.directionId);
    },
  },
  otc_stats: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return null;}
      return getOtcStats(ctx.directionId);
    },
  },

  // ─── balance ───────────────────────────────────────────────────
  anomalies: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listAnomalies({
        directionId: ctx.directionId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  balance_pulse: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return null;}
      return getBalancePulse(ctx.directionId);
    },
  },
  balance_metrics: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return null;}
      return getBalanceMetrics(ctx.directionId);
    },
  },
  indices: {
    cacheByEntity: true,
    fn: async () => listIndices(),
  },
  norms: {
    cacheByEntity: true,
    fn: async () => listNormativeSpeeds(),
  },
  risks: {
    cacheByEntity: true,
    fn: async () => listCompetenceRisks(),
  },

  // ─── cells ─────────────────────────────────────────────────────
  cells: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      return listCells({ directionId: ctx.directionId });
    },
  },
  cell: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'cell_id');
      return id ? getCellById(id) : null;
    },
  },
  cell_tree: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'root_cell_id');
      return id ? buildTree(id) : [];
    },
  },

  // ─── regimes ───────────────────────────────────────────────────
  regimes: {
    cacheByEntity: true,
    fn: async () => listRegimes(),
  },
  active_regimes: {
    cacheByEntity: true,
    fn: async () => getActiveRegimes(),
  },
  deadlines: {
    cacheByEntity: true,
    fn: async () => getCurrentDeadlines(),
  },

  // ─── goods ─────────────────────────────────────────────────────
  goods: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listGoods({
        producerDirectionId: ctx.directionId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  good: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'good_id');
      return id ? getGoodById(id) : null;
    },
  },

  // ─── plans ─────────────────────────────────────────────────────
  plans: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listPlans({
        leadDirectionId: ctx.directionId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  plan: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'plan_id');
      return id ? getPlanById(id) : null;
    },
  },
  daily_plan: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return null;}
      return getDailyPlan(ctx.directionId);
    },
  },

  // ─── jury ──────────────────────────────────────────────────────
  // Только модератор, участник сессии или Архитектор.
  jury_session: {
    cacheByEntity: false,
    fn: async ({ ctx, instance }) => {
      const id = ovrStr(instance, 'session_id');
      if (!id) {return null;}
      const s = await getJurySession(id);
      const isModerator = s.moderatorId === ctx.participantId;
      const isParticipant = s.participants.includes(ctx.participantId);
      const isArch = ctx.role === Role.FIRST_ARCHITECT;
      if (!isModerator && !isParticipant && !isArch) {return null;}
      return s;
    },
  },
  jury_votes: {
    cacheByEntity: false,
    fn: async ({ ctx, instance }) => {
      const id = ovrStr(instance, 'session_id');
      if (!id) {return null;}
      const s = await getJurySession(id);
      const isModerator = s.moderatorId === ctx.participantId;
      const isParticipant = s.participants.includes(ctx.participantId);
      const isArch = ctx.role === Role.FIRST_ARCHITECT;
      if (!isModerator && !isParticipant && !isArch) {return null;}
      return getJuryVotes(id);
    },
  },

  // ─── semantic ──────────────────────────────────────────────────
  drift: {
    cacheByEntity: true,
    fn: async () => {
      const r = await listDrift({ page: 1, perPage: 50 });
      return unwrap(r);
    },
  },
  alarms: {
    cacheByEntity: true,
    fn: async () => listAlarms(),
  },
  dictionary: {
    cacheByEntity: true,
    fn: async () => listDictionary(),
  },

  // ─── archive ───────────────────────────────────────────────────
  archive: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listArchive({
        directionId: ctx.directionId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  // Поиск по архиву — только KEEPER / VERIFIER / Архитектор.
  archive_search: {
    cacheByEntity: false,
    fn: async ({ ctx, instance }) => {
      if (
        ctx.role !== Role.FIRST_ARCHITECT &&
        ctx.role !== Role.KEEPER &&
        ctx.role !== Role.VERIFIER
      ) {
        return [];
      }
      const q = ovrStr(instance, 'query');
      return q ? searchDocuments(q) : [];
    },
  },

  // ─── learning ──────────────────────────────────────────────────
  courses: {
    cacheByEntity: true,
    fn: async () => {
      const r = await listCourses({ page: 1, perPage: 50 });
      return unwrap(r);
    },
  },
  ptt: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'ptt_id');
      return id ? getPtt(id) : null;
    },
  },
  routes: {
    cacheByEntity: true,
    fn: async ({ ctx }) => listRoutes({ participantId: ctx.participantId }),
  },

  // ─── verification ──────────────────────────────────────────────
  // Только VERIFIER / Архитектор.
  audits: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (ctx.role !== Role.VERIFIER && ctx.role !== Role.FIRST_ARCHITECT) {
        return [];
      }
      const r = await listAudits({ page: 1, perPage: 50 });
      return unwrap(r);
    },
  },
  rechecks: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (ctx.role !== Role.VERIFIER && ctx.role !== Role.FIRST_ARCHITECT) {
        return null;
      }
      return getRecheckStats();
    },
  },

  // ─── justice ───────────────────────────────────────────────────
  // listComplaints(filter, requesterId) — 2-й аргумент.
  // NB: listComplaints в C.0.21.02 не использует _requesterId — PII всё равно
  // течёт. Это техдолг C.0.21.02, не чинится в loader'е. Фиксируем.
  complaints: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listComplaints(
        { page: 1, perPage: 50 },
        ctx.participantId,
      );
      return unwrap(r);
    },
  },
  investigations: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'investigation_id');
      return id ? getInvestigation(id) : null;
    },
  },

  // ─── planetary ─────────────────────────────────────────────────
  communities: {
    cacheByEntity: true,
    fn: async () => listCommunities({}),
  },
  bridges: {
    cacheByEntity: true,
    fn: async () => listBridges(),
  },
  planetary_pulse: {
    cacheByEntity: true,
    fn: async () => getPlanetaryPulse(),
  },

  // ─── gateway ───────────────────────────────────────────────────
  // Только GATEWAY_COUNCIL / GUARANTOR / Архитектор.
  transactions: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (
        ctx.role !== Role.GATEWAY_COUNCIL &&
        ctx.role !== Role.GUARANTOR &&
        ctx.role !== Role.FIRST_ARCHITECT
      ) {
        return [];
      }
      return listTransactions({});
    },
  },
  assets: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (
        ctx.role !== Role.GATEWAY_COUNCIL &&
        ctx.role !== Role.GUARANTOR &&
        ctx.role !== Role.FIRST_ARCHITECT
      ) {
        return [];
      }
      return listAssets();
    },
  },
  gateway_council: {
    cacheByEntity: true,
    fn: async () => getGatewayCouncil(),
  },

  // ─── connectivity ──────────────────────────────────────────────
  connectivity_queue: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      return getConnectivityQueue({ directionId: ctx.directionId });
    },
  },
  connectivity_overdue: {
    cacheByEntity: true,
    fn: async () => getConnectivityOverdue(),
  },

  // ─── notifications ─────────────────────────────────────────────
  notifications_history: {
    cacheByEntity: true,
    fn: async ({ ctx }) => getNotificationsHistory(ctx.participantId, 50),
  },
  notifications_unread: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      const n = await getUnreadCount(ctx.participantId);
      return { value: n };
    },
  },

  // ─── chat ──────────────────────────────────────────────────────
  chat_channels: {
    cacheByEntity: true,
    fn: async ({ ctx }) => listMyChannels(ctx.participantId),
  },

  // ─── standards ─────────────────────────────────────────────────
  standards: {
    cacheByEntity: true,
    fn: async () => listStandards(),
  },
  modifiers: {
    cacheByEntity: true,
    fn: async () => listModifiers(),
  },

  // ─── mandates ──────────────────────────────────────────────────
  mandates: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      const r = await listMandates({
        holderId: ctx.participantId,
        page: 1,
        perPage: 50,
      });
      return unwrap(r);
    },
  },
  mandates_due: {
    cacheByEntity: true,
    fn: async () => listDue(30),
  },
  cooldowns: {
    cacheByEntity: true,
    fn: async ({ ctx }) => getActiveCooldowns(ctx.participantId),
  },

  // ─── directions ────────────────────────────────────────────────
  directions: {
    cacheByEntity: true,
    fn: async () => listDirections(),
  },
  roles: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      return listRoles(ctx.directionId);
    },
  },

  // ─── reports ───────────────────────────────────────────────────
  my_reports: {
    cacheByEntity: true,
    fn: async ({ ctx }) => listReportsByParticipant(ctx.participantId),
  },
  reports_by_task: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'task_id');
      return id ? listReportsByTask(id) : [];
    },
  },

  // ─── arbitrations ──────────────────────────────────────────────
  // Только ARBITRATOR / Архитектор.
  arbitrations: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (ctx.role !== Role.ARBITRATOR && ctx.role !== Role.FIRST_ARCHITECT) {
        return [];
      }
      const r = await listArbitrations({ page: 1, perPage: 50 });
      return unwrap(r);
    },
  },
  arbitrations_overdue: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (ctx.role !== Role.ARBITRATOR && ctx.role !== Role.FIRST_ARCHITECT) {
        return [];
      }
      return listArbitrationsOverdue();
    },
  },

  // ─── connections ───────────────────────────────────────────────
  connections: {
    cacheByEntity: true,
    fn: async ({ ctx }) => {
      if (!ctx.directionId) {return [];}
      return listConnectionsByDirection(ctx.directionId);
    },
  },
  all_connections: {
    cacheByEntity: true,
    fn: async () => listAllConnections(),
  },
  connection_by_signal: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'signal_id');
      return id ? getConnectionBySignal(id) : null;
    },
  },

  // ─── universal-runs ────────────────────────────────────────────
  runs_by_signal: {
    cacheByEntity: false,
    fn: async ({ instance }) => {
      const id = ovrStr(instance, 'signal_id');
      return id ? listRunsBySignal(id) : [];
    },
  },
};

export function getLoader(entity: string): LoaderEntry | null {
  return DATA_LOADERS[entity] ?? null;
}