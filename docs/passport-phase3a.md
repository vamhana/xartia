# docs/passport-phase3a.md

## 1. Скоуп Фазы 3a

**Обязательно:**

- **TaskProfile (§11.1)** — требования к задаче через атомы, а не свободный текст.
- **TeachingRelation per-atom (§12)** — кто кому и по какому атому может быть наставником; readiness (готовность обучать) вычисляется, не хранится.
- **17 направлений Хартии (§14)** — справочник + маппинг atom → direction {home, related} + фильтр каталога.
- **Matching (§11.2)** — соответствие участника задаче, кандидаты.
- **UI-панели:** TaskProfilePanel (в существующей /tasks), фильтр по направлениям в Passport, home/related в карточке атома.
- **Тест** scripts/test-passport-v4.ts + CI.

**Не входит в 3a (перенос в 3b/3c):**

| Что | Куда |
|---|---|
| Permit (§10.3) | 3b |
| TeamCapability (§11.4) | 3b |
| code-splitting UI (1.79 MB / 470 KB gzip) | 3b |
| Калибровка 0–9 (§6.5) | 3c |
| AI-рекомендации (§9.3, §16.6) | 3c |
| Полный интерактивный граф (§8.4) | 3c |
| practice_review_policy для оставшихся 50 атомов | 3c (вместе с калибровкой) |
| Педагогическая компетенция как отдельный атом | 3b/3c (нет в 54-пилоте) |

---

## 2. Карта: раздел паспорта → файл → тест → статус

### 2.1. TaskProfile

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 11.1 | task_profiles — расширение tasks через 1:1 (nullable FK) | db/migrations/060_passport_phase3a.sql | профиль создаётся | planned |
| 11.1 | required_atoms: [{atom_id, min:{U,X,D,P,E}, role}] — где role ∈ {executor, designer, consultant, assessor} | task_profiles.required_atoms jsonb + TaskProfile в src/core/passport/types.ts | валидация схемы в task-profile.ts | planned |
| 11.1 | permit_ids: UUID[] — допуски (пока не реализуем Permit, но поле есть) | task_profiles.permit_ids jsonb | поле принимается, но не валидируется | planned |
| 11.1 | acceptance_criteria, evidence_form, security_constraints | task_profiles.* jsonb | 3 поля | planned |
| 16.2 | POST /passport/tasks/:taskId/profile (только FIRST_ARCHITECT \| COUNCIL_MEMBER \| OTC, задача без профиля) | src/core/passport/task-profile.ts, controller.ts | создание + 403 | planned |
| 16.2 | GET /passport/tasks/:taskId/profile | task-profile.ts, controller.ts | возврат + 404 | planned |
| 11.1 | PATCH /passport/tasks/:taskId/profile (только создатель профиля или FIRST_ARCHITECT) | task-profile.ts, controller.ts | частичное обновление | planned |
| 19.3 | task_profiles.version — каждое изменение через version | task_profiles.version + task_profiles_history | версия инкрементится | planned |

**Логика TaskProfile:**

- tasks.required_competencies — не трогаем (legacy, используется tasks/service.ts).
- task_profiles — новая таблица, 1:1 с tasks. Старые задачи без профиля работают как раньше.
- GET /passport/tasks/:taskId/profile → 404 если профиля нет (UI TaskProfilePanel показывает «Профиль не задан»).
- required_atoms валидируется: все atom_id ∈ competency_atoms, min ∈ 0..9, role ∈ {executor, designer, consultant, assessor}.

### 2.2. TeachingRelation per-atom

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 12.1 | teaching_relations(mentor_id, mentee_id, atom_id, dimensions[], status, valid_from, valid_to, created_by) | db/migrations/060_... | 1 запись | planned |
| 12.1 | Заменяет participants.mentor_id в перспективе, но не удаляет его. participants.mentor_id = «основной наставник» (для совместимости) | teaching_relations рядом | обе структуры живут | planned |
| 12.2 | readiness — вычисляемая. Критерий: P ≥ 7 (depth_execution) + X ≥ 5 + E ≥ 5 по атому | src/core/passport/teaching.ts#computeReadiness | ready / not_ready / unknown | planned |
| 12.2 | Педагогическая компетенция — не отдельный атом в 3a (нет в 54-пилоте). readiness — грубый прокси, документируем это | teaching.ts | в UI — только readiness | planned |
| 16.5 | POST /passport/teaching/assign (mentor сам назначает mentee, если readiness='ready') | teaching.ts, controller.ts | создание + 403 | planned |
| 16.5 | GET /passport/teaching/mentors?atomId=... — список кандидатов с readiness | teaching.ts, controller.ts | список | planned |
| 16.5 | GET /passport/teaching/students — мои mentee | teaching.ts, controller.ts | список | planned |
| 18 | passport_access_log — mentor видит mentee (через ?scope=mentor), проверка teaching_relations + participants.mentor_id | visibility.ts#isMentor расширяется | mentor-atom → access_log | planned |
| 18.1 | Прекращение TeachingRelation = отзыв доступа | teaching.ts#revoke | 403 после revoke | planned |
| 15 | mentor_questions.atom_id — опциональная привязка к атому | миграция 060 | поле есть, старые NULL | planned |

**NB по participants.mentor_id:** остаётся «основным наставником» для совместимости с admin/controller.ts (assignMentorService). teaching_relations — per-atom детализация. ?scope=mentor проверяет: participants.mentor_id === viewer ИЛИ активная teaching_relations(subject, viewer, atom_id).

### 2.3. 17 направлений Хартии

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 14 | GET /passport/directions — 17 направлений | src/core/passport/directions.ts, controller.ts | 17 записей | planned |
| 14 | atom_direction_map(atom_id, direction_id, role, note) | db/migrations/060_... | FK-валидность | planned |
| 14 | role ∈ {home, main, related} — home = D09 для всех 54 (пилот); main — явный «владелец»; related — смежные | atom_direction_map | CHECK | planned |
| 14 | Сид: 54 атома → D09 (home); + маппинг related по кластерам (см. scripts/seed-data/direction_map.ts) | scripts/seed-data/directions.ts, seed-data/direction_map.ts | идемпотентно | planned |
| 14 | GET /passport/atoms/:atomId → directions: {home, main, related} | catalog.ts, controller.ts | 0032: home=9, related=[...] | planned |
| 14 | GET /passport/catalog?direction=N — фильтр | catalog.ts, controller.ts | 54 при N=9; меньше при N=6 | planned |
| 8.4 | UI: `<select>` направления в Passport «Каталог» | Passport.tsx | фильтр работает | planned |
| 8.4 | UI: блок home/related в AtomCard | AtomCard.tsx | видно | planned |

**Маппинг related (дефолт, A24):**

- requirements_and_computational_thinking → related: [6 (Ноология), 14 (Знание и Образование)]
- software_development → related: []
- data_and_databases → related: []
- server_interfaces_and_api → related: []
- testing_and_quality → related: [13 (Верификация)]
- software_security → related: [13]
- infrastructure_and_operations → related: [15 (Внешний шлюз), 16 (Сетевая экосистема)]

main = home для пилота (кроме явного переопределения — нет).

### 2.4. Matching

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 11.2 | GET /passport/tasks/:taskId/matching?participantId=... — соответствие участника | src/core/passport/matching.ts, controller.ts | 3 статуса: match / partial / no_match | planned |
| 11.2 | match: все required_atoms покрыты (для каждой роли — соответствующие атомы с min по измерениям) | matching.ts | тест с полным покрытием | planned |
| 11.2 | partial: часть покрыта, есть gaps: [{atomId, missingDimensions: [...], role}] | matching.ts | тест | planned |
| 11.2 | no_match: критический gap (роль executor с P < min) | matching.ts | тест | planned |
| 11.2 | GET /passport/tasks/:taskId/candidates?limit=20 — top-N участников | matching.ts, controller.ts | список | planned |
| 11.2 | Кандидаты не раскрывают уровни (participantId + matches), уровни — через ?scope=task | matching.ts + resolveScopeGrant | 403 без scope | planned |
| 18.2 | Запись в passport_access_log при candidates | matching.ts | access_log пополняется | planned |
| 8.4 | UI: MatchingPanel — «кандидаты на задачу» | src/web/components/passport/MatchingPanel.tsx (новый) | видно | planned |

**Алгоритм matching:**

- Для каждого required_atoms[i]: берём person_atom_states по participantId, для каждой применимой dimension — проверяем level >= min[dimension] и status ∈ {confirmed, provisional}.
- role = executor — критично P; role = assessor — критично E; role = designer — критично D; role = consultant — критично U/X.
- Агрегация: match — все проверки пройдены; partial — есть gaps в не-критичных полях; no_match — критичный gap.
- Кандидаты: SQL по person_atom_states с фильтром, top-N по числу совпавших атомов (без критичных gaps).

### 2.5. Расширения mentor_questions (опционально)

| Что | Файл | Тест | Статус |
|---|---|---|---|
| mentor_questions.atom_id UUID REFERENCES competency_atoms(atom_id) — nullable | миграция 060 | поле есть | planned |
| POST /passport/teaching/questions — задать вопрос per-atom ментору | teaching.ts, controller.ts | создаётся с atom_id | planned |
| GET /passport/teaching/questions — мои вопросы | teaching.ts, controller.ts | список | planned |
| GET /passport/teaching/mentor-questions — вопросы ко мне как mentor'у | teaching.ts, controller.ts | список | planned |

Если в 3a не влезет — этот блок переносим в 3b (это не критично, mentor_questions работает и без atom_id).

---

## 3. A-пункты (открытые вопросы к Архитектору, с дефолтами)

| # | Вопрос | Дефолт |
|---|---|---|
| A19 | TaskProfile — расширение tasks или новая таблица? | Новая task_profiles (1:1, FK на tasks.id, nullable). tasks не трогаем. tasks.required_competencies остаётся legacy. |
| A20 | required_atoms[i].role — per-atom или на уровне профиля? | Per-atom. role ∈ {executor, designer, consultant, assessor}. |
| A21 | Matching — что отдаём в API? | matching → {status, gaps, checkedCount, coverage}. candidates → top-N {participantId, matches, gaps}. Уровни — только через ?scope=task. |
| A22 | TeachingRelation — заменяет participants.mentor_id? | Нет. Обе структуры живут. participants.mentor_id = «основной наставник». teaching_relations = per-atom детализация. ?scope=mentor проверяет оба. |
| A23 | readiness — вычисляемое или хранимое? | Вычисляемое. Критерий: P≥7 + X≥5 + E≥5 по атому. Педагогическая компетенция — не реализуем в 3a. UI показывает ready / not_ready / unknown. |
| A24 | atom_direction_map — как заполнять? | Сид: home = 9 для всех 54; related — по кластерам (см. §2.3 выше). main = home в 3a. |
| A25 | UI для 17 направлений — какой уровень? | Фильтр в каталоге + home/related в карточке атома. Отдельной страницы /passport/directions нет (перенос в 3b — там полный граф). |
| A26 | task_profiles — сид или ручное? | Ручное через API. Нет реальных задач с профилями для сида. |
| A27 | tasks/service.ts — трогаем? | Нет. task_profiles — отдельная таблица, API — отдельные роуты. TaskProfilePanel — новый компонент в /tasks. |
| A28 | mentor_questions.atom_id — да? | Да, nullable. Старые вопросы без atom_id работают как раньше. |
| A29 | candidates — источник данных? | SQL по person_atom_states + competency_atoms.dimension_applicability. Top-N. Уровни скрыты. access_log — пополняется. |
| A30 | UI TaskProfile — где? | TaskProfilePanel в /tasks (вкладка «Требования»). MatchingPanel — отдельный компонент, вызывается из /tasks/:id. |
| A31 | POST /passport/tasks/:taskId/profile — кто? | FIRST_ARCHITECT \| COUNCIL_MEMBER \| OTC, только для задач без профиля (иначе 409) или через PATCH (создатель профиля или FIRST_ARCHITECT). |
| A32 | version для task_profiles — как? | version INT NOT NULL DEFAULT 1. PATCH инкрементит. task_profiles_history — append-only, по аналогии с passport_history_events. |

Если ответов не будет — иду по дефолтам и фиксирую в §«Изменения плана» шага 12.

---

## 4. Порядок работ (вертикальный срез)

| Шаг | Что | Файлы |
|---|---|---|
| 1 | Миграция 060: task_profiles (+ history), teaching_relations, atom_direction_map, mentor_questions.atom_id, passport_history_events.event_type += task_profile_created/updated, teaching_relation_created/revoked | db/migrations/060_passport_phase3a.sql |
| 2 | Seed: 17 направлений + atom_direction_map (54 × home + related). Идемпотентно | scripts/seed-data/directions.ts, seed-data/direction_map.ts, scripts/seed-passport.ts (расширить) |
| 3 | GET /passport/directions, GET /passport/catalog?direction=, GET /passport/atoms/:atomId → directions | src/core/passport/directions.ts, catalog.ts, controller.ts, UI Passport.tsx, AtomCard.tsx |
| **Чек-поинт 1** | Направления и фильтр работают; test-passport-v4.ts (каркас, шаг 3) — зелёный | — |
| 4 | TaskProfile: core + API + UI (TaskProfilePanel в /tasks) | src/core/passport/task-profile.ts, controller.ts, src/web/components/passport/TaskProfilePanel.tsx, src/web/pages/Tasks.tsx |
| 5 | TeachingRelation: core + API + UI (TeachingPanel в Passport — вкладка «Наставничество»), расширение visibility.ts#isMentor | src/core/passport/teaching.ts, controller.ts, src/web/components/passport/TeachingPanel.tsx, src/web/pages/Passport.tsx |
| 6 | Matching: core + API + UI (MatchingPanel) | src/core/passport/matching.ts, controller.ts, src/web/components/passport/MatchingPanel.tsx |
| **Чек-поинт 2** | P0-часть 3a (TaskProfile + TeachingRelation + Matching) — работают; test-passport-v4.ts (P0) — зелёный | — |
| 7 | (Опционально, если влезает) mentor_questions.atom_id + 3 API-роута | teaching.ts |
| 8 | test-passport-v4.ts (полный) + регистрация в ci-local.ps1 / ci.yml «Smoke — паспорт v4» | scripts/test-passport-v4.ts |
| 9 | Финальный прогон + отчёт в docs/passport-phase3a.md §«Изменения плана» | — |

Если 3a не влезает целиком — останавливаемся после чек-поинта 2 (шаги 1–6). mentor_questions.atom_id и test-v4 — отдельной итерацией. Честный отчёт с «не сделано».

---

## 5. Критерии готовности Фазы 3a

- [ ] POST /passport/tasks/:taskId/profile → 201; GET → 200; PATCH → 200 + version++.
- [ ] POST /passport/tasks/:taskId/profile при существующем профиле → 409.
- [ ] POST /passport/tasks/:taskId/profile без прав (VERIFIER, BALANCER) → 403.
- [ ] required_atoms валидация: несуществующий atom_id → 422; min=10 → 422.
- [ ] GET /passport/tasks/:taskId/matching?participantId=... → 3 статуса (match / partial / no_match), gaps[] с missingDimensions.
- [ ] GET /passport/tasks/:taskId/candidates → top-N, участники без раскрытых уровней.
- [ ] candidates без ?scope=task у чужого → participantId есть, уровней нет.
- [ ] access_log пополняется при candidates.
- [ ] POST /passport/teaching/assign → 201; GET /passport/teaching/students → 200.
- [ ] GET /passport/teaching/mentors?atomId=... — readiness: ready / not_ready / unknown.
- [ ] POST /passport/teaching/assign при readiness='not_ready' → 403 (с readiness в details).
- [ ] ?scope=mentor для mentee: с participants.mentor_id → 200; с teaching_relations per-atom → 200; после revoke → 403.
- [ ] GET /passport/directions → 17 записей.
- [ ] GET /passport/atoms/CYB.ATOM.0032 → directions: {home: 9, main: 9, related: [...]}.
- [ ] GET /passport/catalog?direction=9 → 54 атома.
- [ ] GET /passport/catalog?direction=6 → атомы related для D06.
- [ ] UI: TaskProfilePanel в /tasks, фильтр направлений в Passport → «Каталог», home/related в карточке атома.
- [ ] pnpm typecheck, pnpm typecheck:web, pnpm exec vite build — зелёные.
- [ ] test-passport-v2.ts (16/16), test-passport-v3.ts (46/46) — не сломаны.
- [ ] test-passport-v4.ts — 0 failed, 0 skipped.
- [ ] CI: «Smoke — паспорт v4» в ci-local.ps1 + ci.yml.

---

## 6. Что НЕ входит в 3a (напоминание)

Permit, TeamCapability, code-splitting, калибровка 0–9, AI-рекомендации, полный граф, practice_review_policy для оставшихся 50 атомов, педагогическая компетенция как отдельный атом — всё в 3b/3c.

**Не трогаем:**

- PassportFull, /me/passport контракт.
- tasks, tasks/service.ts, reports, otc_decisions, otc_criteria, otc_escalations — работает как есть.
- participants.mentor_id — не удаляем.
- participant_competencies.
- Миграции ≤ 059.
- scripts/test-passport.ts, test-passport-v2.ts, test-passport-v3.ts — не меняем (кроме одной строки в шапке v3 если понадобится — как с v2).

---

## 7. Оценка объёма

| Блок | Строк (approx) |
|---|---|
| Миграция 060 | ~120 |
| Seed directions + map | ~200 |
| task-profile.ts | ~200 |
| teaching.ts | ~180 |
| directions.ts | ~80 |
| matching.ts | ~180 |
| API (controller + схемы) | ~280 |
| UI (TaskProfilePanel, TeachingPanel, MatchingPanel, правки Passport.tsx/Tasks.tsx/AtomCard.tsx) | ~600 |
| test-passport-v4.ts | ~350 |
| scripts/lib/passport-fixtures.ts (расширение) | ~100 |
| **Итого** | **~2300** |

Риск не влезть в один заход — средний. Вертикальный срез (шаги 1–6) реалистичен. mentor_questions.atom_id + полный test-v4 + CI — вторая итерация.

## Изменения плана

**2026-11-04.** Фаза 3a (P0: directions + task_profile + teaching + matching)
реализована. Актуальные статусы ниже; таблицы §2 остаются в исходном виде
(они отражают план, а не факт).

### Сделано (файлы)

**Миграции:**
- `db/migrations/060_passport_phase3a.sql`:
  - `task_profiles` (1:1 с `tasks`, `tasks.required_competencies` не тронут);
  - `task_profiles_history` (append-only через триггер);
  - `teaching_relations` (per-atom mentor, `participants.mentor_id`
    сохранён как «основной наставник»);
  - `atom_direction_map` (17 направлений × 54 атома × role ∈ `home|main|related`);
  - `mentor_questions.atom_id` (nullable FK);
  - `passport_history_events.event_type` — расширен
    (`task_profile_created/updated`, `teaching_relation_created/revoked`).

**Домен:**
- `src/core/passport/directions.ts` — новый. `getDirections`,
  `getAtomDirections` (home/main/related).
- `src/core/passport/task-profile.ts` — новый. `getTaskProfile`,
  `createTaskProfile`, `updateTaskProfile` (version++, history append-only).
  Валидация `required_atoms`: atom_id, role, min 0..9, non-empty.
  Роли автора: `FIRST_ARCHITECT | COUNCIL_MEMBER | OTC`.
- `src/core/passport/teaching.ts` — новый. `computeReadiness`
  (`P≥7 + X≥5 + E≥5`, вычисляемое, `ready|not_ready|unknown`),
  `assignRelation`, `revokeRelation` (mentor или FIRST_ARCHITECT),
  `getMentorsForAtom` (с readiness), `getStudentsForMentor`,
  `getMentorsForMentee` (primary + per_atom).
- `src/core/passport/matching.ts` — новый. `matchTask` (self / чужой),
  `getCandidates` (top-N, без критичных gaps), `recordAccess`
  (`reason='matching'|'candidates'`).
  Роли → критические измерения: `executor→P`, `assessor→E`,
  `designer→D`, `consultant→U,X`. `match|partial|no_match`.
- `src/core/passport/catalog.ts` — расширен `direction` в `CatalogQuery`.
- `src/core/passport/visibility.ts` — `isMentor` расширен:
  `participants.mentor_id === viewer` **ИЛИ** активная `teaching_relation`.
- `src/core/passport/types.ts` — DTO Фазы 3a:
  `TaskProfile`, `RequiredAtom`, `TeachingRelation`, `ReadinessResult`,
  `AtomDirections`, `DirectionRef`, `MatchGap`, `TaskMatching`,
  `TaskCandidate`, `HistoryEventType` += 4 типа.

**API (аддитивно, 12 новых путей):**
- `GET /passport/directions`
- `GET /passport/catalog?direction=N`
- `GET /passport/atoms/:atomId` — расширен `directions`
- `GET /passport/tasks/:taskId/profile`
- `POST /passport/tasks/:taskId/profile`
- `PATCH /passport/tasks/:taskId/profile`
- `GET /passport/tasks/:taskId/matching?participantId=...`
- `GET /passport/tasks/:taskId/candidates?limit=N`
- `GET /passport/teaching/students`
- `GET /passport/teaching/mentors-for-me`
- `GET /passport/teaching/mentors?atomId=...`
- `GET /passport/teaching/my-readiness?atomId=...`
- `POST /passport/teaching/assign`
- `POST /passport/teaching/:relationId/revoke`

**UI:**
- `src/web/pages/Passport.tsx` — вкладка «Наставничество» + `<TeachingPanel />`.
- `src/web/pages/TaskProfilePage.tsx` — новая. Роут `/tasks/:id/profile`.
- `src/web/components/passport/TaskProfilePanel.tsx` — новый. Просмотр
  профиля + inline JSON-редактор `requiredAtoms`.
- `src/web/components/passport/TeachingPanel.tsx` — новый. Ученики /
  наставники / кандидаты + readiness.
- `src/web/components/passport/MatchingPanel.tsx` — новый. Моё соответствие
  + кандидаты (без раскрытия уровней).
- `src/web/components/passport/AtomCard.tsx` — Card «Направления»
  (home/main/related).
- `src/web/components/tasks/TaskCard.tsx` — кнопка «Профиль требований»
  (`onProfile?`).
- `src/web/pages/Tasks.tsx` — навигация на `/tasks/:id/profile`.
- `src/web/App.tsx` — роут `/tasks/:id/profile`.
- `src/web/types.ts` — DTO Фазы 3a (направления, task_profile, teaching,
  matching).

**Сид/данные:**
- `scripts/seed-data/directions.ts` — новый. Справочник 17 направлений
  (sanity-check; `directions` в БД создаёт миграция/bootstrap).
- `scripts/seed-data/direction_map.ts` — новый. Маппинг home/main = D09,
  related по кластерам.
- `scripts/seed-passport.ts` — расширен: `upsertDirectionMap` (идемпотентно,
  `ON CONFLICT DO NOTHING`).
  - Итог: `atom_direction_map` = 160 (home=54, main=54, related=52).

**Тесты/CI:**
- `scripts/lib/passport-fixtures.ts` — расширен:
  `createTask`, `createTaskProfile`, `patchTaskProfile`,
  `assignTeaching`, `revokeTeaching`.
- `scripts/test-passport-v4.ts` — новый. Покрывает:
  1. directions (17, фильтры 9/13/6/15/16, atom 0032 home=9 + related 13);
  2. task_profile (403 без роли, 201, 409 duplicate, version 1→2,
     422 bad atom, history created+updated);
  3. teaching (assign без readiness → 403, readiness=ready, assign 201,
     students, mentors-for-me per_atom, `?scope=mentor` grant/deny);
  4. matching (self, candidates array, чужой + access_log);
  5. revoke + idempotent revoke + `?scope=mentor` 403 после.
- `scripts/smoke-passport-teaching.ts` — новый (не в CI). Полный
  teaching-флоу end-to-end.
- `scripts/ci-local.ps1` — `smoke: passport-v4` после v3.
- `.github/workflows/ci.yml` — «Smoke — паспорт v4».

### Решения (A19–A32)

- **A19**: `task_profiles` — новая таблица (1:1 с `tasks`),
  `tasks.required_competencies` (legacy JSONB) не тронут.
- **A20**: `required_atoms[i].role` per-atom
  (`executor|designer|consultant|assessor`).
- **A21**: `matching` → `{status, gaps, checkedCount, coverage}`;
  `candidates` — top-N `{participantId, matches, gaps, status}`,
  без раскрытия уровней (только через `?scope=task`).
- **A22**: `teaching_relations` — per-atom детализация;
  `participants.mentor_id` = «основной наставник» (живут параллельно).
  `?scope=mentor` проверяет оба.
- **A23**: `readiness` — вычисляемое (`P≥7 + X≥5 + E≥5`).
  Педагогическая компетенция как отдельный атом — Фаза 3b/3c.
- **A24**: `atom_direction_map` — home/main = D09 для всех 54;
  related: requirements→[6,14], testing/security→[13],
  infra→[15,16], software/data/api→[].
- **A25**: UI 17 направлений — `<select>` в каталоге + Card
  «Направления» в `AtomCard`. Отдельной страницы `/passport/directions`
  нет (перенос в 3b вместе с полным графом).
- **A26**: `task_profiles` — ручное через API (нет сида).
- **A27**: `tasks/service.ts` не тронут; `TaskProfilePanel` —
  отдельный компонент в `/tasks/:id/profile`.
- **A28**: `mentor_questions.atom_id` — nullable; 3 API-роута для Q&A
  per-atom — **не в 3a** (перенос в 3b).
- **A29**: `candidates` — SQL по `person_atom_states` + EXISTS (не JOIN
  DISTINCT), top-N, уровни скрыты, `access_log` пополняется.
- **A30**: `TaskProfilePanel` в `/tasks/:id/profile`, `MatchingPanel`
  там же.
- **A31**: `POST /passport/tasks/:taskId/profile` —
  `FIRST_ARCHITECT | COUNCIL_MEMBER | OTC`; `PATCH` — создатель или
  те же роли.
- **A32**: `task_profiles.version` — INT DEFAULT 1; `PATCH` инкрементит;
  `task_profiles_history` — append-only (триггер).

### Не сделано (осознанно, Фаза 3b/3c)

- `mentor_questions.atom_id` API — 3b.
- `Permit` (§10.3) — 3b.
- `TeamCapability` (§11.4) — 3b.
- `code-splitting` UI (1.79 MB / 470 KB gzip) — 3b.
- Калибровка 0–9 (anchor examples, сессии, §6.5) — 3c.
- AI-рекомендации (§9.3, §16.6) — 3c.
- Полный интерактивный граф (§8.4) — 3c.
- `practice_review_policy` для оставшихся 50 атомов — 3c.
- Педагогическая компетенция как отдельный атом — 3b/3c.
- `required_atoms.permit_ids` — принимается в теле, не валидируется
  (Permit — 3b).

### Технический долг

- `safeUuid` в `src/web/lib/uuid.ts` — был добавлен до Фазы 3a
  (blocker для UI-POST из insecure context / LAN IP). Применён в
  `src/web/api/client.ts`.
- `getCandidates` — `SELECT EXISTS` вместо `JOIN DISTINCT` (fix SQL
  `ORDER BY` в `DISTINCT`).
- `computeReadiness` — без педагогической компетенции (прокси по
  `P+X+E`). Педагогическая компетенция — 3b.
- `atom_direction_map.related` — архитектурная гипотеза (не утверждённый
  маппинг Хартии). Уточнения — через «Коннект» (§14, §19.5).

### Тесты и CI

- `pnpm typecheck` / `pnpm typecheck:web` — зелёные.
- `pnpm exec vite build` — success (warning chunk size — не блокер).
- `pnpm tsx scripts/test-passport.ts` — зелёный (старый контракт).
- `pnpm tsx scripts/test-passport-v2.ts` — 16/16 PASS, 0 skipped.
- `pnpm tsx scripts/test-passport-v3.ts` — 46/46 PASS, 0 skipped.
- `pnpm tsx scripts/test-passport-v4.ts` — **0 failed, 0 skipped**.
- `pnpm tsx scripts/smoke-passport-teaching.ts` — 12/12 PASS.
- `bash scripts/smoke-passport.sh` — зелёный.
- CI: `scripts/ci-local.ps1` — `smoke: passport-v4` зарегистрирован;
  `.github/workflows/ci.yml` — шаг «Smoke — паспорт v4».

### Как проверять (актуальные команды)

```bash
# Миграции (после 058/059)
pnpm db:migrate

# Сид (идемпотентно; 17 направлений × 54 атома)
pnpm tsx scripts/seed-passport.ts
pnpm tsx scripts/seed-passport.ts   # → inserted=0, skipped=160

# Типы и сборка
pnpm typecheck
pnpm typecheck:web
pnpm exec vite build

# Тесты
pnpm tsx scripts/test-passport.ts    "+79001234567" "ChangeMe123456"
pnpm tsx scripts/test-passport-v2.ts
pnpm tsx scripts/test-passport-v3.ts
pnpm tsx scripts/test-passport-v4.ts
pnpm tsx scripts/smoke-passport-teaching.ts

# Smoke
bash scripts/smoke-passport.sh
