# docs/passport-phase3c.md — план (с разбивкой на 3c/3d/3e)

## 1. Скоуп и развилка

8 пунктов остались в бэклоге после 3b:

- **TeamCapability (§11.4)** — ~1000 строк
- **Калибровка 0–9 (§6.5)** — инфраструктура + контент
- **AI-рекомендации (§9.3, §16.6)** — требует LLM-провайдера
- **Полный интерактивный граф (§8.4)** — 400–600 строк
- **practice_review_policy для оставшихся 50 атомов** — 200 строк
- **Cron для permits.status='expired'** — 100 строк
- **AdminLayout lazy (warning 3b)** — 20 строк
- **Педагогическая компетенция как атом** — отдельный трек «каталог v0.4»

**Развилка: 8 пунктов = 3 разных класса задач.**

- **Технические (в 3c):** TeamCapability, cron, AdminLayout, practice_review_policy — можно делать сейчас, ~1500 строк.
- **Контентные** (калибровка 0–9, каталог v0.4): требуют решений предметных специалистов (anchor examples, критерии). Инфраструктуру (таблицы, API, UI загрузки) — можно, но сами anchor'ы — нет.
- **Требующие внешних решений** (AI): LLM-провайдер, бюджет, безопасность, RAG. Без этого — только «правила» вместо LLM.
- **UI-инфраструктура** (граф): ~500 строк SVG, можно в 3d.

**Мой рекомендованный дефолт:**

- **Фаза 3c (эта):** TeamCapability + cron + AdminLayout lazy + practice_review_policy для 50. ~1500 строк, реалистично.
- **Фаза 3d:** Калибровка 0–9 (инфраструктура) + полный граф. ~1200 строк.
- **Фаза 3e (опционально):** AI-рекомендации — требует отдельного решения по LLM.
- **Отдельный трек:** «каталог v0.4» — педагогическая компетенция + дополнение каталога (workflow §16.1).

### 1.1. Сверка с кодом — обязательна до старта

Перед шагом 1 проверить (иначе оценка и файлы «поплывут»):

- [ ] **Номер миграции 062 свободен** (`ls db/migrations/059* db/migrations/06*`).
- [ ] **`src/worker/index.ts` существует**, есть ли `src/worker/jobs/`.
- [ ] **`src/web/pages/admin/index.ts`** — barrel, как его импортируют сейчас в `App.tsx`.
- [ ] **`scripts/test-passport-v3.ts`, `v4`, `v5` существуют** (пункт 5 «v2/v3/v4/v5 — не сломаны»).
- [ ] **`ContentChangeRate` в `src/core/passport/types.ts`** — значения (`'slow' | 'medium' | 'fast'` или есть `'very_fast'`). См. A52.
- [ ] **`src/core/passport/visibility.ts`** — структура `switch` по `scope` (куда добавлять `'team'`). См. N6.
- [ ] **`projection.ts` — источник `staleAssessments`**: колонка `assessed_at` / `created_at` / `valid_from`? См. A58.

---

## 2. Карта 3c: раздел → файл → тест → статус

### 2.1. TeamCapability (§11.4)

Раздел | Что | Файл | Тест | Статус
---|---|---|---|---
11.4 | **`team_capabilities`** — не атом индивидуального паспорта; `participants JSONB` (состав — см. A47), `expected_result text`, `criteria JSONB`, `assessor_id UUID`, `status ∈ {draft, active, assessed, deprecated}`. Триггер `BEFORE INSERT OR UPDATE` проверяет `assessor_id ∉ participants` (CHECK с подзапросом в Postgres невозможен — см. A47) | `db/migrations/062_passport_phase3c.sql` | создание; попытка `assessor_id ∈ participants` → исключение | planned
11.4 | **`team_capability_assessments`** — история оценок (level 0..9, `criteria_scores JSONB`, `context`, `assessor_id`, `assessed_at`). Append-only по духу, как `passport_assessments` (нет `DELETE`) | 062 | FK + append-only | planned
11.4 | **`GET /passport/teams`** — список команд, где viewer ∈ participants ИЛИ viewer = assessor (нужен для UI `TeamsListPage`; см. N2/N3) | `src/core/passport/teams.ts` (новый), `controller.ts` | 200 + фильтрация | planned
11.4 | **`POST /passport/teams`** — создать команду. Роли: `FIRST_ARCHITECT \| COUNCIL_MEMBER \| OTC` (см. A48, B1) | `teams.ts` | 201; 403 для прочих | planned
11.4 | **`GET /passport/teams/:id`** — read. Доступ: viewer ∈ participants ИЛИ assessor (см. N6) | `teams.ts` | 200 / 403 | planned
11.4 | **`POST /passport/teams/:id/assess`** — оценка команды (`level`, `criteria_scores`). Роли: `FIRST_ARCHITECT \| VERIFIER` (A48); assessor ∉ participants (валидация API + триггер в 062) | `teams.ts` | 201; 403 если assessor ∈ participants | planned
11.4 | **`GET /passport/teams/:id/history`** — история оценок | `teams.ts` | список | planned
11.4 | **Приватность scope=`team`:** `viewer ∈ participants OR viewer = assessor`. Требует правки `visibility.ts` (см. N6) | `src/core/passport/visibility.ts` (изменение) | 403 для прочих | planned
11.4 | `passport_history_events.event_type += 'team_assessed'` (payload — см. A57) | 062 | CHECK | planned
11.4 | `passport_visibility.scope += 'team'` | 062 | CHECK | planned
11.4 | UI: **`TeamsListPage.tsx`** (`/teams`), **`TeamPage.tsx`** (`/teams/:id`), **`TeamAssessmentPanel.tsx`** | `src/web/pages/TeamsListPage.tsx`, `src/web/pages/TeamPage.tsx`, `src/web/components/passport/TeamAssessmentPanel.tsx` | видно | planned

**Принципиально:** TeamCapability **не** учитывается в width/depth индивидуального паспорта (§11.4 паспорта: «не сводится к сумме индивидуальных»). Отдельная сущность.

### 2.2. practice_review_policy для оставшихся 50 (§6.4.1, A15, A52)

**Зависимость:** требует применённого фикса `freshness_policy IS DISTINCT FROM $13::jsonb` в `scripts/seed-passport.ts` (правка от 2026-11-03, см. пункт 5 «Изменения плана» в `docs/passport-implementation.md`). Без этого фикса изменение `practice_review_policy` в `atoms.ts` **не доедет** до существующей БД, и тест v6 «54/54» провалится.

Раздел | Что | Файл | Тест | Статус
---|---|---|---|---
6.4.1 | **Хелпер `a()`:** дефолт `practice_review_policy` → `derivePracticePolicy(opts.changeRate ?? 'medium')` где `{ slow: 'P24M', medium: 'P12M', fast: 'P6M' }` (см. A52 про `very_fast`) | `scripts/seed-data/atoms.ts` (helper + 8 полных объектов 0002–0008, 0010) | 54/54 имеют P-политику | planned
6.4.1 | **8 полных объектов (0002–0008, 0010):** явно проставить `practice_review_policy` по `content_change_rate` | `scripts/seed-data/atoms.ts` | 54/54 | planned
6.4.1 | **4 пилота (0001, 0009, 0017, 0041)** — не трогаем, уже заданы (A15) | — | — | done
6.4.1 | seed: при смене `freshness_policy` — `UPDATE` (уже есть в `seed-passport.ts` после фикса turn-1) | `scripts/seed-passport.ts` | идемпотентно | done
6.4.1 | **Тест v6: `staleAssessments` непуст после бэкдейта на 5+ атомах** (не только на пилотах). Механизм бэкдейта — см. A58 | `scripts/test-passport-v6.ts` | stale | planned

### 2.3. Cron для permits.status='expired'

Раздел | Что | Файл | Тест | Статус
---|---|---|---|---
10.3 | Job `permits-expire` (раз в час): `UPDATE permits SET status='expired' WHERE status='active' AND valid_until < now()`; то же для `participant_permits` | `src/worker/index.ts` (расширить), `src/worker/jobs/permits-expire.ts` (новый) | unit | planned
10.3 | `passport_history_events` — не пишем (это не действие актора); логируем в `audit_log` | `permits-expire.ts` | audit_log | planned
10.3 | **Лаг до 1 часа приемлем** (A59): downstream-проверки полагаются на `valid_until`, не на `status` | — | — | —

**Почему в worker:** не на API-процессе (несколько инстансов дадут дубли). У нас уже есть `src/worker/index.ts`.

### 2.4. AdminLayout lazy (техдолг 3b)

Раздел | Что | Файл | Тест | Статус
---|---|---|---|---
— | Вынести `AdminLayout` из `pages/admin/index.ts` в `pages/admin/_Layout.tsx`; в `App.tsx` — `lazy(() => import('./pages/admin/_Layout').then(m => ({ default: m.AdminLayout })))`. Warning `[INEFFECTIVE_DYNAMIC_IMPORT]` исчезнет | `src/web/pages/admin/_Layout.tsx`, `App.tsx` | vite build без warning | planned

### 2.5. Тесты и CI

Что | Файл | Тест | Статус
---|---|---|---
`scripts/test-passport-v6.ts` — TeamCapability CRUD + assess + 403 + GET /teams list + cron (ручной прогон) + stale на 5+ атомах | `scripts/test-passport-v6.ts` | 0 failed | planned
`scripts/lib/passport-fixtures.ts` — `createTeam`, `assessTeam`, `backdateAssessment` (A58) | расширение | — | planned
`ci-local.ps1` — smoke: passport-v6 | — | — | planned
`ci.yml` — «Smoke — паспорт v6» (формат как v3: `set -o pipefail; pnpm tsx … 2>&1 \| tee …`) | — | — | planned

---

## 3. A-пункты (A47–A59, дефолты)

# | Вопрос | Дефолт
---|---|---
A47 | **TeamCapability — JSONB или join table?** | **JSONB `participants` + триггер `BEFORE INSERT/UPDATE`, проверяющий `assessor_id ∉ participants`.** CHECK с подзапросом в Postgres невозможен — используем триггер (функция `team_assessor_not_in_participants()` в 062). FK-целостность `participants → participants(id)` проверяется в API на `POST /passport/teams` (валидация UUID перед insert). **Если нужна жёсткая FK** — переключиться на join table `team_capability_members (team_id, participant_id)`, но это уже не JSONB и меняет API-контракт ввода.
A48 | **Assessor команды — кто?** | Создание: `FIRST_ARCHITECT \| COUNCIL_MEMBER \| OTC`. Оценка: `FIRST_ARCHITECT \| VERIFIER`. Проверка `assessor_id ∉ participants` — триггер в 062 + API. (COUNCIL/OTC могут создать, но не оценить; VERIFIER — наоборот — это **намеренно**, зафиксировано.)
A49 | TeamCapability в getCandidates? | Нет. Отдельный роут `POST /passport/teams/match` — 3d/3e.
A50 | UI TeamCapability — где? | Список `/teams` → `TeamsListPage.tsx`; деталь `/teams/:id` → `TeamPage.tsx`. Не в `Passport` — это не индивидуальная проекция.
A51 | Cron — в каком воркере? | `src/worker/index.ts` (уже есть). Job `permits-expire`, раз в час.
A52 | **`practice_review_policy` для 50 — по `content_change_rate`?** | Да: `slow→P24M, medium→P12M, fast→P6M`. Про `very_fast`: **проверить `ContentChangeRate` в types.ts**; если его нет — маппинг по 3 значениям, `0041` остаётся `P3M` явно. 4 пилота (A15) не трогаем.
A53 | AdminLayout lazy — куда? | `src/web/pages/admin/_Layout.tsx`, lazy в `App.tsx`. Barrel `pages/admin/index.ts` остаётся (для `DashboardPage` etc. — они уже lazy).
A54 | TeamCapability visibility — новый scope? | Да, `passport_visibility.scope += 'team'`. Проверка: `viewer ∈ participants OR viewer = assessor` — реализовать в `visibility.ts` (N6). Остальные — 403.
A55 | `passport_visibility` миграция для `'team'` | CHECK constraint расширяется в 062. Без default — существующие записи не трогаются.
**A56** | **Shape `criteria_scores` в `POST /passport/teams/:id/assess`** | `{ [criterionKey: string]: number }` — объект, ключи ⊆ `team_capabilities.criteria` (JSONB). API валидирует: все ключи существуют в `criteria`, все значения `0..9`. Валидация в `teams.ts`, тип — `Record<string, number>`.
**A57** | **Payload `team_assessed` в `passport_history_events`** | `{ team_id: string, assessment_id: string, level: number, assessor_id: string, criteria_scores: Record<string, number> }`. Пишется в той же транзакции, что и `INSERT INTO team_capability_assessments`.
**A58** | **Механизм бэкдейта для `staleAssessments` (v6)** | `passport_assessments` **не имеет REVOKE UPDATE** (в отличие от `passport_history_events`, где только INSERT) — статус `superseded` обновляется штатно. Значит: v6-fixture `scripts/lib/passport-fixtures.ts#backdateAssessment()` делает прямой `UPDATE passport_assessments SET assessed_at = now() - interval '…'` через pg-pool. **Предусловие:** сначала подтвердить в `projection.ts`, что `staleAssessments` считается по `assessed_at` (а не `created_at`); иначе фикстура обновляет не ту колонку.
**A59** | **Cron permits: лаг 1 час — приемлем?** | Да. Downstream проверяет `valid_until > now()`, а не `status='active'`. `status='expired'` — только для отображения/аналитики. Зафиксировать в §2.3.
**N6** | **Правка `visibility.ts` для scope=`team`** | В `switch(scope)` добавить case `'team'`: `allowed = viewer ∈ participants || viewer === team.assessor_id`. `team` подтягивается из `team_capabilities` по `teamId`. Явно добавить `src/core/passport/visibility.ts` в §4 и §2.1 (в исходном плане отсутствовал).
**N7** | **`GET /passport/teams` — нужен для UI** | Да, добавлен в §2.1. Фильтр: `WHERE id IN (SELECT team_id FROM … WHERE viewer ∈ participants OR viewer = assessor)`.

---

## 4. Порядок работ 3c

Шаг | Что | Файлы
---|---|---
0 | **Сверка с кодом (§1.1)** — до всего остального | —
1 | **Миграция 062:** `team_capabilities`, `team_capability_members` (если A47=join table) / триггер для JSONB, `team_capability_assessments`, `passport_visibility.scope += team`, `event_type += team_assessed` | `db/migrations/062_passport_phase3c.sql`
2 | **`teams.ts`** — `GET /teams` (список), `POST /teams` (создать), `GET /teams/:id`, `POST /teams/:id/assess`, `GET /teams/:id/history` | `src/core/passport/teams.ts`, `src/api/passport/controller.ts`
2b | **`visibility.ts`** — case `'team'` (N6) | `src/core/passport/visibility.ts`
**Чек-поинт 1** | TeamCapability API работает; `GET /teams` фильтрует | —
3 | **`practice_review_policy` для 50** — `derivePracticePolicy` в `a()`, 8 явных значений в полных объектах | `scripts/seed-data/atoms.ts`
4 | **Cron permits-expire** | `src/worker/index.ts`, `src/worker/jobs/permits-expire.ts`
5 | **AdminLayout lazy** | `src/web/pages/admin/_Layout.tsx`, `App.tsx`
**Чек-поинт 2** | Practice + cron + AdminLayout | —
6 | **UI** — `TeamsListPage.tsx`, `TeamPage.tsx`, `TeamAssessmentPanel.tsx` + роуты `/teams`, `/teams/:id` | `src/web/pages/`, `src/web/components/passport/`
7 | **`scripts/test-passport-v6.ts`** + расширение фикстур (`createTeam`, `assessTeam`, `backdateAssessment`) | `scripts/`
8 | **CI:** smoke: passport-v6 (в `ci-local.ps1` и `.github/workflows/ci.yml`) | —
9 | **Финальный прогон** + отчёт `docs/passport-phase3c.md` §«Изменения плана» | —

**Если 3c не влезает:** останавливаемся после чек-поинта 1 (TeamCapability). Practice + cron + AdminLayout — отдельной итерацией.

---

## 5. Критерии готовности 3c

- [ ] `POST /passport/teams` → 201; `GET /passport/teams` → 200 (список отфильтрован); `GET /passport/teams/:id` → 200; `POST /passport/teams/:id/assess` → 201.
- [ ] `POST /assess` assessor'ом из participants → 403 (API) **и** попытка `INSERT INTO team_capabilities (assessor_id ∈ participants)` → исключение триггера.
- [ ] `GET /history` — список оценок.
- [ ] `passport_visibility` scope='team': viewer ∈ participants → 200; прочие → 403.
- [ ] `54/54` атомов имеют `practice_review_policy ≠ 'to_calibrate'` (4 пилота + 50 по A52).
- [ ] `staleAssessments` непуст после бэкдейта на 5+ атомах (v6, механизм A58).
- [ ] Cron: `permits.status='expired'` после `valid_until < now()`; лаг ≤ 1 час (A59).
- [ ] `vite build` без `[INEFFECTIVE_DYNAMIC_IMPORT]`.
- [ ] UI `/teams` и `/teams/:id` работают.
- [ ] `typecheck`, `typecheck:web`, `vite build` — зелёные.
- [ ] v2/v3/v4/v5 — не сломаны.
- [ ] v6 — 0 failed.
- [ ] CI: `smoke: passport-v6` в `ci-local.ps1` + `ci.yml` (формат с `set -o pipefail` и `2>&1 | tee`).

---

## 6. Что НЕ входит в 3c

- Калибровка 0–9 (§6.5) — **3d**.
- AI-рекомендации (§9.3, §16.6) — **3e** (требует LLM-провайдера).
- Полный интерактивный граф (§8.4) — **3d**.
- Педагогическая компетенция как атом — отдельный трек «каталог v0.4».
- Team matching (`POST /passport/teams/match`) — **3d/3e**.

---

## 7. Оценка объёма 3c

Блок | Строк
---|---
Миграция 062 (включая триггер для `assessor_id ∉ participants`) | ~130
`teams.ts` (включая `GET /teams` list) | ~350
API (5 роутов + `controller.ts` правки) | ~220
`visibility.ts` (case `'team'`) | ~40
`practice_review_policy` для 50 (`a()` + 8 полных) | ~150
Cron | ~120
AdminLayout lazy | ~30
UI `TeamsListPage` + `TeamPage` + `TeamAssessmentPanel` | ~550
`test-passport-v6.ts` | ~350
Фикстуры (`createTeam`, `assessTeam`, `backdateAssessment`) | ~120
CI | ~10
**Итого** | **~2070**

Риск средний. `practice_review_policy` + cron + AdminLayout — быстрые (250 строк). Основной вес — TeamCapability (800+) и UI (550).

**Оговорка:** оценка выросла относительно исходной (~1690) из-за:
- добавления `GET /passport/teams` (N2),
- разделения `TeamsPage` на `TeamsListPage` + `TeamPage` (N3),
- правки `visibility.ts` для scope=`team` (N6),
- триггера в 062 (A47),
- бэкдейт-фикстуры (A58).

---

## 8. Что после 3c

- **Фаза 3d (план отдельно):** Калибровка 0–9 (инфраструктура: `anchor_examples`, `calibration_sessions`, API загрузки, UI) + полный интерактивный граф.
- **Фаза 3e (по запросу):** AI-рекомендации. Требует отдельного решения по LLM-провайдеру.
- **Трек «каталог v0.4»:** педагогическая компетенция + дополнение каталога.

---

## 9. Открытые вопросы (перенесены из 3b, если нужны)

*(Если в 3b остались неразрешённые — перечислить здесь со ссылкой на соответствующий раздел паспорта. Сейчас — пусто.)*

## Изменения плана

**2026-11-05.** Фаза 3c (TeamCapability + practice_review_policy + cron
+ AdminLayout lazy) реализована. Актуальные статусы ниже; таблицы §2
остаются в исходном виде (они отражают план, а не факт).

### Сделано (файлы)

**Миграции:**
- `db/migrations/062_passport_phase3c.sql`:
  - `team_capabilities` (participants JSONB, assessor_id, status,
    триггер `assessor_id ∉ participants`);
  - `team_capability_assessments` (append-only, CHECK level 0..9,
    criteria_scores JSONB);
  - `passport_visibility.scope += 'team'`;
  - `passport_history_events.event_type += 'team_assessed'`;
  - GIN-индекс на `participants`, индекс на `assessor_id`.

**Домен:**
- `src/core/passport/teams.ts` — новый. `createTeam` (FA|COUNCIL|OTC),
  `assessTeam` (FA|VERIFIER, assessor ∉ participants), `getTeam`,
  `listTeamsForViewer` (участник | assessor | создатель — N7),
  `getTeamHistory`, `validateParticipants`, `validateCriteria`,
  `validateCriteriaScores` (ключи ⊆ criteria, значения 0..9).
- `src/core/passport/visibility.ts` — расширен case `'team'` в
  `resolveScopeGrant` (N6): viewer ∈ participants | assessor → 200,
  иначе 403.
- `src/core/passport/types.ts` — DTO: `TeamCapability`,
  `TeamCapabilityAssessment`, `CreateTeamInput`, `AssessTeamInput`;
  `VisibilityScope` += `'team'`; `HistoryEventType` += `'team_assessed'`.

**API (аддитивно, 5 новых путей):**
- `GET /passport/teams`, `POST /passport/teams`
- `GET /passport/teams/:teamId`
- `POST /passport/teams/:teamId/assess`
- `GET /passport/teams/:teamId/history`

**Seed / данные:**
- `scripts/seed-data/atoms.ts` — `derivePracticePolicy()`: slow→P24M,
  medium→P12M, fast→P6M, very_fast→P3M (A52). 8 «полных» объектов
  0002–0008 + 0010 явно проставлены. 4 пилота (0001, 0009, 0017, 0041)
  не тронуты (A15).
- Итог: 54/54 атома с конкретной P-политикой, `to_calibrate` → 0.
  Распределение: P12M=32, P24M=11, P6M=10, P3M=1.

**Cron:**
- `src/worker/jobs/permits-expire.ts` — новый.
  `runPermitsExpire()`: `permits` + `participant_permits` со
  `status='active' AND valid_until < now()` → `expired`. Логирует в
  `system_events` (type='permits_expired'). НЕ пишет в
  `passport_history_events` (A59).
- `src/worker/index.ts` — `setInterval(runPermitsExpire, 1ч)` +
  первый прогон при старте + `clearInterval` в shutdown.
- `scripts/run-permits-expire.ts` — новый. Ручной прогон (для smoke
  и отладки).

**Code-splitting / UI:**
- `src/web/pages/admin/_Layout.tsx` — нет, вынос не потребовался:
  `AdminLayout` уже в отдельном файле, проблема была в **статическом**
  импорте через barrel в `App.tsx`. Решение — прямой lazy-импорт из
  `./pages/admin/AdminLayout`. Barrel `pages/admin/index.ts` не тронут.
- `src/web/pages/TeamsListPage.tsx` — новый. `/teams`, `GET /passport/teams`.
- `src/web/pages/TeamPage.tsx` — новый. `/teams/:id`, детали + `TeamAssessmentPanel`.
- `src/web/components/passport/TeamAssessmentPanel.tsx` — новый.
  История + форма «Оценить команду» (level 0..9, критерии 0..9).
- `src/web/components/layout/Sidebar.tsx` — добавлен пункт «Команды»
  (`/teams`, иконка 🤝).
- `src/web/App.tsx` — 2 lazy-роута `/teams`, `/teams/:id`. Убран
  статический `import { AdminLayout } from './pages/admin'`.
- `src/web/types.ts` — DTO: `PassportTeamCapability`,
  `PassportTeamCapabilityAssessment`, `PassportTeamCapabilityStatus`.

**Тесты/CI:**
- `scripts/lib/passport-fixtures.ts` — расширен: `createTeam`,
  `listMyTeams`, `getTeam`, `assessTeam`, `getTeamHistory`.
- `scripts/test-passport-v6.ts` — новый. Покрывает:
  1. practice_review_policy: 0 `to_calibrate`, 54 атома;
  2. stale на 5+ атомах (0002–0006, бэкдейт 25 мес), level не понизился;
  3. TeamCapability: create 201, list, get, assess 201, status→assessed,
     history, unknown criteria key → 422, level 10 → 422;
  4. assessor ∈ participants → 403 (API) + ERROR (триггер);
  5. member view 200, stranger 403;
  6. cron: permit expired после `runPermitsExpire`.
- `scripts/ci-local.ps1` — `smoke: passport-v6` после v5.
- `.github/workflows/ci.yml` — «Smoke — паспорт v6».

### Решения (A47–A59 + N2/N3/N6/N7)

- **A47**: participants — JSONB array<UUID>; assessor_id ∉ participants —
  триггер `BEFORE INSERT/UPDATE OF participants, assessor_id`. CHECK с
  подзапросом в PG невозможен. FK на `participants(id)` для
  `assessor_id` — да; для JSONB — валидация в API.
- **A48**: создание — `FIRST_ARCHITECT | COUNCIL_MEMBER | OTC`;
  оценка — `FIRST_ARCHITECT | VERIFIER`. COUNCIL/OTC могут создать,
  но не оценить; VERIFIER — наоборот. Намеренно.
- **A49**: TeamCapability не в `getCandidates`. Отдельный роут
  `POST /passport/teams/match` — 3d/3e.
- **A50**: UI `/teams` (`TeamsListPage`) + `/teams/:id` (`TeamPage`),
  не в `Passport` — не индивидуальная проекция.
- **A51**: cron в `src/worker/index.ts` через `setInterval(1ч)`.
- **A52**: `derivePracticePolicy`: slow→P24M, medium→P12M, fast→P6M,
  very_fast→P3M. 4 пилота не трогаются (A15).
- **A53**: `AdminLayout` lazy — прямой import из
  `./pages/admin/AdminLayout` в `App.tsx`. Barrel не тронут.
- **A54/A55**: `passport_visibility.scope += 'team'`; проверка
  `viewer ∈ participants OR viewer = assessor` в `visibility.ts` (N6).
- **A56**: `criteriaScores` — `{[k]: number 0..9}`, ключи ⊆ criteria
  (валидация в `teams.ts`, 422 при нарушении).
- **A57**: payload `team_assessed` —
  `{team_id, assessment_id, level, assessor_id, criteria_scores}`.
- **A58**: бэкдейт в v6 — `UPDATE passport_assessments SET created_at
  = now() - interval '…'` (колонка `created_at`, не `assessed_at` —
  `staleAssessments` считается по `created_at`).
- **A59**: лаг cron до 1 часа приемлем — downstream проверяет
  `valid_until`, а не `status='active'`.
- **N2/N3**: `GET /passport/teams` (список) + разделение UI на
  `TeamsListPage` + `TeamPage`.
- **N7**: `listTeamsForViewer` фильтрует по participants | assessor |
  **created_by** (создатель видит свою команду — исправлено в v6).

### Не сделано (осознанно, 3d/3e/отдельный трек)

- Калибровка 0–9 (§6.5) — 3d.
- AI-рекомендации (§9.3, §16.6) — 3e (требует LLM-провайдера).
- Полный интерактивный граф (§8.4) — 3d.
- Педагогическая компетенция как атом — отдельный трек «каталог v0.4».
- Team matching (`POST /passport/teams/match`) — 3d/3e.
- `POST /passport/teams/:id` (update) — не критично для 3c; при
  необходимости через прямой UPDATE.

### Технический долг

- `team_capabilities.created_by` — единственная «владелец-ссылка».
  Отдельного `owner_id` нет. Если понадобится «передать команду» —
  добавить в 3d.
- `listTeamsForViewer` использует GIN-индекс на participants +
  sequential scan по `assessor_id OR created_by`. Для 1000+ команд
  может потребоваться composite-индекс — 3d.
- `TeamAssessmentPanel` рендерит UUID участников как есть (без
  resolution в external_id). Улучшение — 3d (батч `GET /participants?ids=`).
- `AdminLayout` lazy — теперь чанк `pages/admin/AdminLayout` грузится
  отдельно. Barrel `pages/admin/index.ts` остался, но импортируется
  только динамически. Warning `[INEFFECTIVE_DYNAMIC_IMPORT]` исчез.

### Тесты и CI

- `pnpm typecheck` / `pnpm typecheck:web` — зелёные.
- `pnpm exec vite build` — success. TeamsListPage (2.43 KB),
  TeamPage (6.69 KB) — lazy-чанки. `[INEFFECTIVE_DYNAMIC_IMPORT]` нет.
- `pnpm tsx scripts/test-passport.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v2.ts` — 16/16 PASS.
- `pnpm tsx scripts/test-passport-v3.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v4.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v5.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v6.ts` — **0 failed**.
- `pnpm tsx scripts/smoke-passport-teaching.ts` — зелёный.
- `pnpm tsx scripts/run-permits-expire.ts` — `{permitsExpired, participantPermitsExpired, durationMs}`.
- `bash scripts/smoke-passport.sh` — зелёный.
- CI: `smoke: passport-v6` в `ci-local.ps1` + «Smoke — паспорт v6»
  в `.github/workflows/ci.yml`.

### Как проверять (актуальные команды)

```bash
# Миграции
pnpm db:migrate

# Типы и сборка
pnpm typecheck
pnpm typecheck:web
pnpm exec vite build

# Тесты
pnpm tsx scripts/test-passport.ts    "+79001234567" "ChangeMe123456"
pnpm tsx scripts/test-passport-v2.ts
pnpm tsx scripts/test-passport-v3.ts
pnpm tsx scripts/test-passport-v4.ts
pnpm tsx scripts/test-passport-v5.ts
pnpm tsx scripts/test-passport-v6.ts
pnpm tsx scripts/smoke-passport-teaching.ts

# Cron (ручной прогон)
pnpm tsx scripts/run-permits-expire.ts

# Smoke
bash scripts/smoke-passport.sh