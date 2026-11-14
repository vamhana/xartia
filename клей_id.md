Склейка блоков ID (клей_id.md)
==================================================

|A.1.04.01|API|REST|TypeScript|src/api/cells/controller.ts|C.0.04.02, L.0.01.03, A.1.99.01, A.1.99.02, A.1.99.06|v.0.0.03|Draft|I.5|
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-26: GET /cells/:id/card — состав, общий план, дневной план ячейки.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-26: GET /cells/:id/card — состав, общий план, дневной план ячейки.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-26: GET /cells/:id/card — состав, общий план, дневной план ячейки.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-26: GET /cells/:id/card — состав, общий план, дневной план ячейки.
|2026-10-25: маршруты наряда ячейки — GET /cells/:id/daily-plan, GET /cells/:id/daily-plan/candidates, POST /cells/:id/daily-plan, POST /cells/:id/daily-plan/:task_id/assign.
|2026-10-25 (передача): GET /cells/:id/daily-plan/tree и POST /cells/:id/daily-plan/distribute — наряд верхней ячейки делится между дочерними.
|2026-10-26: GET /cells/:id/card — состав, общий план, дневной план ячейки.

|A.1.06.01|API|REST|TypeScript|src/api/plans/controller.ts|C.0.06.02, L.0.01.03, S.0.01.06, A.1.99.01, A.1.99.02, A.1.99.05, A.1.99.06|v.0.0.02|Draft|II.4|
|Описание: Контроллер Plans. **10 эндпоинтов** (6 plans + 4 daily-plans): список, карточка, создание, approve/activate/stop, list/current/upsert daily-plans, remove task из daily-plan. **Rate-limit (`api.write`) на 6 мутациях** (POST /plans, /approve, /activate, /stop, POST /daily-plans, DELETE /daily-plans/:id/tasks/:task_id). **`GET /plans*` и `GET /daily-plans*` — без `requireRight`** (reference data): `/daily-plans/current` используется F.4.02.03 `Tasks.tsx` у всех ролей; требование `plan:V` сломало бы список задач у `ASSOCIATED` (нет `plan:V`). Права: `plan:C` (create), `plan:A` (approve, activate, daily-upsert, daily-remove-task), `plan:E` (stop). `uuidIdParams`, `planTypeSchema`, `planStatusSchema` из L.0.01.03. 7 Zod-схем. |
|Публичный API:
- `GET /plans` — preHandler `[authMiddleware, validateQuery(listQuery)]`. Query: `{ type? (planType), status? (planStatus), lead_direction_id?, page=1, per_page=20 max 200 }`. `listPlans({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(lead_direction_id ? { leadDirectionId } : {}), page, perPage })`. → 200 `{ data, meta: { page, per_page, total }, audit_id }`.
- `GET /plans/:id` — preHandler `[authMiddleware, validateParams(uuidIdParams)]`. `getById(params.id)`. → 200 `{ ...plan, audit_id }`.
- `POST /plans` — preHandler `[authMiddleware, writeLimit, requireRight('plan','C'), validateBody(createBody)]`. Body: `{ type (planType), title (1..255), expected_result (1..), lead_direction_id, criteria?, checkpoints?: [{ at (ISO offset), description (1..) }], stop_conditions? }`. `createPlanService({ ... }, auth.participantId)`. → 201 `{ ...plan, audit_id }`. Crisis-валидация (`criteria.scenario`) — в сервисе.
- `POST /plans/:id/approve` — preHandler `[authMiddleware, writeLimit, requireRight('plan','A'), validateParams(uuidIdParams)]`. `approvePlanService(...)`. → 200 `{ ...plan, audit_id }`.
- `POST /plans/:id/activate` — preHandler `[authMiddleware, writeLimit, requireRight('plan','A'), validateParams(uuidIdParams)]`. `activatePlanService(...)`. → 200 `{ ...plan, audit_id }`.
- `POST /plans/:id/stop` — preHandler `[authMiddleware, writeLimit, requireRight('plan','E'), validateParams(uuidIdParams), validateBody(stopBody)]`. Body: `{ reason (1..500) }`. `stopPlanService(...)`. → 200 `{ ...plan, audit_id }`.
- `GET /daily-plans` — preHandler `[authMiddleware, validateQuery(dailyListQuery)]`. Query: `{ direction_id?, date? (/^\d{4}-\d{2}-\d{2}$/) }`. `listDailyPlans(direction_id, date)`. → 200 `{ data, audit_id }`.
- `GET /daily-plans/current` — preHandler `[authMiddleware, validateQuery(z.object({ direction_id: uuidSchema }))]`. `getDailyPlan(direction_id)`. → 200 `{ data, audit_id }`. **Без `requireRight`** (reference data для Tasks).
- `POST /daily-plans` — preHandler `[authMiddleware, writeLimit, requireRight('plan','A'), validateBody(dailyUpsertBody)]`. Body: `{ direction_id, date (/^\d{4}-\d{2}-\d{2}$/), task_ids: uuid[] (0..100) }`. `upsertDailyPlan({ directionId, date, taskIds, approvedById: auth.participantId })`. → 201 `{ ...plan, audit_id }`.
- `DELETE /daily-plans/:id/tasks/:task_id` — preHandler `[authMiddleware, writeLimit, requireRight('plan','A'), validateParams(dailyTaskParams)]`. `removeTaskFromDailyPlan(...)`. → 204.
- Zod-схемы (7): `listQuery`, `createBody`, `stopBody`, `dailyListQuery`, `dailyUpsertBody`, `dailyTaskParams = uuidIdParams.extend({ task_id: uuidSchema })`, inline `z.object({ direction_id: uuidSchema })` для `/daily-plans/current`. |
|↙ ПОТРЕБЛЯЕТ:
- C.0.06.02 plans/service — `listPlans`, `getById`, `createPlanService`, `approvePlanService`, `activatePlanService`, `stopPlanService`, `getDailyPlan`, `listDailyPlans`, `upsertDailyPlan`, `removeTaskFromDailyPlan`.
- L.0.01.03 validators — `uuidIdParams`, `uuidSchema`, **`planTypeSchema`**, **`planStatusSchema`**.
- **S.0.01.06 rate-limit** — `mustGetLimit('api.write')`.
- A.1.99.01 auth — `authMiddleware`, `getAuthContext`.
- A.1.99.02 rights — `requireRight`.
- **A.1.99.05 rate-limit** — `rateLimit`.
- A.1.99.06 validation — `validateBody`, `validateParams`, `validateQuery`.
- Внешние: fastify, zod. |
|↘ ПРЕДОСТАВЛЯЕТ:
- `registerPlansRoutes(app): Promise<void>` — регистрируется в A.1.00.01.
- `GET /plans`, `POST /plans`, `GET /plans/:id`, `POST /plans/:id/approve|activate|stop` — F.4.02.06 `Signals` (план как результат сигнала), F.4.02.24 Admin.
- `GET /daily-plans`, `GET /daily-plans/current`, `POST /daily-plans`, `DELETE /daily-plans/:id/tasks/:task_id` — F.4.02.99 `DailyPlan.tsx`, F.4.02.03 `Tasks.tsx`.
- Тесты I.9.04.08 (external_id), I.9.04.13/14 (OTC), I.9.04.22 (tasks). |
|Реализация:
- **`writeLimit = rateLimit({ config: mustGetLimit('api.write') })`** — модуль-константа, применяется на 6 мутациях.
- **`GET /plans`**: `listPlans({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(lead_direction_id ? { leadDirectionId } : {}), page, perPage })` → `{ data, meta, audit_id }`. **Без `requireRight`**.
- **`GET /plans/:id`**: `getById(params.id)` → `{ ...plan, audit_id }`.
- **`POST /plans`**: `createPlanService({ type, title, expectedResult: expected_result, leadDirectionId: lead_direction_id, ...(criteria ? { criteria } : {}), ...(checkpoints ? { checkpoints } : {}), ...(stop_conditions ? { stopConditions: stop_conditions } : {}) }, auth.participantId)` → 201.
- **`POST /plans/:id/approve|activate`**: `approvePlanService(...)` / `activatePlanService(...)` → 200.
- **`POST /plans/:id/stop`**: `stopPlanService(params.id, b.reason, auth.participantId)` → 200.
- **`GET /daily-plans`**: `listDailyPlans(q.direction_id, q.date)` → `{ data, audit_id }`. **Без `requireRight`**.
- **`GET /daily-plans/current`**: `getDailyPlan(q.direction_id)` → `{ data, audit_id }`. **Без `requireRight`** — используется F.4.02.03 у всех ролей.
- **`POST /daily-plans`**: `upsertDailyPlan({ directionId, date, taskIds: task_ids, approvedById: auth.participantId })` → 201. UPSERT (не пара create/update).
- **`DELETE /daily-plans/:id/tasks/:task_id`**: `removeTaskFromDailyPlan(...)` → 204.
- **Порядок регистрации роутов**: /plans → /plans/:id → /plans/:id/approve → /plans/:id/activate → /plans/:id/stop → /daily-plans → /daily-plans/current → POST /daily-plans → DELETE /daily-plans/:id/tasks/:task_id. |
|Примечания:
РЕАЛИЗОВАНО: **10 эндпоинтов**, 7 Zod-схем, `writeLimit` на 6 мутациях, `requireRight` на мутациях, `uuidIdParams`/`planTypeSchema`/`planStatusSchema` из L.0.01.03.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.01):
- **`uuidIdParams`** из L.0.01.03 (было локальная `idParams`).
- **`planTypeSchema` / `planStatusSchema`** из L.0.01.03 (было enum'ы inline).
- **`checkpoints[].description` — `z.string().min(1)`** (было без `min`).
- **`writeLimit` на 6 мутациях** (`api.write`).
- **`GET /plans*`, `GET /daily-plans*` — без `requireRight`** (reference data): `/daily-plans/current` используется F.4.02.03 `Tasks.tsx` у всех ролей; требование `plan:V` сломало бы список задач у `ASSOCIATED`.
ИЗМЕНЕНИЯ относительно предыдущей ревизии: подтверждено фактическим кодом.
СВЯЗЬ С C.0.06.02: 10 функций сервиса.
СВЯЗЬ С A.1.99.02: `requireRight('plan','C'|'A'|'E')` — на мутациях.
СВЯЗЬ С A.1.99.05: `rateLimit` middleware.
СВЯЗЬ С S.0.01.06: `mustGetLimit('api.write')`.
СВЯЗЬ С C.0.01.06: `plan:V` — у COUNCIL_MEMBER (`['V','C','E','A']`), KEEPER (`['V','S']`); `plan:A` — у COUNCIL_MEMBER; `plan:C` — у COUNCIL_MEMBER; `plan:E` — у COUNCIL_MEMBER. `ASSOCIATED` не имеет `plan:V` (только `participant:V`, `direction:V` и т.д.).
АРХИТЕКТУРНОЕ РЕШЕНИЕ: **`GET /plans*`, `GET /daily-plans*` — без `requireRight`** — reference data. Критично для `/daily-plans/current` (F.4.02.03).
ТЕХДОЛГ:
- **`PATCH /plans/:id`** — roadmap (нет `updatePlanService`).
- **`POST /plans/:id/sign`** (подпись Хранителя) — roadmap (нет `signPlan`).
- **`GET /plans/:id/tasks`** — roadmap (нет `listTasks`).
- **Активация без подписи** — разрыв с I.4.3. `activatePlanService` не требует подписи Хранителя.
- **Валидация диссидентского плана «до 2 лет»** (I.1.8.10) — вероятно, в сервисе (C.0.06.02), не в контроллере. Не подтверждено.
- **`POST /plans` — `criteria` и `stop_conditions` — `z.record(z.unknown())`** — без Zod-валидации полей (кроме crisis-валидации в сервисе).
- **`dailyTaskParams = uuidIdParams.extend({ task_id: uuidSchema })`** — `task_id` — UUID, хотя `taskIdSchema` в L.0.01.03 — regex (TASK-YYYY-MM-DD-NNN). Рассинхрон: `tasks` идентифицируются по UUID (`id`), а `externalId` — по regex. В контроллере выбран UUID.
- **`GET /plans` — нет `requireRight`** — список планов доступен всем аутентифицированным (reference data). UI фильтрует по правам.
- **`POST /daily-plans` — `task_ids: uuid[] (0..100)`** — лимит 100 задач на план; больше — 422.
- **`DELETE /daily-plans/:id/tasks/:task_id` — `plan:A`** — не `plan:E`. Согласовано с сервисом (`removeTaskFromDailyPlan`).
ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.08 test-external-id-sequence, I.9.04.13 test-otc, I.9.04.14 test-otc-two, I.9.04.22 test-tasks. |
|2026-10-24 (отклонения): GET /plans/deviations (only_behind, lead_direction_id), GET /plans/:id/deviation, POST /plans/:id/deviation/signal — балансировка поднимает сигнал направлению, повторный в течение 24 часов → 409.
|2026-10-24 (опережение): сигнал поднимается и когда план идёт быстрее графика (status ahead) — «проверьте, можно ли перенести опыт на отстающие участки». on_track → 409.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.
|2026-10-25 (дерево): GET /plans/:id/tree — вложенное дерево работ с агрегатами и исполнителями.
|2026-10-25 (надзор): GET /plans/oversight — дерево план → ветка → ячейка → человек со счётчиками, координаторами и сигналами.
|2026-10-26: GET /plans/:id/versions, POST версии, POST restore.

|A.1.07.01|API|REST|TypeScript|src/api/tasks/controller.ts|C.0.07.02, L.0.01.03, S.0.01.06, A.1.99.01, A.1.99.02, A.1.99.05, A.1.99.06|v.0.0.02|Draft|II.5|
|Описание: Контроллер Tasks. **9 эндпоинтов** (из 11 заявленных): список, мои, карточка, создание, assign, take, submit, accept, return. Отсутствуют `PATCH /tasks/:id`, `POST /tasks/:id/change-priority` (roadmap — нет сервисных функций `update`/`changePriority`). Права: `task:C` (create, assign), `otc:C` (accept, return). **`take`/`submit` — self-service** (только `authMiddleware`, проверка `assignedTo` в сервисе). **Rate-limit (`api.write`) на 6 мутациях** (create, assign, take, submit, accept, return). `uuidIdParams`, `taskStatusSchema`, `prioritySchema` из L.0.01.03. 5 Zod-схем. **`createBody.description` — max(5000)**, `required_competencies` — max(50). |
|Публичный API:
- `GET /tasks` — preHandler `[authMiddleware, validateQuery(listQuery)]`. Query: `{ direction_id?, status? (taskStatus), priority?, assigned_to?, plan_id?, page=1, per_page=20 max 200 }`. `listTasks({ ... })`. → 200 `{ data, meta: { page, per_page, total }, audit_id }`. **Без `requireRight`** (техдолг: нет access control).
- `GET /tasks/my` — preHandler `[authMiddleware]`. `listMyTasks(auth.participantId)`. → 200 `{ data, audit_id }`. **Без `requireRight`** (self-service).
- `GET /tasks/:id` — preHandler `[authMiddleware, validateParams(uuidIdParams)]`. `getById(params.id)`. → 200 `{ ...task, audit_id }`.
- `POST /tasks` — preHandler `[authMiddleware, writeLimit, requireRight('task','C'), validateBody(createBody)]`. Body: `{ direction_id, description (1..5000), priority (prioritySchema), plan_id?, required_competencies?: string[] (each 1..128, max 50), location?: { lat, lon } }`. `createTaskService({ ... }, auth.participantId)`. → 201 `{ ...task, audit_id }`. Deadline/externalId — в сервисе.
- `POST /tasks/:id/assign` — preHandler `[authMiddleware, writeLimit, requireRight('task','C'), validateParams(uuidIdParams), validateBody(assignBody)]`. Body: `{ participant_id }`. `assignTaskService(...)`. → 200 `{ ...task, audit_id }`.
- `POST /tasks/:id/take` — preHandler `[authMiddleware, writeLimit, validateParams(uuidIdParams)]`. **Self-service**. `takeTaskService(...)`. → 200 `{ ...task, audit_id }`. `assignedTo === participantId` проверяется в сервисе.
- `POST /tasks/:id/submit` — preHandler `[authMiddleware, writeLimit, validateParams(uuidIdParams)]`. **Self-service**. `submitTaskService(...)`. → 200 `{ ...task, audit_id }`. `assignedTo === requesterId` проверяется в сервисе (B1).
- `POST /tasks/:id/accept` — preHandler `[authMiddleware, writeLimit, requireRight('otc','C'), validateParams(uuidIdParams)]`. `acceptTaskService(...)`. → 200 `{ ...task, audit_id }`. I.2.12 (ОТК не принимает свою работу) — в сервисе (B2).
- `POST /tasks/:id/return` — preHandler `[authMiddleware, writeLimit, requireRight('otc','C'), validateParams(uuidIdParams), validateBody(returnBody)]`. Body: `{ reason (1..500) }`. `returnTaskService(...)`. → 200 `{ ...task, audit_id }`. I.2.12 — в сервисе (B3).
- Zod-схемы (5): `listQuery` (с `taskStatusSchema`, `prioritySchema`), `createBody` (`description` max 5000, `required_competencies` max 50), `assignBody`, `returnBody` (`reason` 1..500), `uuidIdParams` из L.0.01.03. |
|↙ ПОТРЕБЛЯЕТ:
- C.0.07.02 tasks/service — `listTasks`, `getById`, `listMyTasks`, `createTaskService`, `assignTaskService`, `takeTaskService`, `submitTaskService`, `acceptTaskService`, `returnTaskService`.
- L.0.01.03 validators — `uuidIdParams`, `uuidSchema`, `prioritySchema`, **`taskStatusSchema`**.
- **S.0.01.06 rate-limit** — `mustGetLimit('api.write')`.
- A.1.99.01 auth — `authMiddleware`, `getAuthContext`.
- A.1.99.02 rights — `requireRight` (для create/assign/accept/return).
- **A.1.99.05 rate-limit** — `rateLimit`.
- A.1.99.06 validation — `validateBody`, `validateParams`, `validateQuery`.
- Внешние: fastify, zod. |
|↘ ПРЕДОСТАВЛЯЕТ:
- `registerTasksRoutes(app): Promise<void>` — регистрируется в A.1.00.01.
- `GET /tasks`, `GET /tasks/my`, `GET /tasks/:id` — F.4.02.03 `Tasks.tsx`, F.4.02.04 `Report.tsx`, M.4.02.03.
- `POST /tasks`, `POST /tasks/:id/assign` — Совет/Архитектор.
- `POST /tasks/:id/take`, `/submit` — self-service исполнителя.
- `POST /tasks/:id/accept`, `/return` — очередь ОТК: F.4.02.08 `Otc`.
- Тесты: I.9.04.13, I.9.04.14, I.9.04.22, I.9.04.05, I.9.04.24. |
|Реализация:
- **`writeLimit = rateLimit({ config: mustGetLimit('api.write') })`** — модуль-константа, применяется на 6 мутациях.
- **`GET /tasks`**: `listTasks({ ...(q.direction_id ? { directionId } : {}), ...(q.status ? { status } : {}), ...(q.priority ? { priority } : {}), ...(q.assigned_to ? { assignedTo } : {}), ...(q.plan_id ? { planId } : {}), page, perPage })` → `{ data, meta, audit_id }`.
- **`GET /tasks/my`**: `listMyTasks(auth.participantId)` → `{ data, audit_id }`.
- **`GET /tasks/:id`**: `getById(params.id)` → `{ ...task, audit_id }`.
- **`POST /tasks`**: `createTaskService({ directionId: direction_id, description, priority, ...(plan_id ? { planId } : {}), ...(required_competencies ? { requiredCompetencies } : {}), ...(location ? { location } : {}) }, auth.participantId)` → 201.
- **`POST /tasks/:id/assign`**: `assignTaskService(params.id, b.participant_id, auth.participantId)` → 200.
- **`POST /tasks/:id/take`**: `takeTaskService(params.id, auth.participantId)` → 200. **Без `requireRight`**.
- **`POST /tasks/:id/submit`**: `submitTaskService(params.id, auth.participantId)` → 200. **Без `requireRight`**.
- **`POST /tasks/:id/accept`**: `acceptTaskService(params.id, auth.participantId)` → 200.
- **`POST /tasks/:id/return`**: `returnTaskService(params.id, b.reason, auth.participantId)` → 200.
- **Порядок preHandler**: `authMiddleware` → (опц. `writeLimit` для мутаций) → (опц. `requireRight`) → `validateParams`/`validateBody`. |
|Примечания:
РЕАЛИЗОВАНО: **9 эндпоинтов**, 5 Zod-схем, `writeLimit` на 6 мутациях, self-service на take/submit.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.01):
- **`uuidIdParams`** из L.0.01.03 (было локальная `idParams` — 7-й дубль).
- **`taskStatusSchema`** из L.0.01.03 (было enum inline).
- **`writeLimit` на 6 мутациях** (`api.write`).
- **`createBody.description: z.string().min(1).max(5000)`** — добавлен `max(5000)` (T4).
- **`required_competencies: z.array(z.string().min(1).max(128)).max(50)`** — добавлен `max(50)` (T5).
ИЗМЕНЕНИЯ относительно предыдущей ревизии: подтверждено фактическим кодом.
СВЯЗЬ С C.0.07.02: 9 функций сервиса.
СВЯЗЬ С A.1.99.02: `requireRight('task','C')` (create, assign), `requireRight('otc','C')` (accept, return). **`take`/`submit` — без `requireRight`** (self-service).
СВЯЗЬ С S.0.01.06: `mustGetLimit('api.write')`.
СВЯЗЬ С C.0.01.06: `task:C` — у COUNCIL_MEMBER (`['V','C','E','A']`), MASTER (`['V','C']`); `otc:C` — у OTC (`['V','C']`).
АРХИТЕКТУРНОЕ РЕШЕНИЕ: **`take`/`submit` — self-service** (без `requireRight`); проверка `assignedTo` — в сервисе.
АРХИТЕКТУРНОЕ РЕШЕНИЕ: **`accept`/`return` — `otc:C`** (право ОТК); I.2.12 (ОТК не принимает свою работу) — в сервисе.
ТЕХДОЛГ:
- **`PATCH /tasks/:id`** — roadmap (нет `updateTaskService`).
- **`POST /tasks/:id/change-priority`** — roadmap (нет `changePriority`).
- **`GET /tasks`, `GET /tasks/:id` — без `requireRight`** — любой авторизованный читает любую задачу. Нужна per-direction модель прав (scope).
- **`assignTask` — `checkCompetencies` не реализован** (нет `participant.competencies`); `required_competencies` сохраняется, но не сверяется при назначении.
- **`deadline?` и `parent_task_id?` в `createBody`** — отсутствуют. `deadline` вычисляется в сервисе по приоритету; `parent_task_id` не поддерживается.
- **`POST /tasks/:id/submit` — создание Report** — внутри сервиса (C.0.08.02), контроллер не импортирует.
- **`POST /tasks/:id/accept` — начисление +1 Поток** — через триггер `trg_flow_balance` (INSERT `flow_transactions` в сервисе).
ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.13 test-otc, I.9.04.14 test-otc-two, I.9.04.22 test-tasks, I.9.04.05 test-connections, I.9.04.24 test-verification. |
|2026-10-25: GET /tasks/overdue (список не сданных в ОТК) и POST /tasks/overdue/scan — сигналы направлениям по просрочкам с защитой 24 часа, уведомление балансировке.
|2026-10-25: GET /tasks/overdue (список не сданных в ОТК) и POST /tasks/overdue/scan — сигналы направлениям по просрочкам с защитой 24 часа, уведомление балансировке.

|C.0.01.03|CORE|Constants|TypeScript|src/core/constants.ts|C.0.01.04|v.0.0.1|Draft|-|
|Описание: **Глобальные константы системы.** Единственный источник истины: точность, лимиты, сроки, интервалы, типы. Изменение значений — только через процедуру пересмотра Хартии. **14 групп констант:** точность (`PRECISION`, `BASIS_POINTS`), уровни ячеек (`MAX_LEVELS`), Потоки (`CAPSULE_MAX`, `WELCOME_PACK`, ставки возврата, отложенный Поток, резервы), приоритетные дедлайны (`PRIORITY_DEADLINES_MS`), кванты, мобилизация, режимы (Steel Bell, ПТТ, красный контур, инфо-блокада), Шлюз, конвергенция, Хартия (сроки пересмотра), Семантический Страж, диссидентские проекты, JWT TTL, списки типов для итерации (`FLOW_TYPES`, `REGIME_TYPES`), HTTP-коды. |
|Публичный API:
- **Точность:** `PRECISION = 1e18`, `BASIS_POINTS = 10000`.
- **Уровни:** `MAX_LEVELS = 11`.
- **Потоки (I.1.6):** `CAPSULE_MAX = 180`, `WELCOME_PACK = 200`, `RETURN_RATE = 30`, `RETURN_RATE_GENTLE = 60`, `GENTLE_PERIOD_DAYS = 180`, `DEFERRED_FLOW_PCT = 7`, `FREEDOM_RESERVE_PCT = 2`, `PLANETARY_RESERVE_PCT = 3`.
- **Дедлайны (I.1.4.1):** `PRIORITY_DEADLINES_MS: Record<Priority, number>` — critical: 60_000, high: 3_600_000, standard: 10_800_000, background: 86_400_000.
- **Квант:** `QUANTUM_ACCELERATION = 10`.
- **Мобилизация (I.1.8.11):** `MOBILIZATION_REFUSAL_MAX_PCT = 10`.
- **Режимы (VI.1, VI.2):** `STEEL_BELL_MAX_DAYS = 90`, `PTT_MAX_DAYS = 90`, `PTT_MIN_INTERVAL_DAYS = 1825`, `RED_CIRCUIT_AUDIT_DAYS = 14`, `INFO_BLOCKADE_TIMEOUT_MIN = 60`, `INFO_BLOCKADE_SIGNAL_WINDOW_MIN = 180`.
- **Шлюз (I.1.10.8):** `GATEWAY_DISSOLVE_REFERENDUM_PCT = 60`, `GATEWAY_DISSOLVE_MAX_YEARS = 50`, `GATEWAY_IMPORT_DEPENDENCY_PCT = 5`, `GATEWAY_IMPORT_DEPENDENCY_YEARS = 3`.
- **Конвергенция (V.7):** `CONVERGENCE_MAX_MONTHS = 60`.
- **Хартия:** `CORE_REVISION_YEARS = 25`, `CHARTER_REVISION_YEARS = 5`, `HORIZON_RULE_YEARS = 50`.
- **Семантический Страж (I.4.6):** `SEMANTIC_ALARM_RESPONSE_HOURS = 3`, `SEMANTIC_VETO_DAYS = 3`.
- **Диссидентские проекты (I.1.8.10):** `DISSIDENT_PETITION_PCT = 1`, `DISSIDENT_REPORT_INTERVAL_DAYS = 60`, `DISSIDENT_REVIEW_YEARS = 2`.
- **JWT (I.1.4):** `JWT_ACCESS_TTL_SEC = 900` (15 мин), `JWT_REFRESH_TTL_SEC = 2_592_000` (30 дней).
- **Списки для итерации:** `FLOW_TYPES: readonly FlowType[]` (6), `REGIME_TYPES: readonly RegimeType[]` (6).
- **`HTTP`** — const-объект с 13 кодами (200/201/204/400/401/403/404/409/422/423/429/451/500/503). |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.04** (types) — `Priority`, `FlowType`, `RegimeType`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`WELCOME_PACK`** — C.0.02.02 (participants/service.ts — `grantWelcomePack`).
- **`PRIORITY_DEADLINES_MS`** — C.0.07.02 (tasks/service.ts — при создании задачи), C.0.07.04 (overdue), C.0.08.* (reports), C.0.09.02 (OTC).
- **`JWT_ACCESS_TTL_SEC` / `JWT_REFRESH_TTL_SEC`** — S.0.01.01 (security/jwt.ts) — срок жизни access/refresh.
- **`FLOW_TYPES` / `REGIME_TYPES`** — C.0.17.02 (regimes/service.ts), C.0.18.02 (balance/service.ts), C.0.99.* при валидации.
- **`MAX_LEVELS`** — C.0.04.01 (cells/entity — `getSize`), C.0.04.02 (cells/service).
- **`PTT_MIN_INTERVAL_DAYS` / `STEEL_BELL_MAX_DAYS` / `PTT_MAX_DAYS`** — C.0.17.02 (regimes/service.ts) — при активации режимов.
- **`INFO_BLOCKADE_TIMEOUT_MIN` / `INFO_BLOCKADE_SIGNAL_WINDOW_MIN`** — C.0.24.02 (gateway/service.ts) — при проверке выхода из изоляции.
- **`GATEWAY_*` / `CONVERGENCE_MAX_MONTHS` / `HORIZON_RULE_YEARS`** — C.0.24.02, C.0.28.02, C.0.35.02 (admin) — проверки при операциях.
- **`HTTP`** — все контроллеры для `reply.code(HTTP.OK)` / `HTTP.CREATED` и т.д. |
|Реализация:
- Все константы — `export const` верхнего уровня; `PRIORITY_DEADLINES_MS: Readonly<Record<Priority, number>>` — типизированная запись; `FLOW_TYPES`/`REGIME_TYPES` — `readonly` массивы для `for...of`.
- `HTTP` — `as const` для литеральных типов (`HTTP.OK` = `200`, не `number`). |
|Примечания:
РЕАЛИЗОВАНО: 14 групп констант + 2 списка + объект HTTP.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`HTTP`** — новый объект; раньше HTTP-коды писались числами в контроллерах. **`PRIORITY_DEADLINES_MS`** — вынесено в константы (было захардкожено в C.0.07.*).
СВЯЗЬ С S.0.01.01 (jwt): `JWT_ACCESS_TTL_SEC`/`JWT_REFRESH_TTL_SEC` — единый источник для `issueTokens`/`rotateRefresh`.
СВЯЗЬ С C.0.17.02 (regimes/service): `STEEL_BELL_MAX_DAYS`/`PTT_MAX_DAYS`/`PTT_MIN_INTERVAL_DAYS`/`RED_CIRCUIT_AUDIT_DAYS` — при активации режима.
СВЯЗЬ С C.0.24.02 (gateway/service): `INFO_BLOCKADE_*`/`GATEWAY_*` — при проверке выхода из изоляции и роспуска Шлюза.
СВЯЗЬ С C.0.02.02 (participants/service): `WELCOME_PACK = 200` — при `grantWelcomePack`.
СВЯЗЬ С C.0.35.02 (admin/service): `CORE_REVISION_YEARS`/`CHARTER_REVISION_YEARS`/`HORIZON_RULE_YEARS` — для проверок «можно ли менять Хартию».
ТЕХДОЛГ:
- **`PRECISION = 1e18`** — JS `number` не точно представляет 10^18 (max safe integer — 2^53 ≈ 9e15); при работе с большими числами — нужен `BigInt` или decimal-библиотека.
- **`PRIORITY_DEADLINES_MS`** — literal-числа; при изменении приоритетов (добавление `emergency`) — надо править здесь и в `Priority` в C.0.01.04.
- **`FLOW_TYPES` / `REGIME_TYPES`** — дублируют типы в C.0.01.04; при добавлении нового типа — править в двух местах.
- **`HTTP` — `as const`** — литеральные типы; если какой-то эндпоинт возвращает нестандартный код, придётся использовать число напрямую.
- **`MAX_LEVELS = 11`** — согласовано с `getSize` в C.0.04.01; если поменяется — править в двух местах.
- **Нет `SLA_HOURS`** — SLA для mentor_questions (4 часа) захардкожен в C.0.04.14 (`const SLA_HOURS = 4`), а не здесь. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.02 test-balance.ts (косвенно — WELCOME_PACK, RETURN_RATE); I.9.04.17 test-regimes.ts (STEEL_BELL_MAX_DAYS, PTT_*); I.9.04.46 test-gateway.ts (GATEWAY_*); I.9.04.18 test-rate-limit.ts (HTTP.TOO_MANY). |

|C.0.04.02|CORE|Cells|TypeScript|src/core/cells/service.ts|C.0.01.02, C.0.01.04, C.0.01.05, C.0.04.01, L.0.01.01, L.0.01.08, L.0.01.09|v.0.0.2|Draft|-|
|Описание: **Сервис ячеек.** Дерево N×5, состав, роли: чтение (list/getById/getMembers/getChildren/buildTree через WITH RECURSIVE), создание (`createCellService` с проверкой родителя: level+1 и то же направление), добавление/удаление участников (`addMemberService`/`removeMemberService` с проверкой размера, направления, «не в другой ячейке»). **Обновление `members_count` — триггер в БД** (D.4.01.07). **Кэш дерева** инвалидируется по цепочке предков через `WITH RECURSIVE` (B1, B4). **Техдолг v0.0.01 закрыт в v0.0.02:** B1 (инвалидация предков), B2 (направление участника = направление ячейки), B3 (родитель — то же направление), B4 (инвалидация при создании дочерней), B5 (buildTree через WITH RECURSIVE — 1 запрос вместо N+1), B6 (`rootsOnly` в listCells). |
|Публичный API:
- `interface CellFilter { directionId?; level?; parentCellId?; rootsOnly? }`.
- `listCells(filter): Promise<Cell[]>` — ORDER BY level DESC, number ASC; `rootsOnly` → только корни.
- `getById(cellId): Promise<Cell>` — `NotFoundError`.
- `getMembers(cellId): Promise<CellMember[]>` — только активные (`valid_to IS NULL`).
- `getChildren(cellId): Promise<Cell[]>` — прямые потомки, ORDER BY number.
- `buildTree(rootCellId): Promise<Cell[]>` — BFS, кэш `cell-tree:<rootId>` TTL 300s.
- `interface CreateCellRequest { level; number; profile?; parentCellId?; directionId }`.
- `createCellService(input, requesterId): Promise<Cell>` — валидация + INSERT + инвалидация + audit.
- `interface AddMemberRequest { participantId; roleInCell? }`.
- `addMemberService(cellId, input, requesterId): Promise<CellMember>` — проверки размера, направления, «не в другой ячейке», audit.
- `removeMemberService(cellId, participantId, requesterId): Promise<void>` — soft-delete (valid_to), UPDATE participants.cell_id, audit.
- `invalidateCache(cellId?): Promise<void>` — публичная обёртка над `invalidateTreeAncestors`. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.02** (errors) — `NotFoundError`, `ConflictError`, `ValidationError`.
- **C.0.01.04** (types) — `UUID`.
- **C.0.01.05** (audit) — `logAction`.
- **C.0.04.01** (cells/entity) — `createCell`, `getSize`, `Cell`, `CellRole`, `CellMember`.
- **L.0.01.01** (id) — `newUUID`.
- **L.0.01.08** (redis) — `redis.del`, `redis.set`, `redis.get`.
- **L.0.01.09** (db) — `query`, `queryOne`, `isUniqueViolation`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`getById` / `getMembers`** — A.1.04.01 (cells/controller.ts); C.0.04.12 (readiness.ts) — `getCellReadiness` использует оба.
- **`listCells` / `buildTree`** — A.1.04.01: GET /cells, GET /cells/tree/:rootId.
- **`createCellService`** — A.1.04.01: POST /cells.
- **`addMemberService` / `removeMemberService`** — A.1.04.01: POST/DELETE /cells/:id/members.
- **`getChildren`** — A.1.04.01; C.0.41.03 (cells/daily.ts — каскад по дереву).
- **`invalidateCache`** — A.1.04.01 (admin-инвалидация), C.0.26.02 (constructor/service.ts — при перестройке плана). |
|Реализация:
- **`invalidateTreeAncestors` (B1/B4)** — `WITH RECURSIVE ancestors` вверх по `parent_cell_id`, depth ≤ 12; удаляет `cell-tree:<id>` для всех предков и для самой ячейки.
- **`listCells`** — динамический WHERE (directionId/level/rootsOnly/parentCellId), ORDER BY level DESC, number ASC.
- **`getById`** — SELECT по id, `NotFoundError` если нет.
- **`getMembers`** — WHERE `cell_id=$1 AND valid_to IS NULL`, ORDER BY valid_from.
- **`getChildren`** — WHERE `parent_cell_id=$1`, ORDER BY number.
- **`buildTree` (B5)** — Redis cache → `WITH RECURSIVE tree` вниз по `parent_cell_id` → если пусто → `NotFoundError`; `redis.set('cell-tree:<id>', …, 'EX', 300)`.
- **`createCellService`** — `createCell` (entity) → если `parentCellId` — `getById` родителя, проверка `parent.level === input.level + 1` (B3-1) и `parent.directionId === input.directionId` (B3-2) → INSERT (try/catch на UNIQUE) → `invalidateTreeAncestors(parentCellId)` (B4) → `logAction('cells.create')`.
- **`addMemberService`** — `getById` + `getSize` → лимит → проверка «не в другой активной ячейке» → SELECT participant (`deleted_at IS NULL`) → **B2:** `participant.direction_id === cell.directionId` (иначе `ConflictError`) → INSERT cell_members → UPDATE participants.cell_id → `invalidateTreeAncestors(cellId)` (B1) → audit.
- **`removeMemberService`** — SELECT активного членства → UPDATE `valid_to=now()` (soft-delete) → UPDATE participants.cell_id=NULL → `invalidateTreeAncestors(cellId)` → audit. |
|Примечания:
РЕАЛИЗОВАНО: 10 функций, 3 интерфейса, 1 приватная функция (invalidateTreeAncestors).
СВЕРХ СТАРОЙ СПЕКИ (v0.0.01): **B1–B6** — все закрыты в v0.0.02.
СВЯЗЬ С C.0.04.01 (entity): `createCell`, `getSize` — валидация и размер.
СВЯЗЬ С D.4.01.07 (триггер БД): `members_count` обновляется триггером на INSERT/DELETE `cell_members`; сервис не пишет его вручную.
СВЯЗЬ С C.0.04.12 (readiness): `getCellReadiness` → `getById` + `getMembers` + `getSize` для `requiredMembers`.
СВЯЗЬ С C.0.04.13 (reassignment): при создании сигнала `cellId` валидируется через `queryOne` (не через `getById` — прямая проверка направления для экономии).
СВЯЗЬ С C.0.41.03 (cells/daily.ts): каскад по `getChildren` для ежедневного плана.
ТЕХДОЛГ:
- **`role_in_cell` не проверяется на совместимость** с сервисом/направлением (например, `otc` в ячейке своего направления — нельзя; проверка не сделана).
- **`updateCellService` / `deleteCellService`** — не реализованы (roadmap: PATCH/DELETE /cells/:id).
- **`removeMemberService`** — soft-delete без транзакции: если UPDATE `cell_members` прошёл, а UPDATE `participants` упал — рассинхрон. Нужна транзакция.
- **`addMemberService`** — INSERT + UPDATE `participants.cell_id` тоже без транзакции; при сбое второго — рассинхрон.
- **`buildTree`** — кэш `cell-tree:<rootId>` инвалидируется только через `invalidateTreeAncestors` при добавлении/удалении в поддереве; при прямом UPDATE в БД кэш устаревает на 5 минут.
- **`rootsOnly`** — несовместим с `parentCellId` (взаимоисключающие); если передать оба — `rootsOnly` побеждает, `parentCellId` игнорируется.
- **`listCells`** — не пагинируется; для больших деревьев — риск.
- **`getChildren`** — не кэшируется; при частых вызовах (C.0.41.03) — нагрузка.
- **`createCellService` race** — `UNIQUE` на `(level, number, direction_id)` (или похожее) — источник; после `ConflictError` клиент должен повторить с другим number.
- **`removeMemberService`** — не проверяет, что `cellId` и `participantId` соответствуют друг другу (SELECT по обоим — но если членства нет, 404 без указания, что не совпало). |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.03 test-cells.ts (прямо); I.9.04.67 test-capacity-cells.ts; I.9.04.68 test-reassignment.ts. |

|C.0.06.02|CORE|Plans|TypeScript|src/core/plans/service.ts|C.0.01.02, C.0.01.04, C.0.01.05, C.0.06.01, L.0.01.01, L.0.01.09, L.0.01.05, L.0.01.10|v.0.0.2|Draft|-|
|Описание: **Сервис планов + дневные планы + версии.** CRUD: `listPlans`/`getById`/`createPlanService`; lifecycle: `approvePlanService`/`activatePlanService`/`stopPlanService` — атомарные переходы через `UPDATE ... WHERE status=... RETURNING` (B5); при создании — ретрай по `external_id` до 5 попыток (B6: `now` внутри цикла, чтобы не «съехать» через полночь); при `type='crisis'` требуется `criteria.scenario` (B-фикс — спека обещала, кода не было). **Дневные планы** (`D.1.06.02`): `getDailyPlan`/`listDailyPlans` (B5: `ANY(uuid[])` — 1 запрос вместо N+1), `upsertDailyPlan` в транзакции (B1) с проверкой направления задач (B2), `removeTaskFromDailyPlan` с NotFound (B3). **Прогресс плана** (`getPlanProgress`) считает задачи по `tasks.plan_id` ∪ `plan_tasks`. **Версии плана**: `listPlanVersions`, `createPlanVersion` (патч + инкремент `version` + snapshot в транзакции), `restorePlanVersion` (восстановление как новая версия). При создании — 2 уведомления (куратору + автору сигнала) через `notifySafely` (сбой доставки не отменяет создание). |
|Публичный API:
- `interface PlanFilter { type?; status?; leadDirectionId?; signalId?; curatorId?; page?; perPage? }`.
- `listPlans(filter): Promise<{ data: Plan[]; total: number }>` — пагинация ≤200, ORDER BY created_at DESC.
- `getById(planId): Promise<Plan>` — NotFound.
- `interface CreatePlanRequest { type; title; expectedResult; leadDirectionId; signalId?; curatorId?; cellId?; criteria?; checkpoints?; stopConditions? }`.
- `createPlanService(input, requesterId): Promise<Plan>` — crisis-валидация, ретрай external_id (5 попыток), INSERT plans + INSERT plan_versions (ON CONFLICT DO NOTHING), audit, 2 уведомления.
- `approvePlanService(planId, requesterId): Promise<Plan>` — только `draft → approved`, atomic UPDATE + audit.
- `activatePlanService(planId, requesterId): Promise<Plan>` — только `approved → in_progress`, atomic + audit.
- `stopPlanService(planId, reason, requesterId): Promise<Plan>` — только `in_progress → cancelled`, atomic + audit (old/new status).
- `interface DailyPlanTask { id; dailyPlanId; taskId; position; createdAt }`.
- `interface DailyPlan { id; directionId; date; status; approvedBy; createdAt; tasks[] }`.
- `getDailyPlan(directionId, date?): Promise<DailyPlan | null>` — по `(directionId, date)`, JOIN tasks, ORDER BY position.
- `listDailyPlans(directionId?, date?): Promise<DailyPlan[]>` — LIMIT 100, 1 запрос на все задачи (B5).
- `upsertDailyPlan(input): Promise<DailyPlan>` — транзакция (B1), дедуп taskIds, валидация направления (B2), DELETE+INSERT задач.
- `removeTaskFromDailyPlan(planId, taskId, requesterId): Promise<void>` — NotFound если план/задача нет (B3).
- `interface PlanProgress { planId; total; done; inWork }`.
- `getPlanProgress(planId): Promise<PlanProgress>` — UNION `tasks.plan_id` + `plan_tasks`.
- `interface PlanVersion { version; snapshot; reason; createdAt }`.
- `listPlanVersions(planId): Promise<PlanVersion[]>` — ORDER BY version DESC.
- `createPlanVersion(planId, input, actorId): Promise<PlanVersion>` — транзакция (SELECT FOR UPDATE, UPDATE plan, INSERT version), audit.
- `restorePlanVersion(planId, version, reason, actorId): Promise<PlanVersion>` — восстановление как новая версия. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.02** (errors) — `NotFoundError`, `ConflictError`, `ValidationError`.
- **C.0.01.04** (types) — `UUID`, `PlanType`, `PlanStatus`, `Priority`, `TaskStatus`, `ISODateTime`.
- **C.0.01.05** (audit) — `logAction`.
- **C.0.06.01** (plans/entity) — `createPlan`, `approvePlan`, `activatePlan`, `formatPlanExternalId`, `Plan`, `PlanCheckpoint`.
- **L.0.01.01** (id) — `newUUID`.
- **L.0.01.05** (logger) — `logger.warn`.
- **L.0.01.09** (db) — `query`, `queryOne`, `isUniqueViolation`, `transaction`.
- **L.0.01.10** (notifications) — `send as sendNotification`.
- Внешние: динамический `import('../signals/service.js')` — `getById as getSignal` (для уведомления автору сигнала). |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`listPlans` / `getById`** — A.1.06.01 (plans/controller.ts); C.0.06.03 (deviation.ts — `getById`, `listPlans`); C.0.06.06 (oversight.ts — использует plan-строки из БД напрямую, но `PlanRow` совпадает).
- **`createPlanService` / `approvePlanService` / `activatePlanService` / `stopPlanService`** — A.1.06.01: POST /plans, POST /plans/:id/approve, /activate, /stop.
- **`getDailyPlan` / `listDailyPlans` / `upsertDailyPlan` / `removeTaskFromDailyPlan`** — A.1.06.01: GET /plans/daily, PUT /plans/daily, DELETE /plans/daily/:planId/tasks/:taskId; C.0.04.15 (cards.ts) — `getCellDailyPlan` через `getDailyPlan`.
- **`getPlanProgress`** — A.1.06.01: GET /plans/:id/progress.
- **`listPlanVersions` / `createPlanVersion` / `restorePlanVersion`** — A.1.06.01: GET /plans/:id/versions, POST /plans/:id/versions, POST /plans/:id/versions/:version/restore. |
|Реализация:
- **`listPlans`** — пагинация + 5 фильтров + COUNT + SELECT `PLAN_COLUMNS` ORDER BY created_at DESC.
- **`getById`** — SELECT по id, NotFound.
- **`createPlanService`** — crisis-валидация: `criteria.scenario` должен быть непустой строкой → ретрай (5 раз): `now` внутри цикла (B6), `MAX(SUBSTRING(external_id ...))` по `PLAN-<today>-%`, `nextSeq ≤ 999` → `formatPlanExternalId` → `createPlan` (entity) → INSERT plans (12 параметров + cell_id) → INSERT plan_versions (snapshot) → audit → notify куратору + notify автору сигнала (`getSignal` в try/catch) → return. При 23505 — `continue` (следующая попытка). После 5 попыток — `ConflictError`.
- **`approvePlanService`** — `getById` → `status === 'draft'` (B4) → `approvePlan` (entity, side-effect free) → atomic UPDATE `status='approved', approved_by, approved_at, updated_at WHERE id AND status='draft' RETURNING id` (B5) → 0 rows → `ConflictError('План уже изменён параллельным запросом')` → audit.
- **`activatePlanService`** — `status === 'approved'` (B4) → atomic UPDATE `WHERE status='approved'` → audit.
- **`stopPlanService`** — `status === 'in_progress'` → atomic UPDATE `status='cancelled' WHERE status='in_progress'` → audit (old/new status).
- **`getDailyPlan`** — SELECT по `(direction_id, date)` → null если нет → SELECT задач через `DAILY_TASK_SELECT` ORDER BY dpt.position, t.priority.
- **`listDailyPlans`** — динамический WHERE + LIMIT 100 → taskRows для всех planIds через `ANY(uuid[])` (B5) → Map по `daily_plan_id`.
- **`upsertDailyPlan`** — дедуп `taskIds` → валидация задач (все существуют, `direction_id === input.directionId`) (B2) → transaction: SELECT FOR UPDATE по `(direction_id, date)` → если есть UPDATE + DELETE tasks; иначе INSERT plan → INSERT tasks с position → `getDailyPlan` после транзакции → audit.
- **`removeTaskFromDailyPlan`** — SELECT plan (NotFound если нет) → DELETE RETURNING id (NotFound если 0) → audit (B3).
- **`getPlanProgress`** — `WITH plan_task_ids AS (tasks.plan_id UNION plan_tasks)` → COUNT + FILTER done/in_work.
- **`listPlanVersions`** — SELECT ORDER BY version DESC.
- **`insertPlanVersion`** (private) — SELECT version + `row_to_json(p)::jsonb` → INSERT plan_versions ON CONFLICT DO NOTHING.
- **`createPlanVersion`** — валидация reason ≥5 → transaction: SELECT FOR UPDATE version → UPDATE plans с COALESCE (все поля patch) + `version = version + 1` → `insertPlanVersion` → audit → `listPlanVersions` → return first.
- **`restorePlanVersion`** — SELECT snapshot → `createPlanVersion` с patch из snapshot (snake_case → camelCase: `expected_result` → `expectedResult`, `stop_conditions` → `stopConditions`). |
|Примечания:
РЕАЛИЗОВАНО: 14 функций, 5 интерфейсов, 1 приватная (`insertPlanVersion`), 1 приватная (`notifySafely`).
СВЕРХ СТАРОЙ СПЕКИ (v0.0.01): **B1–B6 + T5 + crisis-валидация + PlanVersion + DailyPlan upsert в транзакции**. Раньше `upsertDailyPlan` был UPDATE→DELETE→INSERT без транзакции (B1), не проверял `direction_id` задач (B2), `removeTaskFromDailyPlan` был молчаливый no-op (B3). `approve/activate` не проверяли статус (B4), не были атомарны (B5), `createPlanService` не ретраил через полночь (B6). `listDailyPlans` делал N+1 (T5).
СВЯЗЬ С C.0.06.01 (entity): `createPlan`, `approvePlan`, `activatePlan` — вся логика переходов в entity; сервис — оркестрация + БД + audit.
СВЯЗЬ С C.0.06.03 (deviation.ts): `listDeviations` использует `listPlans({status: 'in_progress'})` + `getById` для каждого.
СВЯЗЬ С C.0.04.15 (cards.ts): `getCellDailyPlan` (C.0.41.03) → `getDailyPlan` (C.0.06.02) — карточка ячейки содержит daily plan.
СВЯЗЬ С C.0.07.02 (tasks/service.ts): `tasks.plan_id` — источник для `getPlanProgress`; `tasks.direction_id` — проверка в `upsertDailyPlan`.
СВЯЗЬ С C.0.10.02 (signals/service.ts): динамический `getSignal` для уведомления автору сигнала при создании плана.
СВЯЗЬ С A.1.06.01 (plans/controller.ts): ~15 эндпоинтов (CRUD + lifecycle + daily + progress + versions).
ТЕХДОЛГ:
- **`createPlanService` ретрай 5 раз** — при 999 планах в день бросает `ConflictError`; но между `MAX` и `INSERT` race возможен — ловится `isUniqueViolation` → retry.
- **`cell_id` в `createPlanService`** — `input.cellId` передаётся, но в `CreatePlanRequest` нет поля `cellId` (есть только в SQL как `$12`). Нужно проверить, откуда берётся `input.cellId` — похоже, артефакт копипаста: в интерфейсе поля нет, но в SQL есть `$12 = input.cellId ?? null`. Если `input.cellId` undefined — `null`. Работает, но неявно.
- **`approvePlanService`** — `approvePlan(plan, requesterId)` (entity) вызывается **до** атомарного UPDATE; если параллельный запрос успел сменить статус — atomic UPDATE вернёт 0 и `ConflictError`, но `updated` объект уже собран. Не баг (используется для return), но лишний вызов.
- **`stopPlanService`** — не проверяет `reason` (может быть пустым); audit пишет как есть.
- **`upsertDailyPlan`** — `DELETE + INSERT` всех задач — при параллельном чтении карточки ячейки (C.0.04.15) возможен кратковременный «пустой» план.
- **`getPlanProgress`** — UNION двух источников (`tasks.plan_id` + `plan_tasks`) — если задача попала в оба, дедуплицируется UNION (не UNION ALL).
- **`createPlanVersion`** — `version = version + 1` — optimistic-lock только через `SELECT FOR UPDATE`; параллельные версии блокируются.
- **`insertPlanVersion`** — тип client — урезанный (только `query`), не полный pg.Client; работает, но TS-типизация хрупкая.
- **`restorePlanVersion`** — snapshot берётся как `Record<string, unknown>`, приведение к typed — вручную (snake_case → camelCase); если поля в snapshot изменятся — восстановление упадёт молча.
- **`notifySafely`** — глотает ошибки; при массовом сбое notifications — ничего не узнаем, только warn в логах.
- **`getSignal` динамический import** — потенциальный circular dependency (C.0.06.02 ↔ C.0.10.02); работает, но лучше вынести в отдельный notification-service. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.56 test-signal-plan.ts (прямо); I.9.04.57 test-plan-deviation.ts; I.9.04.70 test-plan-versions.ts; I.9.04.59 test-tree-naryad.ts. |

|C.0.06.03|CORE|Plans|TypeScript|src/core/plans/deviation.ts|C.0.01.04, C.0.06.02, L.0.01.09|v.0.0.1|Draft|-|
|Описание: **Отклонения плана.** Балансировка видит все индикаторы и именно она замечает, что один участок идёт быстрее другого, и поднимает сигнал направлению. `computeDeviation(planId)` считает: `total`/`done`/`overdue`/`expectedDone` (линейно от создания до последнего чекпоинта)/`diff` (done − expected)/`breached` (пройденные чекпоинты, к которым задачи не закрыты). Статус: `behind` (есть overdue или breached), `ahead` (diff > порог 20%), иначе `on_track`. `listDeviations` — по активным планам (`status='in_progress'`), сортировка «проблемные сверху». `hasRecentDeviationSignal` — защита от спама (есть ли свежий сигнал `[план:XXX]` за N часов). |
|Публичный API:
- `type DeviationStatus = 'behind' | 'on_track' | 'ahead'`.
- `interface BreachedCheckpoint { at; description; expectedDone; actualDone }`.
- `interface PlanDeviation { planId; externalId; title; planStatus; leadDirectionId; curatorId; total; done; overdue; expectedDone; diff; status; breached }`.
- `computeDeviation(planId): Promise<PlanDeviation>` — по плану.
- `interface DeviationFilter extends PlanFilter { onlyBehind? }`.
- `listDeviations(filter): Promise<{ data: PlanDeviation[]; total: number }>` — активные планы, только behind при `onlyBehind`, сортировка `overdue DESC, diff ASC`.
- `hasRecentDeviationSignal(planId, hours=24): Promise<string | null>` — id сигнала или null. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.04** (types) — `UUID`.
- **C.0.06.02** (plans/service) — `getById`, `listPlans`, `PlanFilter`.
- **L.0.01.09** (db) — `query`, `queryOne`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`computeDeviation` / `listDeviations`** — A.1.06.01 (plans/controller.ts): GET /plans/deviations, GET /plans/:id/deviation.
- **`hasRecentDeviationSignal`** — C.0.10.02 (signals/service.ts) или worker: защита от дублирования сигналов по одному плану.
- **`PlanDeviation`** — F.4.02.31 (PlanTree.tsx), F.4.02.06 (Signals.tsx) для подсветки проблемных планов. |
|Реализация:
- **`loadPlanTasks`** (private) — `WITH ids AS (tasks.plan_id UNION plan_tasks.task_id)` → SELECT id, status, deadline.
- **`computeDeviation`** — `getById` (NotFound) → `loadPlanTasks` → `total`/`done` (status='accepted')/`overdue` (deadline < now && status ≠ accepted) → временное окно `[created, lastCheckpoint]`, fallback 30 дней → `elapsed = min(max(now-created, 0), windowMs)` → `expectedDone = round(total * elapsed / windowMs)` → `diff = done - expectedDone` → `breached`: для каждого checkpoint `at ≤ now` — задачи с `deadline ≤ at`, сколько accepted; если `closed < due.length` — в breached → `threshold = max(1, round(total * 0.2))` → status: `behind` если overdue>0 || breached>0; `ahead` если `diff > 0 && diff >= threshold`; иначе `on_track`.
- **`listDeviations`** — `listPlans({...filter, status: 'in_progress', page: 1, perPage: 200})` → для каждого `computeDeviation` → фильтр `onlyBehind` → sort `overdue DESC, diff ASC`.
- **`hasRecentDeviationSignal`** — SELECT сигнала с `description LIKE '%[план:<planId>]%'`, `created_at > now - N hours`, `status NOT IN ('completed','rejected')`, ORDER BY created_at DESC LIMIT 1 → id или null. |
|Примечания:
РЕАЛИЗОВАНО: 3 функции (1 private), 3 интерфейса, 1 type.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`breached` / `expectedDone` / линейная интерполяция** — новая логика. Раньше отклонение считалось только по `done/total`, без учёта времени — «50% сделано» ничего не говорило без привязки к дедлайну.
СВЯЗЬ С C.0.06.02 (service): `listPlans({status:'in_progress'})`, `getById` — источник планов.
СВЯЗЬ С C.0.06.04 (branches): `computePlanBranches` — детализация отклонений на уровень ветки; `computeDeviation` — общий уровень плана.
СВЯЗЬ С C.0.06.06 (oversight): дерево надзора агрегирует `overdue`/`early` по-другому (по assigned_to), но идея та же.
СВЯЗЬ С C.0.10.02 (signals): `hasRecentDeviationSignal` — маркер `[план:<id>]` в описании сигнала.
ТЕХДОЛГ:
- **`expectedDone` линейная интерполяция** — предполагает равномерное распределение задач по времени; реальный план может иметь «горячие» фазы.
- **`windowMs = max(lastCheckpoint - created, 30d)`** — если чекпоинтов нет, окно 30 дней — не учитывает реальный срок плана (в `plans` нет `deadline`/`expiresAt`).
- **`breached`** — `due` по `deadline ≤ checkpoint.at`; если задача без deadline — не попадает в due (не проверяется вообще).
- **`threshold = max(1, round(total * 0.2))`** — 20% эвристика; для планов из 2 задач threshold=1 → «1 задача досрочно = ahead».
- **`listDeviations`** — `perPage: 200`, нет пагинации по отклонениям; при >200 активных планов — обрезается.
- **`listDeviations`** — `computeDeviation` для каждого плана — N+1 запросов (по 1 SELECT на план).
- **`hasRecentDeviationSignal`** — `description LIKE '%[план:XXX]%'` — substring-поиск, при большом объёме сигналов медленно; нужен GIN-индекс.
- **`planStatus`** — в `PlanDeviation` возвращается как `string`, не `PlanStatus` — потеря типизации.
- **`curatorId`** — может быть null (не у всех планов есть куратор), в интерфейсе `UUID | null` — ок, но downstream должен обрабатывать. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.57 test-plan-deviation.ts (прямо); I.9.04.56 test-signal-plan.ts (косвенно). |

|C.0.06.04|CORE|Plans|TypeScript|src/core/plans/branches.ts|C.0.01.04, L.0.01.09|v.0.0.1|Draft|-|
|Описание: **Ветки плана (параллельные участки).** «Строим 20 одинаковых домов»: у плана есть корневые задачи-ветки (дом №1, дом №2, …), у каждой — свои подзадачи. Общий счётчик «принято 40 из 200» не показывает, что дом №3 уже на крыше, а дом №11 стоит на фундаменте. Балансировка должна видеть именно ветки. `computePlanBranches(planId)` — прогресс по корневым задачам с потомками; `listPlanBranches(directionId?)` — по всем активным планам направления (LIMIT 100); `countBehindBranches(planId)` — быстрая сводка. |
|Публичный API:
- `interface BranchProgress { taskId; externalId; title; total; done; overdue; status }`.
- `interface PlanBranches { planId; branches: BranchProgress[]; behindCount }`.
- `computePlanBranches(planId): Promise<PlanBranches>` — GROUP BY root, агрегация по child.
- `listPlanBranches(directionId?): Promise<Array<PlanBranches & { planExternalId; planTitle }>>` — активные планы с ветками, LIMIT 100.
- `countBehindBranches(planId): Promise<number>` — количество веток с overdue > 0. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.04** (types) — `UUID`.
- **L.0.01.09** (db) — `query`, `queryOne`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`computePlanBranches`** — A.1.06.01 (plans/controller.ts): GET /plans/:id/branches.
- **`listPlanBranches`** — A.1.06.01: GET /plans/branches?directionId=.
- **`countBehindBranches`** — C.0.06.03 (deviation.ts) при вычислении «отстаёт ли план по веткам»; A.1.06.01 для сводки.
- **`BranchProgress`** — F.4.02.31 (PlanTree.tsx), F.4.02.32 (Naryad.tsx). |
|Реализация:
- **`computePlanBranches`** — `SELECT root, COUNT(child) AS total, COUNT FILTER accepted AS done, COUNT FILTER (deadline < now && status ≠ accepted) AS overdue FROM tasks root JOIN tasks child ON child.parent_task_id = root.id WHERE root.plan_id = $1 GROUP BY root ORDER BY root.external_id`. Для каждой группы: `status = 'behind'` если overdue>0, `'ahead'` если share ≥ 0.999, иначе `'on_track'`. `behindCount` — count of behind.
- **`listPlanBranches`** — SELECT активных планов (`status='in_progress'`) с EXISTS веток, LIMIT 100 → для каждого `computePlanBranches` → фильтр пустых → результат с planExternalId/planTitle.
- **`countBehindBranches`** — subquery с HAVING `overdue > 0`, COUNT. |
|Примечания:
РЕАЛИЗОВАНО: 3 функции, 2 интерфейса.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`listPlanBranches` / `countBehindBranches`** — новые функции. Раньше был только `computePlanBranches`; `listPlanBranches` — для панели балансировки (`GET /plans/branches?directionId=`); `countBehindBranches` — для быстрой сводки без полной сборки объекта.
СВЯЗЬ С C.0.06.03 (deviation.ts): `computeDeviation` — по всему плану; `computePlanBranches` — детализация по веткам; обе функции вызываются на `GET /plans/deviations` (первая) и `GET /plans/branches` (вторая).
СВЯЗЬ С C.0.06.05 (tree.ts): дерево работ — иерархия задач; ветки — плоский срез по корням с агрегатом.
СВЯЗЬ С C.0.07.02 (tasks/service.ts): `tasks.parent_task_id` — источник веток; корень ветки = задача без родителя.
ТЕХДОЛГ:
- **`branches[].status`** — только `behind`/`on_track`/`ahead`; `overdue` — счётчик, не статус.
- **`share >= 0.999`** — «почти всё сделано» → ahead; для больших веток (1000 подзадач) 999/1000 = 0.999 → ahead, хотя 1 не сделана.
- **`listPlanBranches`** — `LIMIT 100` без пагинации; для направлений с >100 активных планов — обрезается.
- **`listPlanBranches`** — N+1: для каждого плана `computePlanBranches` (по 1 SELECT на план).
- **`countBehindBranches`** — не учитывает статус плана (in_progress); для draft/cancelled вернёт то же, что и для in_progress.
- **`overdue`** — `child.deadline < now()` (строгое `<`); задача с deadline = now() не попадает.
- **`done`** — только `status='accepted'`, не `completed`/`submitted`; семантика согласована с C.0.06.03. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.59 test-tree-naryad.ts (прямо — дерево + наряд); I.9.04.57 test-plan-deviation.ts (косвенно). |

|C.0.06.05|CORE|Plans|TypeScript|src/core/plans/tree.ts|C.0.01.04, L.0.01.09|v.0.0.1|Draft|-|
|Описание: **Дерево работ плана.** «Микрорайон» — не список домов, а дерево: дом → этаж → работы, в каждой ветке свои люди. Плоский список этого не показывает; `getPlanTree(planId)` отдаёт дерево: корни (parent_task_id IS NULL) + все потомки через `WITH RECURSIVE` (глубина ≤10), с участниками (assignedTo), флагом assignedTo.name/externalId. Агрегаты `total`/`done` считаются снизу вверх (post-order): задача считается, если accepted; всего = 1 + дети. |
|Публичный API:
- `interface WorkTreeNode { id; externalId; description; status; priority; deadline; assignedTo; total; done; children }`.
- `interface PlanTree { planId; roots: WorkTreeNode[]; total; done }`.
- `getPlanTree(planId): Promise<PlanTree>` — `WITH RECURSIVE` с depth ≤10, JOIN participants для assignedTo, построение дерева, агрегация снизу вверх. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.04** (types) — `UUID`.
- **L.0.01.09** (db) — `query`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`getPlanTree`** — A.1.06.01 (plans/controller.ts): GET /plans/:id/tree.
- **`WorkTreeNode` / `PlanTree`** — F.4.02.31 (PlanTree.tsx), F.4.02.32 (Naryad.tsx). |
|Реализация:
- **`getPlanTree`** — `WITH RECURSIVE tree AS (SELECT tasks.*, 0 AS depth WHERE plan_id=$1 AND parent_task_id IS NULL UNION ALL SELECT c.*, depth+1 FROM tasks c JOIN tree ON c.parent_task_id = tree.id WHERE tree.depth < 10)` → SELECT tree.*, `p.name AS assigned_name, p.external_id AS assigned_external_id` LEFT JOIN participants → построение `byId: Map<string, WorkTreeNode>`, `parentOf: Map<string, string | null>` → для каждого: если parent в byId — push в parent.children; иначе — в roots → post-order `aggregate(node)`: `total=1+Σ child.total`, `done = (status==='accepted' ? 1 : 0) + Σ child.done` → totals по roots. |
|Примечания:
РЕАЛИЗОВАНО: 1 функция, 2 интерфейса.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`assignedTo`** — объект `{id, name, externalId}` (было: только id). Причина: UI показывает имя исполнителя прямо в узле дерева.
СВЯЗЬ С C.0.06.04 (branches): ветки — это плоский срез `total/done/overdue` по корням; tree — полная иерархия до листьев.
СВЯЗЬ С C.0.07.02 (tasks/service.ts): `tasks.parent_task_id` — источник; depth ≤10 — защита от глубокой рекурсии.
СВЯЗЬ С C.0.06.06 (oversight): oversight-дерево добавляет уровни `cell`/`person` поверх `branch`, tree — только задачи.
ТЕХДОЛГ:
- **`depth < 10`** — задачи глубже 10 уровней не попадут в дерево (молча); при реальной потребности — увеличить, но риск performance.
- **`parent_task_id`** — если ссылается на задачу другого плана (некорректно, но возможно) — она не попадёт в дерево (корень — только с `plan_id = $1`).
- **`aggregate` post-order** — для больших деревьев (1000+ узлов) рекурсия может переполнить стек; в Node по умолчанию ~10k — ок, но на грани.
- **`byId` / `parentOf`** — дублируют данные (две Map); можно обойтись одной.
- **`assignedTo.externalId`** — если в БД NULL (участник без externalId, что маловероятно), возвращается `''` — UI может показать пустоту.
- **`roots`** — если plan_id плана пуст (нет задач) → пустые roots + total=0; `NotFoundError` не бросается (это валидно: пустой план).
- **`status` / `priority`** — возвращаются как `string`, не enum (потеря типизации). |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.59 test-tree-naryad.ts (прямо). |

|C.0.06.06|CORE|Plans|TypeScript|src/core/plans/oversight.ts|C.0.01.04, L.0.01.09|v.0.0.1|Draft|-|
|Описание: **Дерево надзора для балансировки.** Балансировка видит не «плоский список отстающих планов», а дерево: **микрорайон (план) → дом (ветка) → ячейка → человек**. На каждом уровне: total/done/overdue/early, coordinator, signals. Совет направления смотрит то же дерево, поэтому может связаться с координатором ячейки или напрямую с исполнителем. `getOversightTree(directionId?)` — активные планы направления (LIMIT 50), с рекурсивной загрузкой задач и группировкой по исполнителям → ячейкам → веткам. `getSignalCountForPlan(planId)` — быстрый счётчик сигналов по плану. |
|Публичный API:
- `type OversightKind = 'plan' | 'branch' | 'cell' | 'person'`.
- `interface OversightSignal { id; externalId; status; description; createdAt }`.
- `interface OversightNode { kind; id; title; subtitle; coordinator; directionId; planId; total; done; overdue; early; people; signals; children }`.
- `getOversightTree(directionId?): Promise<OversightNode[]>` — деревья по активным планам, вложенность plan → branch → cell → person.
- `getSignalCountForPlan(planId): Promise<number>`. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.04** (types) — `UUID`.
- **L.0.01.09** (db) — `query`, `queryOne`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`getOversightTree`** — A.1.06.01 (plans/controller.ts): GET /plans/oversight?directionId=; F.4.02.31 (PlanTree.tsx), F.4.02.35 (CellsMap.tsx).
- **`getSignalCountForPlan`** — C.0.06.03 (deviation.ts) или C.0.10.02 (signals/service.ts) для быстрой сводки сигналов по плану.
- **`OversightNode` / `OversightSignal`** — F.4.02.31 (PlanTree.tsx) — рекурсивный рендер. |
|Реализация:
- **`loadPlanTasks`** — `WITH RECURSIVE tree AS (...)` глубиной ≤10, JOIN participants для `assigned_name`.
- **`loadCellsForParticipants(ids)`** — SELECT `cm.participant_id, cm.cell_id, c.number, c.level, cm.role_in_cell, coordinator_name` через LEFT JOIN-подзапрос (координатор ячейки) WHERE `cm.valid_to IS NULL OR > now()`.
- **`loadSignals(planId, taskIds, cellIds)`** — SELECT сигналов WHERE `status NOT IN ('completed','rejected')` AND (`subject_plan_id = $1` OR `subject_task_id = ANY($2)` OR `subject_cell_id = ANY($3)` OR `description LIKE '%[план:$1]%'`), LIMIT 200.
- **`getOversightTree(directionId?)`** — SELECT активных планов (`status='in_progress'`) с JOIN participants (curator) + directions (number), LIMIT 50 → для каждого: `loadPlanTasks` → `byId` + `parentOf` + `rootOf` (12 итераций) → assigneeIds → `loadCellsForParticipants` → cellIds → `loadSignals` → `signalsFor(pred)` → `stat(tasks)` → группировка по корням (`roots`) → по ячейкам (`byCell`) → по людям (`byPerson`) → сборка `OversightNode` для plan/branch/cell/person. Unassigned задачи (без assigned_to) собираются в ветку «Без ячейки».
- **`getSignalCountForPlan`** — COUNT сигналов по `subject_plan_id` с `status NOT IN ('completed','rejected')`. |
|Примечания:
РЕАЛИЗОВАНО: 5 функций (3 private), 3 интерфейса, 1 type.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`getOversightTree` / `getSignalCountForPlan` / вся иерархия plan→branch→cell→person** — новая логика. Раньше был плоский список планов с отклонениями; теперь — дерево надзора, чтобы балансировка видела координатора ячейки и конкретного исполнителя.
СВЯЗЬ С C.0.06.03 (deviation.ts): `computeDeviation` — плоский список отклонений; oversight — дерево для UI; обе дополняют друг друга.
СВЯЗЬ С C.0.06.04 (branches.ts): branch-уровень в oversight — тот же `root` (без child-задач), но с агрегатом по subtree.
СВЯЗЬ С C.0.06.05 (tree.ts): `getPlanTree` — иерархия задач; oversight — иерархия supervision с ячейками/людьми.
СВЯЗЬ С C.0.04.02 (cells/service): `cell_members.role_in_cell` — координатор ячейки; `cells.number`/`level` — заголовок узла.
СВЯЗЬ С C.0.10.02 (signals/service): `signals.subject_plan_id`/`subject_task_id`/`subject_cell_id` — привязка сигналов к узлам дерева.
ТЕХДОЛГ:
- **Производительность** — для плана с 100 задачами: 1 SELECT планов + 1 SELECT задач + 1 SELECT ячеек + 1 SELECT сигналов + N группировок. Для 50 планов — 200+ SELECT. Нужна пагинация или batch по `plans.id`.
- **`loadSignals`** — `description LIKE '%[план:$1]%'` — substring-поиск, медленно; `ANY(uuid[])` для task/cell — быстро, но OR-цепочка может не оптимально плана.
- **`rootOf`** — 12 итераций хардкод (глубина ≤10 + запас); при глубине >12 задача ошибочно попадёт в «свой» корень.
- **`unassigned`** — задачи без исполнителя идут в узел «Без ячейки» с `id = "unassigned-<root.id>"` (псевдо-UUID); downstream должен знать, что это не настоящий cellId.
- **`OversightNode.id`** — `UUID` типа, но для `unassigned-*` это строка; type-safety нарушена.
- **`early`** — `t.updated_at <= t.deadline`; если задача обновлена после accepted (комментарий), `updated_at > deadline` — early не засчитается.
- **`people`** — count distinct `assigned_to` на уровне; для person-узла = 1, для cell/plan — разные.
- **`loadCellsForParticipants`** — подзапрос для `coordinator_name` на каждую строку — N+1 по ячейкам; можно агрегировать в 1 запрос через LEFT JOIN.
- **`stat(list)`** — считает `overdue` как `deadline < now && !accepted`; для branch-уровня — по всем задачам subtree; для plan — по всем.
- **`signalsFor`** — для person-узла `s.subject_task_id === personTasks[0]?.id` — только по первой задаче человека; остальные задачи не учитываются.
- **`planStatus`** — в SQL-фильтре `status='in_progress'`; планы в `draft`/`approved`/`cancelled` не попадают в дерево.
- **`direction_number`** — nullable; в subtitle `Направление №—` если null (не сломается, но визуально шумно). |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.59 test-tree-naryad.ts (косвенно); I.9.04.57 test-plan-deviation.ts (косвенно). |

|C.0.07.01|CORE|Tasks|TypeScript|src/core/tasks/entity.ts|C.0.01.02, C.0.01.03, C.0.01.04|v.0.0.1|Draft|-|
|Описание: **Доменная сущность Задача.** Чистые функции без БД: создание с автоматическим дедлайном из `PRIORITY_DEADLINES_MS` (critical=1мин, high=1час, standard=3часа, background=1сутки), переходы статусов (created→assigned→in_progress→submitted→accepted/returned), `isOverdue`, `formatTaskExternalId` (`ТИП-YYYY-MM-DD-NNN`, тип — 3 заглавные кириллицы, номер 0..999). **Направленный граф переходов** (6 статусов): `created` → только `assigned`; `assigned` → `in_progress` или обратно `created`; `in_progress` → `submitted`; `submitted` → `accepted`/`returned`; `returned` → `in_progress`; `accepted` — терминальный. `parentTaskId` — nullable для иерархии (ветки плана, дерево работ). `requiredCompetencies` — список требований (не FK). `location` — `{lat, lon}` nullable (GeoJSON в БД). |
|Публичный API:
- `interface Task` — 16 полей: id, externalId, planId, directionId, description, requiredCompetencies, location, priority, status, assignedTo, assignedBy, deadline, parentTaskId, createdAt, updatedAt.
- `interface CreateTaskInput` — id, externalId, planId?, directionId, description, priority, requiredCompetencies?, location?, baseTime?.
- `canTransition(from: TaskStatus, to: TaskStatus): boolean` — по `ALLOWED_TRANSITIONS`.
- `getDeadlineForPriority(priority, baseTime?): ISODateTime` — `baseTime + PRIORITY_DEADLINES_MS[priority]`.
- `createTask(input): Task` — валидация description, `deadline` через `getDeadlineForPriority`, `status='created'`, `assignedTo/assignedBy/parentTaskId=null`.
- `assignTask(t, participantId): Task` — `ConflictError` если `!canTransition(t.status, 'assigned')`.
- `takeTask(t, participantId): Task` — `ConflictError` если `t.assignedTo !== participantId` или `!canTransition(_, 'in_progress')`.
- `submitTask(t): Task` — `ConflictError` если нельзя.
- `acceptTask(t): Task` — `ConflictError` если нельзя.
- `returnTask(t, reason): Task` — `ConflictError` если нельзя; `reason` **игнорируется** (пишется в audit/BД вне entity).
- `isOverdue(t, now?): boolean` — `deadline < now && status ∉ {accepted, returned}`.
- `formatTaskExternalId(type, date, sequence): string` — regex `^[А-Я]{3}$`, `0 ≤ sequence ≤ 999`. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.02** (errors) — `ValidationError`, `ConflictError`.
- **C.0.01.03** (constants) — `PRIORITY_DEADLINES_MS`.
- **C.0.01.04** (types) — `UUID`, `ISODateTime`, `Priority`, `TaskStatus`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`Task`** — C.0.07.02 (tasks/service.ts): тип возврата `getById`/`listTasks`/`listMyTasks`/`createTaskService` и все transitions; C.0.02.03 (onboarding): `Task` в `createWelcomeTask`; C.0.06.02 (plans/service): через `getPlanTree` в `WorkTreeNode` (косвенно, через C.0.06.05).
- **`CreateTaskInput`** — C.0.07.02 (`createTaskService`).
- **`createTask`** — C.0.07.02 (`createTaskService` — сборка entity перед INSERT).
- **`assignTask`/`takeTask`/`submitTask`/`acceptTask`/`returnTask`** — C.0.07.02: entity-validate перед atomic UPDATE.
- **`canTransition`** — C.0.07.02 (для pre-check в `acceptTaskService`/`returnTaskService`); A.1.07.01 (tasks/controller.ts) — для UI-валидации переходов.
- **`getDeadlineForPriority`** — C.0.07.02 (экспорт для совместимости), A.1.07.01 (при создании задачи).
- **`isOverdue`** — C.0.07.04 (overdue), C.0.06.03 (deviation), C.0.06.04 (branches), C.0.06.06 (oversight).
- **`formatTaskExternalId`** — C.0.07.02 (`createTaskService` при генерации externalId). |
|Реализация:
- **`ALLOWED_TRANSITIONS`** — `Record<TaskStatus, readonly TaskStatus[]>`; `created: ['assigned']`, `assigned: ['in_progress', 'created']` (можно вернуть в created), `in_progress: ['submitted']`, `submitted: ['accepted', 'returned']`, `returned: ['in_progress']` (можно переоткрыть), `accepted: []` (терминальный).
- **`createTask`** — валидация `description.trim()`; `now = new Date()`; `deadline = getDeadlineForPriority(priority, baseTime ?? now)`; `status='created'`, `assignedTo/assignedBy/parentTaskId=null`.
- **Мутации** — каждая возвращает `{...t, status: newStatus, updatedAt: new Date().toISOString()}`.
- **`isOverdue`** — `if (!t.deadline) return false; if (t.status === 'accepted' || t.status === 'returned') return false; return new Date(t.deadline).getTime() < now.getTime()`. `returned` — не считается просроченной (была сдана, но возвращена — это не вина исполнителя).
- **`formatTaskExternalId`** — regex `^[А-Я]{3}$` (3 заглавные кириллицы), sequence 0..999, format `${type}-${YYYY-MM-DD}-${NNN}`. |
|Примечания:
РЕАЛИЗОВАНО: 2 интерфейса, 10 функций.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`isOverdue` исключает `returned`** — новая логика; раньше возвращённая задача могла «просрочиваться» по дедлайну, хотя она была сдана в ОТК. **`formatTaskExternalId` regex** — жёсткая валидация типа (3 заглавные кириллицы).
СВЯЗЬ С C.0.01.03 (constants): `PRIORITY_DEADLINES_MS` — источник дедлайнов по приоритету.
СВЯЗЬ С C.0.07.02 (service): 6 функций-transitions используются в сервисе (entity-validate → atomic UPDATE).
СВЯЗЬ С C.0.07.04 (overdue): `isOverdue` — критерий для `listUnsubmittedTasks` (плюс фильтр по статусу).
СВЯЗЬ С C.0.06.05 (tree): `parentTaskId` — источник иерархии для `WorkTreeNode`.
ТЕХДОЛГ:
- **`returnTask(t, reason)`** — `reason` игнорируется в entity; пишется в `otc_decisions.comment` + audit_log — вне entity. Семантически «return с причиной» — на уровне сервиса.
- **`ALLOWED_TRANSITIONS.assigned` включает `created`** — можно «разназначить» задачу; но `assignTask` требует `from='created'` → после `assigned → created` задача снова доступна для назначения. Это осознанно (переназначение через возврат в created), но не задокументировано.
- **`parentTaskId`** — всегда `null` в `createTask`; иерархия строится через отдельные вызовы (в C.0.07.02 нет метода для установки `parentTaskId` — только через `CREATE TABLE`/триггеры или updatePlanVersion).
- **`formatTaskExternalId`** — только кириллица (А-Я); для латинских префиксов (например, `TASK`) — не пройдёт; в коде используется `'ЗДЧ'`.
- **`getDeadlineForPriority`** — `baseTime ?? now` — для тестов можно передать `baseTime`; в проде — `now`.
- **`requiredCompetencies: []`** — по умолчанию пустой массив (не `null`); семантика «без требований» vs «требования не указаны» — не различается. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.22 test-tasks.ts (прямо); I.9.04.59 test-tree-naryad.ts (косвенно — parentTaskId). |

|C.0.07.02|CORE|Tasks|TypeScript|src/core/tasks/service.ts|C.0.01.02, C.0.01.03, C.0.01.04, C.0.01.05, C.0.07.01, C.0.08.02, S.0.01.03, L.0.01.01, L.0.01.05, L.0.01.09, L.0.01.10, W.2.02.01|v.0.0.2|Draft|-|
|Описание: **Сервис задач.** Создание, назначение, сдача, приёмка, возврат, пересмотр. **Direction scope** (`assertDirectionScope`): действие с задачей — только в своём направлении (Архитектор — исключение). **Приёмка (`acceptTaskService`) — единый путь P0:** отчёт с артефактом обязателен (P0.2), критерии ОТК проверяются (обязательные — подтвердить), решение + статус + начисление Потока — **в одной транзакции** (P0.3), `task_flow_awards` — атомарный клейм (P0.4, не даёт начислить дважды). **Пересмотр (`reopenTaskService`):** `accepted → in_progress`, обратная проводка Потока (−1), удаление клейма (повторная приёмка снова начислит ровно один). **I.2.12:** ОТК не принимает/не возвращает/не пересматривает свою работу. **WS-события** (W.2.02.01): assigned/statusChanged/submitted/accepted/returned. **Уведомления** — best-effort (`notifySafely`). **Техдолг v0.0.01 закрыт в v0.0.2:** B1 (submit — только assignedTo), B2/B3 (accept/return — I.2.12), B4/B5 (atomic UPDATE ... WHERE status=$orig RETURNING), B6 (plan.directionId === task.directionId), B7 (now внутри retry), B8 (planExists). **Остаётся:** assignTask — checkCompetencies не реализован; listTasks/getById — нет access control. |
|Публичный API:
- `assertDirectionScope(participantId, directionId): Promise<void>` — `ForbiddenError` если не своё направление; FIRST_ARCHITECT — skip.
- `interface TaskFilter { directionId?; status?; priority?; assignedTo?; planId?; page?; perPage? }`.
- `listTasks(filter): Promise<{ data: Task[]; total: number }>` — пагинация ≤200, ORDER BY priority (critical→background), deadline NULLS LAST.
- `getById(taskId): Promise<Task>` — `TaskWithRelations` (planTitle, planExpectedResult, assignerName, assignerExternalId, inDailyPlan, returnReason, returnedAt).
- `listMyTasks(participantId): Promise<Task[]>` — активные (status ≠ accepted), ORDER BY returned-first, priority, deadline.
- `interface CreateTaskRequest { directionId; description; priority; planId?; requiredCompetencies?; location? }`.
- `createTaskService(input, requesterId): Promise<Task>` — direction scope + plan validation (B8) + retry externalId (5 попыток, B7) + audit.
- `assignTaskService(taskId, participantId, requesterId): Promise<Task>` — direction scope для requester и assignee, entity-validate, atomic UPDATE, WS, notify.
- `takeTaskService(taskId, participantId): Promise<Task>` — только assignee, atomic UPDATE, WS.
- `submitTaskService(taskId, requesterId): Promise<Task>` — только assignee (B1), **отчёт с артефактом обязателен (P0.2)**, atomic UPDATE, WS, notify ОТК.
- `interface AcceptOptions { comment?; criteria?: Array<{id; passed; comment?}> }`.
- `acceptTaskService(taskId, requesterId, options): Promise<Task>` — I.2.12 (B2), direction scope, отчёт с артефактом (P0.1), **обязательные критерии ОТК**, транзакция: otc_decisions + tasks + flow_transactions + task_flow_awards (P0.3/P0.4), audit, WS, notify.
- `returnTaskService(taskId, reason, requesterId): Promise<Task>` — I.2.12 (B3), direction scope, atomic UPDATE, WS, notify.
- `reopenTaskService(taskId, reason, requesterId): Promise<Task>` — `accepted → in_progress`, обратная проводка Потока (−1), DELETE task_flow_awards, транзакция, audit, WS, notify.
- Re-export: `getDeadlineForPriority`. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.02** (errors) — `NotFoundError`, `ConflictError`, `ForbiddenError`.
- **C.0.01.03** (constants) — через C.0.07.01 (`PRIORITY_DEADLINES_MS`).
- **C.0.01.04** (types) — `UUID`, `Priority`, `TaskStatus`.
- **C.0.01.05** (audit) — `logAction`.
- **C.0.07.01** (tasks/entity) — `createTask`, `assignTask`, `takeTask`, `submitTask`, `acceptTask`, `returnTask`, `formatTaskExternalId`, `getDeadlineForPriority`, `Task`.
- **C.0.08.02** (reports/service) — `listByTask` (для проверки артефакта при submit/accept).
- **S.0.01.03** (rbac) — `hasRole` (в `assertDirectionScope` для FIRST_ARCHITECT).
- **L.0.01.01** (id) — `newUUID`.
- **L.0.01.05** (logger) — `logger.warn` (notify-ошибки).
- **L.0.01.09** (db) — `query`, `queryOne`, `isUniqueViolation`, `transaction`.
- **L.0.01.10** (notifications) — `send as sendNotification`, `sendToRole` (уведомление ОТК).
- **W.2.02.01** (ws/tasks) — `emitTaskAssigned`, `emitTaskStatusChanged`, `emitTaskSubmitted`, `emitTaskAccepted`, `emitTaskReturned`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`assertDirectionScope`** — A.1.07.01 (tasks/controller.ts) и другие сервисы, работающие с задачами (C.0.08.02 — reports).
- **`listTasks`/`getById`/`listMyTasks`** — A.1.07.01: GET /tasks, GET /tasks/:id, GET /tasks/my. C.0.06.02 (plans) — через `getPlanProgress` (косвенно), C.0.06.05 (tree) — через `parentTaskId`-выборку (напрямую в SQL).
- **`createTaskService`** — A.1.07.01: POST /tasks; C.0.02.03 (onboarding) — `createWelcomeTask`.
- **`assignTaskService`** — A.1.07.01: POST /tasks/:id/assign; C.0.02.03 (onboarding) — назначение welcome-задачи.
- **`takeTaskService`/`submitTaskService`** — A.1.07.01: POST /tasks/:id/take, POST /tasks/:id/submit.
- **`acceptTaskService`** — A.1.07.01: POST /tasks/:id/accept (ОТК); A.1.09.01 (otc/controller) — через `otc_decisions`.
- **`returnTaskService`** — A.1.07.01: POST /tasks/:id/return (ОТК).
- **`reopenTaskService`** — A.1.07.01: POST /tasks/:id/reopen; A.1.35.01 (admin).
- **WS-события** — W.2.02.01 (ws/tasks) — фронт получает real-time обновления.
- **`TaskWithRelations`** (private) — расширяет `Task` для UI (F.4.02.03 Tasks.tsx). |
|Реализация:
- **`assertDirectionScope`** — `hasRole(FIRST_ARCHITECT)` → return; иначе SELECT `direction_id` из participants → NotFound → `ForbiddenError`; если не совпало — `ForbiddenError('Действие вне вашего направления')`.
- **`TASK_SELECT`** — большой SELECT с LEFT JOIN plans/participants(assigner)/daily_plans/daily_plan_tasks + 2 correlated subquery (return_reason, returned_at) через `otc_decisions JOIN reports`.
- **`listTasks`** — пагинация ≤200, 5 фильтров, ORDER BY priority CASE + deadline NULLS LAST.
- **`getById`** — SELECT по id, NotFound.
- **`listMyTasks`** — `assigned_to = $1 AND status <> 'accepted'`, ORDER BY returned-first (CASE WHEN status='returned' THEN 0 ELSE 1 END) + priority + deadline.
- **`createTaskService`** — `assertDirectionScope` → если `planId` — SELECT `plans.lead_direction_id` (NotFound если нет), сверка `plan.directionId === input.directionId` (B8/B6) → retry (5 попыток): `now` внутри цикла (B7), `MAX(SUBSTRING(external_id ...))` по `ЗДЧ-<today>-%`, `nextSeq ≤ 999`, `formatTaskExternalId` → `createTask` (entity) → INSERT (12 params + `location` через `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography` если есть) → audit → `getById`. При 23505 — `continue`.
- **`assignTaskService`** — `getById` → `assertDirectionScope` для requester и assignee → `assignTask(task, participantId)` (entity-validate) → atomic `UPDATE ... WHERE status=$orig RETURNING` (B4) → 0 rows → `ConflictError` → audit → `getById` → `emitTaskAssigned` → `notifySafely`.
- **`takeTaskService`** — `getById` → `task.assignedTo !== participantId` → `ForbiddenError` → `takeTask` (entity) → atomic UPDATE → audit → `emitTaskStatusChanged`.
- **`submitTaskService`** — `getById` → `task.assignedTo !== requesterId` → `ForbiddenError` (B1) → `listByTask` (reports) → проверка хотя бы одного `artifactUrl` (P0.2) → если нет — `ConflictError` → `submitTask` (entity) → atomic UPDATE → audit → `emitTaskSubmitted` → `sendToRole(Role.OTC, …)` (best-effort).
- **`acceptTaskService`** — `getById` → `task.assignedTo === requesterId` → `ForbiddenError` (B2/I.2.12) → `acceptTask` (entity) → `assertDirectionScope` → `listByTask` → find report с `artifactUrl` (P0.1) → если нет — `ConflictError` → SELECT `otc_criteria` (`active AND (direction_id = $1 OR direction_id IS NULL)` ORDER BY `direction_id NULLS LAST`) → проверка обязательных критериев (item.required !== false) — все должны быть `passed=true` в `options.criteria` → если нет — `ConflictError` с `{missing}` → `criteriaSnapshot` (JSON `{version, title, items, results}`) → **transaction:** SELECT FOR UPDATE task (status='submitted' иначе `ConflictError`), SELECT existing `otc_decisions` по report_id (если нет — INSERT с `criteria_version`, `criteria_snapshot`), UPDATE tasks status='accepted', INSERT `task_flow_awards` ON CONFLICT DO NOTHING RETURNING (P0.4), если claim успешен — INSERT `flow_transactions` (+1 main, source='otc', task_id) → audit → `emitTaskAccepted` → `notifySafely` assignee.
- **`returnTaskService`** — `getById` → `task.assignedTo === requesterId` → `ForbiddenError` (B3/I.2.12) → `assertDirectionScope` → `returnTask(task, reason)` (entity) → atomic UPDATE status='returned' WHERE status=$orig → 0 rows → `ConflictError` → audit → `emitTaskReturned` → `notifySafely` assignee.
- **`reopenTaskService`** — `getById` → `status !== 'accepted'` → `ConflictError` → `assignedTo === requesterId` → `ForbiddenError` → `assertDirectionScope` → **transaction:** SELECT FOR UPDATE (status='accepted' иначе `ConflictError`), UPDATE tasks `status='in_progress', reopened_count+1, last_reopen_reason, last_reopened_at`, `DELETE task_flow_awards RETURNING participant_id`, если удалён — INSERT `flow_transactions` (-1, source='otc_reopen') → audit → `emitTaskStatusChanged(..., 'accepted')` (old status) → `notifySafely` assignee. |
|Примечания:
РЕАЛИЗОВАНО: 12 публичных функций + 1 экспорт (`getDeadlineForPriority`), 3 интерфейса (1 private `TaskRow`, 1 private `TaskWithRelations`).
СВЕРХ СТАРОЙ СПЕКИ (v0.0.01): **B1–B8** — все закрыты. **P0.1–P0.5** — «правила ОТК»: артефакт обязателен, критерии проверяются, транзакция атомарна, `task_flow_awards`-клейм. **`reopenTaskService`** — новый метод (пересмотр), обратная проводка Потока. **`assertDirectionScope`** — P0.5 (направление-скоуп).
СВЯЗЬ С C.0.07.01 (entity): 6 transitions — entity-validate перед atomic UPDATE (даёт понятную ошибку для invalid state; atomic UPDATE — для race).
СВЯЗЬ С C.0.08.02 (reports/service): `listByTask` — проверка артефакта при submit/accept.
СВЯЗЬ С W.2.02.01 (ws/tasks): 5 emit-функций — real-time обновления в UI.
СВЯЗЬ С C.0.02.03 (onboarding): `createTaskService` + `assignTaskService` — для welcome-задачи (requiredCompetencies: ['онбординг']).
СВЯЗЬ С C.0.06.02 (plans/service): `getPlanProgress` считает задачи через `tasks.plan_id` (использует created через `createTaskService`); `tasks.parent_task_id` — для `getPlanTree`/`getPlanBranches`.
СВЯЗЬ С S.0.01.03 (rbac): `hasRole` — проверка FIRST_ARCHITECT в `assertDirectionScope`.
СВЯЗЬ С A.1.07.01 (tasks/controller): ~12 эндпоинтов (list/get/listMy/create/assign/take/submit/accept/return/reopen).
СВЯЗЬ С A.1.09.01 (otc/controller): `acceptTaskService` пишет `otc_decisions` — источник для ОТК-статистики.
ТЕХДОЛГ:
- **`assignTaskService`** — `checkCompetencies` не реализован (TODO в коде): `required_competencies` сохраняется, но не сверяется с `participant_competencies` при назначении; правило «назначить можно только если у участника есть компетенция» — не работает.
- **`listTasks`/`getById` — нет access control** — любой авторизованный может прочитать задачу другого направления; `assertDirectionScope` вызывается только в мутациях. Список/чтение — открыто.
- **`TASK_SELECT` — 2 correlated subquery** (return_reason, returned_at) — по 1 подзапросу на строку; для 200 задач — 400 подзапросов. Нужен LEFT JOIN LATERAL или отдельный запрос для otc_decisions.
- **`acceptTaskService` — SELECT existing `otc_decisions`** — не проверяет, что существующее решение имеет `verdict='accepted'`; если report был возвращён (`verdict='returned'`), а потом ОТК-приёмка пытается принять — существующее решение найдётся, новое не создастся, статус задачи изменится на accepted, но `otc_decisions.verdict` останется 'returned'. Рассинхрон.
- **`acceptTaskService` — criteria.version mismatch** — если `otc_criteria` менялись между submit и accept, `criteriaSnapshot` сохранит актуальную версию, но сравнение с `options.criteria` идёт по `id`; если id критериев изменились — старые id в options не сматчатся.
- **`criteriaSnapshot`** — `criteria.items` берётся из БД (items — JSONB); если `items` — не array, `missing` пуст (все критерии считаются пройденными); валидация `Array.isArray` есть, но `required !== false` на не-array вернёт пустой фильтр → нет missing.
- **`reopenTaskService` — `emitTaskStatusChanged(..., 'accepted')`** — oldStatus='accepted' (был), newStatus='in_progress'; payload из `getById` (после UPDATE) — уже in_progress; семантика oldStatus в событии — корректна, но название (`emitTaskStatusChanged`) не намекает на transition.
- **`listMyTasks` — ORDER BY returned-first** — задачи с `returned` всплывают наверх; но `returned` в `ALLOWED_TRANSITIONS` уже может быть снова `in_progress`; UI должен различать «свежий возврат» от «в работе».
- **`notifySafely`** — глотает ошибки; при массовом сбое notifications — только warn в логах.
- **`emitXxx`** — если WS-сервер недоступен, emitter может бросить; в коде нет try/catch вокруг `emitTaskAssigned`/... — WS-сбой уронит операцию после успешного INSERT (транзакция уже закоммичена, но клиент получит 500).
- **`assertDirectionScope` — FIRST_ARCHITECT** — единственное исключение; другие «глобальные» роли (COUNCIL_MEMBER, VERIFIER) — не исключение, работают только в своём направлении.
- **`createTaskService` — TASK_TYPE = 'ЗДЧ'** — хардкод; для разных типов задач (например, «инцидент») — отдельные префиксы не предусмотрены.
- **`acceptTaskService` — `criteria?.version ?? 1`** — если критериев нет в БД, `criteria_version = 1` (дефолт), но `criteriaSnapshot = null`; семантика «нет критериев» vs «версия 1» — размыта.
- **`task_flow_awards`** — одно начисление на задачу; при пересмотре (-1) и повторной приёмке (+1) — итог 1; но если пересмотр был, а повторной приёмки не было — итог 0 (задача снова в работе, но Поток не начислен).
- **`flow_transactions` source='otc_reopen'** — новая категория; в C.0.18.02 (balance/service) её надо учитывать при подсчёте.
- **`transaction` + `emitTask*`** — emit после транзакции (правильно), но если emit упадёт — клиент получит 500, хотя данные уже сохранены; retry не делает emit повторно.
- **`criteria_snapshot`** — не маскируется; если критерии содержат PII — попадёт в audit_log как есть. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.22 test-tasks.ts (прямо); I.9.04.71 test-cards.ts (косвенно — задачи в карточке); I.9.04.14 test-otc-two.ts (accept + otc_decisions); I.9.04.65 test-invariants.ts (задачи через C.0.07.02). |

|C.0.09.02|CORE|OTC|TypeScript|src/core/otc/service.ts|C.0.01.02, C.0.01.04, C.0.01.05, C.0.07.02, C.0.08.02, C.0.09.01, L.0.01.05, L.0.01.09, L.0.01.10, W.2.03.01|v.0.0.2|Draft|-|
|Описание: **Сервис ОТК.** Приёмка, возврат, кризисный протокол, апелляции, статистика. **I.2.12 без исключений** — ОТК не проверяет свою работу (B1: убран Architect-override). **`acceptTaskService`/`returnTaskService` из C.0.07.02** — единый путь приёмки (артефакт + критерии + транзакция + начисление Потока). **Кризисный протокол** (`crisisDecide`): только для `priority='critical'`; I.2.12-проверка (B2), `assignedTo === null` → ConflictError (B3). **Апелляции:** identity-check → ForbiddenError (B5); кризисный протокол не подлежит (I.2.9.1в). **SLA** — `OTC_SLA_HOURS = env['OTC_SLA_HOURS'] ?? 24`; `getSla` — очередь/просрочка/среднее ожидание; `escalateOverdue` — cron-эскалация с `otc_escalations` (ровно 1 раз на задачу). **WS-эмиссии** — best-effort (try/catch, B7): decisionMade / crisisDecisionMade / appealFiled / queueUpdated. **Уведомления** ОТК/Совету направления — best-effort. **Активные критерии** (`getActiveCriteria`): направление + глобальные (ORDER BY direction_id NULLS LAST); `assertCriteria` — обязательные должны быть confirmed. |
|Публичный API:
- `interface OtcQueueItem { reportId; taskId; taskExternalId; taskDescription; directionId; authorId; authorName; type; comment; mediaUrl; artifactUrl; geolocation; createdAt; hoursWaiting; overdue }`.
- `getQueue(directionId?): Promise<OtcQueueItem[]>` — задачи `submitted`, ORDER BY priority + created_at ASC, LIMIT 100.
- `interface CriteriaResult { id; passed; comment? }`.
- `interface DecideRequest { reportId; verdict; comment?; criteria? }`.
- `interface OtcCriteria { version; title; items }`.
- `getActiveCriteria(directionId?): Promise<OtcCriteria | null>`.
- `getSla(directionId?): Promise<{slaHours; pending; overdue; avgWaitingHours}>`.
- `escalateOverdue(directionId?): Promise<{escalated: number}>` — cron, LIMIT 100, идемпотентен (otc_escalations).
- `decide(input, otcId): Promise<OtcDecision>` — B1 (I.2.12, 403), direction scope, критерии, INSERT decisions, accept/return, audit, WS.
- `interface CrisisDecideRequest { reportId; functionalityOk; safetyOk; comment? }`.
- `crisisDecide(input, otcId): Promise<OtcDecision>` — priority='critical', B2 (I.2.12), B3 (assignedTo≠null), INSERT decisions, accept/return, audit, WS.
- `appeal(decisionId, participantId, reason): Promise<OtcAppeal>` — identity (403, B5), active-appeal check, INSERT appeals, audit, WS, notify ОТК.
- `getAppeal(appealId): Promise<OtcAppeal>` — NotFound.
- `listAppealsByDecision(decisionId): Promise<OtcAppeal[]>` — ORDER BY created_at DESC.
- `interface OtcStats { totalDecisions; accepted; returned; crisisProtocol; avgCheckHours }`.
- `getStats(directionId?): Promise<OtcStats>` — `avgCheckHours` **всегда null** (B8 TODO).
- Константа: `OTC_SLA_HOURS = Number(process.env['OTC_SLA_HOURS'] ?? 24)`. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.02** (errors) — `NotFoundError`, `ConflictError`, `ForbiddenError`.
- **C.0.01.04** (types) — `UUID`.
- **C.0.01.05** (audit) — `logAction`.
- **C.0.07.02** (tasks/service) — `getById as getTaskById`, `acceptTaskService`, `returnTaskService`, `assertDirectionScope`.
- **C.0.08.02** (reports/service) — `getById as getReportById`.
- **C.0.09.01** (otc/entity) — `createDecision`, `createCrisisDecision`, `createAppeal`, `canBeAppealed`, `OtcDecision`, `OtcVerdict`, `OtcAppeal`, `OtcAppealStatus`.
- **L.0.01.05** (logger) — `logger.warn`.
- **L.0.01.09** (db) — `query`, `queryOne`.
- **L.0.01.10** (notifications) — `sendToRole`.
- **W.2.03.01** (ws/otc) — `emitDecisionMade`, `emitCrisisDecisionMade`, `emitAppealFiled`, `emitQueueUpdated`.
- Env: `OTC_SLA_HOURS` (default 24).
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`getQueue` / `getSla` / `getStats`** — A.1.09.01 (otc/controller.ts): GET /otc/queue, GET /otc/sla, GET /otc/stats; F.4.02.98 (Otc.tsx) — дашборд ОТК.
- **`getActiveCriteria`** — A.1.09.01: GET /otc/criteria.
- **`escalateOverdue`** — cron (в перспективе I.9.07.* / I.3.05.*): периодический проход эскалации.
- **`decide`** — A.1.09.01: POST /otc/decide; `decide` **внутри** вызывает `acceptTaskService`/`returnTaskService` из C.0.07.02 — двойной путь приёмки (прямой через C.0.07.02 и через ОТК).
- **`crisisDecide`** — A.1.09.01: POST /otc/crisis-decide.
- **`appeal` / `getAppeal` / `listAppealsByDecision`** — A.1.09.01: POST /otc/appeals, GET /otc/appeals/:id, GET /otc/decisions/:id/appeals.
- **WS-эмиссии** — W.2.03.01 (ws/otc): decisionMade/crisisDecisionMade/appealFiled/queueUpdated. |
|Реализация:
- **`getQueue`** — SELECT reports JOIN tasks JOIN participants WHERE `t.status='submitted'` (опционально `direction_id=$1`), ORDER BY priority (critical→standard→background) + created_at ASC, LIMIT 100; `hoursWaiting = round(EXTRACT(EPOCH FROM now - created_at) / 3600)`; `overdue = hoursWaiting > OTC_SLA_HOURS`.
- **`getActiveCriteria`** — SELECT version/title/items FROM `otc_criteria` WHERE `active AND (direction_id=$1 OR direction_id IS NULL)` ORDER BY `direction_id NULLS LAST` LIMIT 1; `items` — массив с проверкой `Array.isArray`.
- **`getSla`** — COUNT + COUNT FILTER (overdue) + AVG(EXTRACT) по `reports JOIN tasks WHERE t.status='submitted'`.
- **`assertCriteria`** — если `!active || items.length === 0` — return; `passed = Map(results.map(r => [r.id, r.passed]))`; `missing = active.items.filter(required !== false).filter(item => passed.get(item.id) !== true).map(item => item.title)`; если `missing.length > 0` — `ConflictError` с `{missing}`.
- **`escalateOverdue`** — SELECT reports JOIN tasks WHERE `status='submitted' AND r.created_at < now() - SLA` AND `NOT EXISTS otc_escalations` LIMIT 100 → для каждой: INSERT otc_escalations ON CONFLICT DO NOTHING + `sendToRole(COUNCIL_MEMBER, ...)` (try/catch — best-effort) → `{escalated: rows.length}`.
- **`decide`** — `getReportById` → `getTaskById` → `task.status !== 'submitted'` → 409 → **B1:** `task.assignedTo === otcId` → 403 (I.2.12) → `assertDirectionScope(otcId, task.directionId)` → `getActiveCriteria` → `assertCriteria` → `createDecision` → INSERT `otc_decisions` (с `criteria_snapshot` если есть) → если verdict ∈ {accepted, crisis_protocol} — `acceptTaskService(report.taskId, otcId)`, иначе — `returnTaskService(report.taskId, comment ?? 'Возвращено ОТК', otcId)` → audit → try/catch WS: `emitDecisionMade` + `emitQueueUpdated` (пересчёт getQueue) → return entity.
- **`crisisDecide`** — `getReportById` → `getTaskById` → `task.priority !== 'critical'` → 409 → `task.status !== 'submitted'` → 409 → **B3:** `!task.assignedTo` → 409 → **B2:** `task.assignedTo === otcId` → 403 (I.2.12) → `createCrisisDecision` → INSERT `otc_decisions` → если crisis_protocol — `acceptTaskService`, иначе — `returnTaskService` → audit → try/catch WS: `emitCrisisDecisionMade` + `emitQueueUpdated`.
- **`appeal`** — `queryOne` с JOIN reports + tasks (id, crisis_protocol, report_id, task_id, task_direction_id, report_participant_id) → **B5:** `report_participant_id !== participantId` → 403 (только автор) → SELECT active appeal по decision_id (`status IN ('filed','reviewed')`) → **B6 TODO:** `canBeAppealed` с фиктивным `OtcDecision` (только `crisisProtocol` и `hasActiveAppeal` имеют значение) → `createAppeal` → INSERT `otc_appeals` → audit → try/catch WS: `emitAppealFiled` → try/catch `sendToRole(OTC, ...)` → return entity.
- **`getAppeal`** — SELECT по id, NotFound.
- **`listAppealsByDecision`** — SELECT ORDER BY created_at DESC.
- **`getStats`** — COUNT + FILTER по verdict (accepted/returned/crisis_protocol) по `otc_decisions` с опциональным JOIN reports JOIN tasks (direction); `avgCheckHours` — TODO (B8), всегда null. |
|Примечания:
РЕАЛИЗОВАНО: 12 публичных функций + 1 приватная (`assertCriteria`), 5 интерфейсов, 1 константа.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.01): **B1** — убран Architect-override (I.2.12 без исключений); I.2.12 → ForbiddenError (403). **B2** — I.2.12 в `crisisDecide`. **B3** — `assignedTo === null` → понятный ConflictError. **B5** — identity → ForbiddenError. **B7** — WS-эмиссии best-effort. **`getSla` / `escalateOverdue` / `getActiveCriteria` / `assertCriteria`** — новые (SLA enforcement + критерии ОТК).
СВЯЗЬ С C.0.07.02 (tasks/service): `decide`/`crisisDecide` используют `acceptTaskService`/`returnTaskService` — единый путь приёмки (артефакт + критерии + транзакция + Поток). Дубль «проверка артефакта» — в C.0.07.02 и C.0.09.02 (P0.2 vs assertCriteria); семантически разные (артефакт — обязателен, критерии — из otc_criteria).
СВЯЗЬ С C.0.08.02 (reports/service): `getReportById` — источник report/taskId для decide/crisisDecide/appeal.
СВЯЗЬ С C.0.09.01 (otc/entity): `createDecision`/`createCrisisDecision`/`createAppeal`/`canBeAppealed` — вся логика вердикта/апелляции в entity.
СВЯЗЬ С W.2.03.01 (ws/otc): 4 emit-функции — real-time обновления в UI ОТК.
СВЯЗЬ С C.0.01.03 (constants): `OTC_SLA_HOURS` — env, дефолт 24 часа (не в constants.ts, но рядом по смыслу).
ТЕХДОЛГ:
- **B4 (НЕ закрыт): INSERT решения + accept/return — не в одной транзакции.** При сбое шага 2 (`acceptTaskService`/`returnTaskService`) — решение в БД, задача в `submitted` (рассинхрон). Нужна общая транзакция, но `acceptTaskService`/`returnTaskService` работают с `query` напрямую; рефакторинг сервисов или передача client.
- **B6 (НЕ закрыт): `appeal` передаёт фиктивный `OtcDecision`** в `canBeAppealed` — `otcId=''`, `verdict='returned'/'crisis_protocol'`, `comment=null`, `criteriaVersion=1`, `createdAt=''`. Проверка работает только по `crisisProtocol` + `hasActiveAppeal`, но сигнатура требует полный объект. Требуется `canBeAppealed({ crisisProtocol, hasActiveAppeal })` в C.0.09.01.
- **B8 (НЕ закрыт): `getStats().avgCheckHours` — всегда null.** Нужен `AVG(EXTRACT(EPOCH FROM (d.created_at - r.created_at)) / 3600)` с JOIN reports.
- **`decide` вызывает `acceptTaskService`** — который **снова** делает `listByTask` и проверку `artifactUrl`; для кризисного протокола (`crisis_protocol`) — тоже; семантически «принять без артефакта» нельзя, но в кризисе это может быть оправдано (артефакт может появиться позже). Расхождение с I.2.9.1в не задокументировано.
- **`decide` / `crisisDecide` — `if (task.assignedTo) { }`** — пустые блоки (TODO-заглушки); не ясно, что должно быть (уведомление исполнителю? аудит?); сейчас — no-op.
- **`getQueue` — LIMIT 100** — без пагинации; для крупных ОТК — обрезается.
- **`getQueue` — `hoursWaiting` = `Math.round`** — округление до часов; для «5 минут назад» → 0 часов (визуально «только что», но неотличимо от «10 минут»).
- **`escalateOverdue` — `LIMIT 100`** за прогон; при большом количестве просрочек — несколько прогонов.
- **`escalateOverdue` — `sendToRole(COUNCIL_MEMBER as never, ...)`** — `as never` — обход типизации; `sendToRole` ожидает `Role`, но `COUNCIL_MEMBER` — из `Role` enum; приведение через `as never` маскирует реальную ошибку типов (если `sendToRole` сигнатура изменится — не заметим).
- **`canBeAppealed` для accepted-решений** — возможно (I.2.13 не запрещает); семантика «оспорить принятую задачу» — на усмотрение бизнеса.
- **`appeal` — `reason` ≤ 5000** — проверка в entity; но `newValue.reason.slice(0, 200)` в audit — усечение (200 символов); полная причина в `otc_appeals.reason`.
- **`decide` — `criteria_snapshot`** — `JSON.stringify({ ...criteria, results })` — если `criteria` большой (много items), snapshot может быть большим; БД-колонка должна быть JSONB.
- **`decide`/`crisisDecide` — `criteria?.version ?? entity.criteriaVersion`** — если критериев нет, `entity.criteriaVersion` = 1 (из `createDecision` дефолт); семантически «версия 1» vs «нет критериев» — размыто.
- **`crisisDecide` — `task.priority !== 'critical'`** — жёсткое требование; задача `high` не может быть кризисной, даже если ситуация кризисная. Правило I.2.9.1 — только для `critical`.
- **`decide` — двойной accept (OTС + прямой в C.0.07.02)** — если ОТК вызвал `decide`, а потом кто-то ещё раз попробует `acceptTaskService` напрямую (через A.1.07.01) — второй вызов упадёт (задача уже accepted), но `otc_decisions` уже есть; рассинхрон.
- **`getStats` — `joinDir` условный** — если `directionId` передан, JOIN есть; иначе — без JOIN (все решения, все направления); логика WHERE корректна, но `params.length` при пустом фильтре = 0, `where = ''`.
- **`getStats` — `avgCheckHours: null`** — UI должен либо скрывать, либо показывать «—»; контракт не задокументирован.
- **`OTC_SLA_HOURS`** — `Number(...)`, если env задан как `'24h'` → NaN; валидация env — на уровне `parseEnv` в server.
- **`getActiveCriteria`** — `ORDER BY direction_id NULLS LAST` — сначала направленческие, потом глобальные; если есть оба, направленческий приоритетнее.
- **`assertCriteria`** — `item.required !== false` — семантика «по умолчанию required»; явный `required: false` — опциональный.
- **`appeal` — `sendToRole(OTC, ...)`** — уведомление **всем** ОТК направления, не конкретному; для персональной апелляции — избыточно, но best-effort.
- **`decide` — WS-emit после транзакции (не в try/catch транзакции)** — если WS упадёт — warning, но данные уже в БД; клиент ОТК получит ответ, но real-time UI других ОТК — нет. | |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.13 test-otc.ts (прямо); I.9.04.14 test-otc-two.ts (кризис + апелляции); I.9.04.35 test-webhooks.ts (косвенно); I.9.04.22 test-tasks.ts (косвенно — через acceptTaskService). |

|C.0.41.04|CORE|Cells|TypeScript|src/core/cells/delegation.ts|C.0.01.02, C.0.01.04, C.0.01.05, C.0.41.03, L.0.01.01, L.0.01.09|v.0.0.1|Draft|-|
|Описание: **Передача наряда в дочерние ячейки (5 × 5).** Наряд приходит на ячейку. Её координатор может: 1) распределить задачи по людям своей ячейки (`C.0.41.03`), или 2) **передать части наряда дочерним ячейкам** (этот модуль), а те раздадут людям сами. **Задача остаётся в наряде верхней ячейки** (общая картина не теряется), но помечается `delegated_to_cell_id`; в дочерней ячейке создаётся свой наряд на ту же дату. **Одна задача — одна дочерняя ячейка** (иначе два человека делают одно и то же). **Функции:** `distributeCellDailyPlan` (валидация: дочерние ячейки — дети; задачи входят в наряд родителя; нет дублей; транзакция: для каждого assignment — SELECT FOR UPDATE child plan (или INSERT), INSERT `cell_daily_plan_tasks` ON CONFLICT DO NOTHING, UPDATE parent `delegated_to_cell_id`); `getDelegationTree` (parent + children на дату); `countDelegated` (COUNT задач родителя с `delegated_to_cell_id NOT NULL`). |
|Публичный API:
- `interface Distribution { childCellId; taskIds }`.
- `interface DelegationResult { parent: CellDailyPlanView; children: Array<CellDailyPlanView & { cellNumber }> }`.
- `distributeCellDailyPlan(input): Promise<DelegationResult>` — `getCellDailyPlan` (parent) → NotFound если нет plan; `getChildren` (empty → 409); валидация assignments: `childCellId ∈ children`, задачи ∈ parent, нет дублей, нет уже делегированных; `seen.size === 0` → 422; транзакция: для каждого assignment — SELECT child plan FOR UPDATE (UPDATE `status='delegated'` или INSERT с `status='delegated'`), INSERT `cell_daily_plan_tasks ON CONFLICT DO NOTHING`, UPDATE parent `delegated_to_cell_id`; audit; return `getDelegationTree`.
- `getDelegationTree(cellId, date): Promise<DelegationResult>` — parent + для каждого child — `getCellDailyPlan` + `cellNumber`.
- `countDelegated(planId): Promise<number>` — COUNT `cell_daily_plan_tasks WHERE plan_id AND delegated_to_cell_id IS NOT NULL`. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.02** (errors) — `ConflictError`, `NotFoundError`, `ValidationError`.
- **C.0.01.04** (types) — `UUID`.
- **C.0.01.05** (audit) — `logAction`.
- **C.0.41.03** (cells/daily) — `getCellDailyPlan`, `CellDailyPlanView`.
- **L.0.01.01** (id) — `newUUID`.
- **L.0.01.09** (db) — `query`, `queryOne`, `transaction`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`distributeCellDailyPlan`** — A.1.04.01 (cells/controller.ts): POST /cells/:id/daily-plan/:date/distribute; F.4.02.35 (CellsMap.tsx) — распределение по дереву.
- **`getDelegationTree`** — A.1.04.01: GET /cells/:id/daily-plan/:date/delegation; F.4.02.35 (CellsMap.tsx).
- **`countDelegated`** — A.1.04.01: GET /cells/:id/daily-plan/:date/delegated-count.
- **`Distribution` / `DelegationResult`** — A.1.04.01; F.4.02.35 (CellsMap.tsx). |
|Реализация:
- **`getChildren(cellId)`** (private) — SELECT `cells WHERE parent_cell_id = $1` ORDER BY number.
- **`distributeCellDailyPlan`** — `getCellDailyPlan` (parent) → `!parent.planId` → 404; `getChildren` (empty → 409); `childIds = Set`; `parentTaskIds = Set(parent.tasks.map(taskId))`; `delegatedRows = SELECT task_id, delegated_to_cell_id FROM cell_daily_plan_tasks WHERE plan_id = parent.planId`; `alreadyDelegated = Set(...filter delegated_to_cell_id)`; валидация assignments (`seen`): `childCellId ∈ childIds` (422), `taskId ∈ parentTaskIds` (409), `!alreadyDelegated.has(taskId)` (409), `!seen.has(taskId)` (422); `seen.size === 0` → 422; транзакция: для каждого assignment — SELECT child plan `FOR UPDATE`; если есть — UPDATE `approved_by, status='delegated'`; иначе — INSERT `status='delegated'`; для каждого taskId — INSERT `cell_daily_plan_tasks ON CONFLICT (plan_id, task_id) DO NOTHING` + UPDATE parent `delegated_to_cell_id = a.childCellId`; audit; return `getDelegationTree`.
- **`getDelegationTree`** — `getCellDailyPlan` (parent) + `getChildren`; для каждого child — `getCellDailyPlan(child.id, date)` + `cellNumber`; return `{parent, children}`.
- **`countDelegated`** — COUNT `cell_daily_plan_tasks WHERE plan_id AND delegated_to_cell_id IS NOT NULL`. |
|Примечания:
РЕАЛИЗОВАНО: 3 публичные функции + 1 private (`getChildren`) + 2 интерфейса.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **`distributeCellDailyPlan`** — транзакция + FOR UPDATE (race-safe); **`delegated_to_cell_id`** — пометка в родителе; **`getDelegationTree`** — parent + children; **`countDelegated`** — счётчик переданных задач.
СВЯЗЬ С C.0.41.03 (cells/daily): `getCellDailyPlan` — источник parent; `delegated_to_cell_id` — колонка в `cell_daily_plan_tasks` (добавлена в daily? — да, в `upsertCellDailyPlan` DELETE сбрасывает, а тут — UPDATE); семантика «делегирование» — в этой колонке.
СВЯЗЬ С C.0.04.02 (cells/service): `parent_cell_id` — иерархия; `getChildren` — потомки.
СВЯЗЬ С F.4.02.35 (CellsMap.tsx): UI — дерево нарядов.
ТЕХДОЛГ:
- **`distributeCellDailyPlan` — `delegated_to_cell_id` не сбрасывается при повторном** — если задача уже делегирована — 409; семантика «нельзя передать дважды» — ок, но если нужно «передать в другую ячейку» — roadmap (UPDATE).
- **`distributeCellDailyPlan` — `status='delegated'` для child** — у child-плана `status='delegated'`; семантика «делегированный наряд» — ок; в `C.0.41.03` `upsertCellDailyPlan` перезаписывает на `'approved'` при UPDATE — рассинхрон статусов между parent (delegated → approved при update) и child; roadmap — унифицировать.
- **`distributeCellDailyPlan` — не проверяет, что child не имеет своего наряда с другими задачами** — если child уже имеет план (например, `status='approved'`), то `status='delegated'` перезапишет; семантика «делегирование перезаписывает» — ок, но задача может быть потеряна (DELETE не делается — INSERT ON CONFLICT DO NOTHING); roadmap — предупреждение.
- **`distributeCellDailyPlan` — не проверяет направление child-ячейки** — `child.direction_id` может отличаться; задача родителя из направления X передаётся ячейке из направления Y — семантика «делегирование в дочернюю (должна быть в том же направлении)» — ок, но не проверяется; roadmap.
- **`getDelegationTree` — N+1** — для каждого child — `getCellDailyPlan`; для 5 детей — 5 SELECT; ок для 5×5.
- **`countDelegated` — не считает детей** — только parent; для «сколько в дочерних» — `getDelegationTree` (children); семантика «count только parent» — ок.
- **`getChildren` — не проверяет `deleted_at`** — если ячейка soft-deleted — попадёт; roadmap.
- **Нет WS-эмиссий** — real-time для делегирования — не отправляется; roadmap — WS.
- **Нет уведомлений** — о новом наряде дочерней ячейки — не уведомляется; roadmap — push/email.
- **`distributeCellDailyPlan — audit** — один `logAction` на всю операцию; для per-assignment — roadmap.
- **`Distribution.taskIds`** — массив; дубли в `taskIds` внутри одного assignment не проверяются (`seen` — глобальный, но только для всех); ок (глобальный `seen` покрывает). |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.61 test-delegation.ts (прямо); I.9.04.03 test-cells.ts (косвенно); I.9.04.59 test-tree-naryad.ts (косвенно — дерево наряда). |

|C.0.43.01|CORE|Public|TypeScript|src/core/public/service.ts|C.0.01.04, L.0.01.09|v.0.0.1|Draft|-|
|Описание: **Публичная витрина: только агрегаты, без авторизации.** Человек, пришедший по ссылке, должен за 60 секунд увидеть, что проект живой (сколько людей, направлений, сколько работы сделано), и подать заявку. **Здесь нет ни одного персонального поля — только `COUNT(*)`.** `PublicOverview` — people/directions/tasksInWork/tasksAccepted/reportsSubmitted. `getPublicOverview()` — один SELECT с 5 подзапросами (`participants`, `directions`, `tasks assigned/in_progress`, `tasks accepted`, `reports`). |
|Публичный API:
- `interface PublicOverview` — 5 полей: people/directions/tasksInWork/tasksAccepted/reportsSubmitted (все `number`).
- `getPublicOverview(): Promise<PublicOverview>` — 1 SELECT с 5 подзапросами, `parseInt` каждого. |
|↙ ПОТРЕБЛЯЕТ:
- **C.0.01.04** (types) — неявно (`PublicOverview` — локальный, но `number` — примитив).
- **L.0.01.09** (db) — `query`.
- Внешние: нет. |
|↘ ПРЕДОСТАВЛЯЕТ:
- **`getPublicOverview`** — A.1.38.01 (public/controller.ts): GET /public/overview; F.4.02.30 (Landing.tsx) — публичная витрина.
- **`PublicOverview`** — A.1.38.01; F.4.02.30 (Landing.tsx). |
|Реализация:
- **`getPublicOverview`** — 1 SELECT с 5 подзапросами (`(SELECT COUNT(*)::text …) AS people`, …); `parseInt(r?.people ?? '0', 10)` × 5; return `{people, directions, tasksInWork, tasksAccepted, reportsSubmitted}`. |
|Примечания:
РЕАЛИЗОВАНО: 1 интерфейс, 1 функция.
СВЕРХ СТАРОЙ СПЕКИ (v0.0.11): **без PII** — только `COUNT(*)`; **без auth** — публичный эндпоинт.
СВЯЗЬ С C.0.02.02 (participants/service): `participants.deleted_at IS NULL` — семантика «активные участники».
СВЯЗЬ С C.0.07.02 (tasks/service): `tasks.status` — источник `tasksInWork`/`tasksAccepted`.
СВЯЗЬ С C.0.08.02 (reports/service): `reports` — источник `reportsSubmitted`.
СВЯЗЬ С F.4.02.30 (Landing.tsx): UI-потребитель.
ТЕХДОЛГ:
- **`tasks_accepted` — `tasks WHERE status='accepted'`** — счётчик задач; `reportsSubmitted` — `reports` (все, включая `returned`); семантика «reports submitted» — фактически «все отчёты»; roadmap — фильтр по `status='submitted'`/`accepted`.
- **`directions` — без `status <> 'abolished'`** — семантика «все направления» — ок; для «активные» — roadmap.
- **`getPublicOverview` — без кэша** — каждый вызов — 5 SELECT; для лендинга — roadmap (Redis TTL 60s).
- **Нет rate-limit** — публичный эндпоинт; для брутфорса — roadmap.
- **Нет `tasksInWork` — только assigned/in_progress** — `submitted` не считается «в работе»; семантика «в работе» — ок.
- **`reports` — все** — нет фильтра по дате/статусу; семантика «сколько отчётов» — ок. |
|ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.52 test-public.ts (прямо); I.9.04.55 test-journey.ts (косвенно — landing). |

|C.1.10.01|Core|Passport/Matching|TypeScript|src/core/passport/matching.ts|C.0.01.02, L.0.01.09, C.1.01.01, C.1.04.02, C.1.08.01, C.1.11.01|v.0.0.01|Draft|I.9.09.05, I.9.09.11|
|Описание: Matching (§11.2, Фаза 3a) участника vs TaskProfile. `matchTask(taskId, participantId, viewerId)` — по каждому `required_atom`: «покрыто» = для каждой применяемой dimension `level >= min[dim]` И `status ∈ {confirmed, provisional}`; `dimension_applicability[dim].applicable=false` → измерение не проверяем. **Критичные dimension по роли (A21)**: `executor→P`, `assessor→E`, `designer→D`, `consultant→U,X`. Агрегат: `match` (нет gaps) | `partial` (gaps только в не-критичных) | `no_match` (есть критичный gap). Permit-gap (**A38/A39**): `absent`/`expired`/`revoked` → критичный, приоритет `active` + effective `valid_until = min(participant_permits, permits)`. `getCandidates(taskId, viewerId, limit ≤ 100)` — top-N без раскрытия уровней. |
|Публичный API:
- `matchTask(taskId: UUID, participantId: UUID, viewerId: UUID): Promise<TaskMatching>` — `{ taskId, participantId, status, gaps, checkedCount, coverage }`. `coverage = passCount / totalChecks` (0 если `totalChecks=0`).
- `getCandidates(taskId, viewerId, limit = 20): Promise<TaskCandidate[]>` — `{ participantId, participantExternalId, participantName, matches, gaps, status }` (без `level`/`min`).
- Внутренние (не экспортируются): `checkRequiredAtom`, `applyProfile`, `aggregateStatus`, `checkPermitsGap`.
- Константы: `ROLE_CRITICAL: Record<TaskProfileRole, Dimension[]>`. |
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.02 errors — `NotFoundError`.
- L.0.01.09 db — `query`, `queryOne`.
- C.1.01.01 types — `UUID`, `Dimension`, `MatchGap`, `MatchStatus`, `RequiredAtom`, `TaskCandidate`, `TaskMatching`, `TaskProfile`, `TaskProfileRole`, `DIMENSIONS`, `isDimensionApplicable`.
- **C.1.04.02 visibility.ts** — `recordAccess` (журнал при чтении чужого паспорта).
- **C.1.08.01 task-profile.ts** — `getTaskProfile`.
- **C.1.11.01 permits.ts** — `pickEffectiveValidUntil`.
- Таблицы БД: `person_atom_states`, `competency_atoms`, `participant_permits`, `permits`, `participants`, `task_profiles`. |
|↘ ПРЕДОСТАВЛЯЕТ:
- `matchTask` / `getCandidates` — контроллер паспорта (TaskProfile/Matching endpoints).
- Побочный эффект: пишет в `passport_access_log` (reason `matching` / `candidates`) при `viewerId !== participantId`. |
|Реализация:
- `matchTask`: `getTaskProfile` (NotFound если нет); проверка `participants.deleted_at IS NULL`; `applyProfile` (по каждому атому — `checkRequiredAtom`); `checkPermitsGap`; `gaps = permitGap ? [permitGap, ...atomGaps] : atomGaps`; `recordAccess` при `viewerId !== participantId`; `checkedCount = atoms + permitIds.length`, `coverage = (total - gaps) / total`.
- `checkRequiredAtom`: SELECT `person_atom_states` по `(participant_id, atom_id)`, Map по dimension; для каждой `[dim, minLevel]` из `req.min`: пропуск если `!isDimensionApplicable(app, dim)`; иначе `isCovered(state, minLevel)` — `state.status ∈ {confirmed, provisional}` И `state.level !== null` И `state.level >= minLevel`; собранные `missingDimensions` → `MatchGap { atomId, role, missingDimensions, critical: any criticalDims.includes(d), reason: 'missing_dimensions' }`.
- `aggregateStatus`: `[] → 'match'`; есть `critical → 'no_match'`; иначе `'partial'`.
- `checkPermitsGap`: пустой `permitIds → null`; SELECT `participant_permits JOIN permits` с `ORDER BY created_at DESC`; по каждому pid: нет записей → `absent`; есть `active` с effective `valid_until < now` → `expired`; active и не истёк → `continue` (покрыто); есть `expired` → `expired`; иначе `revoked`. Gap: `{ atomId: null, permitId, role: 'executor', missingDimensions: [], critical: true, reason: 'missing_permit', permitStatus }`.
- `getCandidates`: `getTaskProfile` (NotFound если нет); `safeLimit = clamp(1, 100)`; SELECT активных с `EXISTS(person_atom_states WHERE level IS NOT NULL)` — до 200 кандидатов, `ORDER BY entered_at ASC`; для каждого — `applyProfile` + `checkPermitsGap`; `status === 'no_match'` → **не включаем**; `matches = requiredAtoms.length - atomGaps.length`; сортировка `match > partial`, затем `matches DESC`, затем `name.localeCompare`; top-N; `recordAccess` по каждому. |
|Примечания:
**A21**: candidates не раскрывают уровни — только `participantId/externalId/name/matches/gaps/status`.
**Приоритет permit над атомами**: `permitGap` всегда critical → `no_match` → candidate не попадает в top-N (даже если все атомы покрыты).
**`role` в permit-gap** захардкожен как `'executor'` — permit не привязан к роли, но для консистентности типа `MatchGap.role` заполнен; смысловой нагрузки не несёт.
**Проверка `deleted_at`** только в `matchTask` (subject); в `getCandidates` — в SQL WHERE.
ТЕХДОЛГ: N+1 запросов в `getCandidates` (до 200 × 2 запроса на каждого). Для больших профилей возможен тяжёлый план; оптимизация — батчевые SELECT с `ANY(array)`.
ТЕХДОЛГ: `checkRequiredAtom` не делает различие «нет оценки» vs «низкий level» — оба в `missingDimensions`; UI не отличит «не проверяли» от «проверяли, не дотянул».
СВЯЗЬ С A21: агрегация `match/partial/no_match` — строгая; порог `coverage` только информационный.
ТЕСТОВОЕ ПОКРЫТИЕ: I.9.09.05 (test-passport-v2), I.9.09.11 (test-passport-v3). |

==================================================
Отчёт:
  Всего выбрано ID: 16
  Перечень:
    - A.1.04.01
    - A.1.06.01
    - A.1.07.01
    - C.0.01.03
    - C.0.04.02
    - C.0.06.02
    - C.0.06.03
    - C.0.06.04
    - C.0.06.05
    - C.0.06.06
    - C.0.07.01
    - C.0.07.02
    - C.0.09.02
    - C.0.41.04
    - C.0.43.01
    - C.1.10.01
