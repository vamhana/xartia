// C.0.01.01 — Единый реестр ролей RBAC
// Перечисление всех ролей системы, иерархия выдачи, матрица конфликтов.
// Используется для проверки прав во всех сервисах, middleware и конструкторе.
//
// Три независимые сущности:
//   - ROLE_HIERARCHY — кто кого может назначить (административная иерархия);
//   - ROLE_CONFLICTS — какие роли нельзя совмещать у одного участника;
//   - ROLE_PRIORITY  — какая роль «главная» у участника с несколькими ролями
//     (для JWT.primaryRole, сортировки в UI, отображения в паспорте).

export enum Role {
  // Постоянные
  FIRST_ARCHITECT     = 'FIRST_ARCHITECT',

  // Мандатные — выборные / временные
  COUNCIL_MEMBER      = 'COUNCIL_MEMBER',
  OTC                 = 'OTC',
  KEEPER              = 'KEEPER',
  LIAISON             = 'LIAISON',
  BALANCER            = 'BALANCER',
  VERIFIER            = 'VERIFIER',
  PSY                 = 'PSY',
  JUSTICE             = 'JUSTICE',
  OBLIVION            = 'OBLIVION',
  NOOLOG              = 'NOOLOG',
  SEMANTIC_GUARDIAN   = 'SEMANTIC_GUARDIAN',
  OPERATOR            = 'OPERATOR',
  AGGREGATOR          = 'AGGREGATOR',
  GATEWAY_COUNCIL     = 'GATEWAY_COUNCIL',
  GUARANTOR           = 'GUARANTOR',
  PROTOCOL_COUNCIL    = 'PROTOCOL_COUNCIL',
  EXTERNAL_WITNESS    = 'EXTERNAL_WITNESS',
  JURY                = 'JURY',
  ARBITRATOR          = 'ARBITRATOR',
  MASTER              = 'MASTER',
  INTEGRATOR          = 'INTEGRATOR',
  PIONEER             = 'PIONEER',
  EXPANSIONIST        = 'EXPANSIONIST',

  // Статусные (не мандатные)
  OUTSIDE_TRUST       = 'OUTSIDE_TRUST',
  ASSOCIATED          = 'ASSOCIATED',
  PAUSED              = 'PAUSED',
  REMOTE              = 'REMOTE',
}

// Иерархия выдачи: кто какие роли может назначать
export const ROLE_HIERARCHY: Readonly<Record<Role, readonly Role[]>> = {
  [Role.FIRST_ARCHITECT]: Object.values(Role),
  [Role.COUNCIL_MEMBER]:  [Role.OTC, Role.LIAISON, Role.KEEPER, Role.VERIFIER, Role.BALANCER, Role.PSY, Role.OBLIVION, Role.NOOLOG],
  [Role.PROTOCOL_COUNCIL]: [Role.EXTERNAL_WITNESS, Role.JURY, Role.ARBITRATOR],
  [Role.GATEWAY_COUNCIL]: [Role.GUARANTOR, Role.EXTERNAL_WITNESS],
  [Role.SEMANTIC_GUARDIAN]: [Role.NOOLOG],
  [Role.MASTER]: [Role.INTEGRATOR, Role.PIONEER],
  // Остальные роли никого не выдают
  [Role.OTC]: [],
  [Role.KEEPER]: [],
  [Role.LIAISON]: [],
  [Role.BALANCER]: [],
  [Role.VERIFIER]: [],
  [Role.PSY]: [],
  [Role.JUSTICE]: [],
  [Role.OBLIVION]: [],
  [Role.NOOLOG]: [],
  [Role.OPERATOR]: [],
  [Role.AGGREGATOR]: [],
  [Role.GUARANTOR]: [],
  [Role.EXTERNAL_WITNESS]: [],
  [Role.JURY]: [],
  [Role.ARBITRATOR]: [],
  [Role.INTEGRATOR]: [],
  [Role.PIONEER]: [],
  [Role.EXPANSIONIST]: [],
  [Role.OUTSIDE_TRUST]: [],
  [Role.ASSOCIATED]: [],
  [Role.PAUSED]: [],
  [Role.REMOTE]: [],
};

// Конфликты ролей: кого нельзя совмещать
export const ROLE_CONFLICTS: Readonly<Record<Role, readonly Role[]>> = {
  [Role.LIAISON]:           [Role.COUNCIL_MEMBER, Role.OTC, Role.OPERATOR],
  [Role.OPERATOR]:          [Role.COUNCIL_MEMBER, Role.OTC, Role.BALANCER, Role.KEEPER, Role.MASTER, Role.LIAISON],
  [Role.COUNCIL_MEMBER]:    [Role.GATEWAY_COUNCIL, Role.LIAISON, Role.OPERATOR],
  [Role.GATEWAY_COUNCIL]:   [Role.COUNCIL_MEMBER],
  [Role.GUARANTOR]:         [
    Role.COUNCIL_MEMBER, Role.OTC, Role.LIAISON, Role.BALANCER,
    Role.VERIFIER, Role.OPERATOR, Role.AGGREGATOR, Role.NOOLOG,
  ],
  [Role.SEMANTIC_GUARDIAN]: [Role.OPERATOR],
  [Role.OTC]:               [Role.COUNCIL_MEMBER, Role.LIAISON, Role.OPERATOR],
  [Role.BALANCER]:          [Role.OPERATOR],
  [Role.KEEPER]:            [Role.OPERATOR],
  [Role.MASTER]:            [Role.OPERATOR],
  // Остальные — без конфликтов
  [Role.FIRST_ARCHITECT]:   [],
  [Role.VERIFIER]:          [],
  [Role.PSY]:               [],
  [Role.JUSTICE]:           [],
  [Role.OBLIVION]:          [],
  [Role.NOOLOG]:            [],
  [Role.AGGREGATOR]:        [],
  [Role.PROTOCOL_COUNCIL]:  [],
  [Role.EXTERNAL_WITNESS]:  [],
  [Role.JURY]:              [],
  [Role.ARBITRATOR]:        [],
  [Role.INTEGRATOR]:        [],
  [Role.PIONEER]:           [],
  [Role.EXPANSIONIST]:      [],
  [Role.OUTSIDE_TRUST]:     [],
  [Role.ASSOCIATED]:        [],
  [Role.PAUSED]:            [],
  [Role.REMOTE]:            [],
};

// Политика сроков: сколько длится мандат, сколько раз можно, cooldown
export interface TermPolicy {
  termDays: number | null;   // null = бессрочно
  maxTerms: number | null;   // null = без ограничения
  cooldownDays: number | null;
}

export const ROLE_MAX_TERMS: Readonly<Record<Role, TermPolicy>> = {
  [Role.COUNCIL_MEMBER]:    { termDays: 730, maxTerms: 2,   cooldownDays: 730 },
  [Role.OTC]:               { termDays: 180, maxTerms: 1,   cooldownDays: 180 },
  [Role.LIAISON]:           { termDays: 365, maxTerms: 2,   cooldownDays: 365 },
  [Role.OPERATOR]:          { termDays: 180, maxTerms: 2,   cooldownDays: 180 },
  [Role.AGGREGATOR]:        { termDays: 730, maxTerms: 2,   cooldownDays: 730 },
  [Role.SEMANTIC_GUARDIAN]: { termDays: 1825, maxTerms: 1,  cooldownDays: null },
  [Role.GATEWAY_COUNCIL]:   { termDays: 1825, maxTerms: 1,  cooldownDays: 1825 },
  [Role.GUARANTOR]:         { termDays: 1825, maxTerms: 0,  cooldownDays: null },
  [Role.PROTOCOL_COUNCIL]:  { termDays: 1095, maxTerms: 0,  cooldownDays: null },
  [Role.BALANCER]:          { termDays: 365, maxTerms: 2,   cooldownDays: 365 },
  [Role.VERIFIER]:          { termDays: 365, maxTerms: 2,   cooldownDays: 365 },
  [Role.JURY]:              { termDays: null, maxTerms: null, cooldownDays: null },   // разово
  [Role.ARBITRATOR]:        { termDays: null, maxTerms: null, cooldownDays: null },   // разово
  [Role.FIRST_ARCHITECT]:   { termDays: null, maxTerms: null, cooldownDays: null },   // пожизненно
  [Role.MASTER]:            { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.INTEGRATOR]:        { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.PIONEER]:           { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.EXPANSIONIST]:      { termDays: null, maxTerms: null, cooldownDays: null },
  // Keeper, Psy, Justice, Oblivion, Noolog, External Witness — постоянные профессии
  [Role.KEEPER]:            { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.PSY]:               { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.JUSTICE]:           { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.OBLIVION]:          { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.NOOLOG]:            { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.EXTERNAL_WITNESS]:  { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.OUTSIDE_TRUST]:     { termDays: 180, maxTerms: null, cooldownDays: null },
  [Role.ASSOCIATED]:        { termDays: 1095, maxTerms: null, cooldownDays: null },  // 3 года
  [Role.PAUSED]:            { termDays: null, maxTerms: null, cooldownDays: null },
  [Role.REMOTE]:            { termDays: null, maxTerms: null, cooldownDays: null },
};

// -------- Приоритет ролей --------
// Используется для детерминированного выбора «главной» роли:
// JWT.primaryRole, отображение в UI, сортировка ролей в паспорте.
// Старшая роль имеет большее число. Сортировка — по убыванию.
//
// НЕ путать с ROLE_HIERARCHY: там «кто кого может назначить», здесь
// «какая роль главнее у одного участника».
//
// Числа — интуитивный baseline: мандатные роли совета выше статусных,
// статусные (ASSOCIATED/OUTSIDE_TRUST/PAUSED/REMOTE) — в самом низу.
// Если появятся формальные требования по старшинству — правятся здесь
// без изменения структуры кода.
export const ROLE_PRIORITY: Readonly<Record<Role, number>> = {
  [Role.FIRST_ARCHITECT]:     100,
  [Role.COUNCIL_MEMBER]:       90,
  [Role.PROTOCOL_COUNCIL]:     85,
  [Role.GATEWAY_COUNCIL]:      80,
  [Role.SEMANTIC_GUARDIAN]:    75,
  [Role.VERIFIER]:             70,
  [Role.BALANCER]:             70,
  [Role.OTC]:                  65,
  [Role.LIAISON]:              65,
  [Role.KEEPER]:               60,
  [Role.PSY]:                  60,
  [Role.JUSTICE]:              60,
  [Role.MASTER]:               60,
  [Role.OBLIVION]:             55,
  [Role.NOOLOG]:               55,
  [Role.OPERATOR]:             50,
  [Role.AGGREGATOR]:           50,
  [Role.GUARANTOR]:            50,
  [Role.EXTERNAL_WITNESS]:     45,
  [Role.INTEGRATOR]:           45,
  [Role.JURY]:                 40,
  [Role.ARBITRATOR]:           40,
  [Role.PIONEER]:              40,
  [Role.EXPANSIONIST]:         35,
  [Role.ASSOCIATED]:           20,
  [Role.OUTSIDE_TRUST]:         5,
  [Role.PAUSED]:                5,
  [Role.REMOTE]:                5,
};

// -------- Функции --------

export function isRoleValid(value: string): value is Role {
  return Object.values(Role).includes(value as Role);
}

export function getConflicts(role: Role): readonly Role[] {
  return ROLE_CONFLICTS[role] ?? [];
}

export function canGrant(grantor: Role, target: Role): boolean {
  const allowed = ROLE_HIERARCHY[grantor] ?? [];
  return allowed.includes(target);
}

export function getTermPolicy(role: Role): TermPolicy {
  return ROLE_MAX_TERMS[role] ?? { termDays: null, maxTerms: null, cooldownDays: null };
}

// Проверка, могут ли две роли сосуществовать у одного участника
export function rolesConflict(a: Role, b: Role): boolean {
  return getConflicts(a).includes(b) || getConflicts(b).includes(a);
}

export function getRolePriority(role: Role): number {
  return ROLE_PRIORITY[role] ?? 0;
}

// Детерминированный выбор старшей роли из набора.
// Возвращает null для пустого массива — вызывающий решает fallback
// (например, Role.ASSOCIATED в auth-контроллере).
export function pickPrimaryRole(roles: readonly Role[]): Role | null {
  if (roles.length === 0) { return null; }
  return roles.reduce((best, r) =>
    getRolePriority(r) > getRolePriority(best) ? r : best,
  );
}