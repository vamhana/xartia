# Единый план: паспорт — фазы 3a, 3b, 3d, 3e

> Фаза 3c в предоставленных материалах отсутствует. В развилках она указана как пропущенное звено.
> Принимаем дефолт: **TeamCapability, калибровка 0–9 (контент), AI, полный граф → 3c** (нет в материалах).
> **3d** — калибровка-инфраструктура без контента + полный граф + техдолг.
> **3e** — техдолги + метаданные калибровки + TeamCapability matching, **без AI**.
> **3f** — AI-рекомендации, по запросу (нужен LLM-провайдер).
> **Трек «каталог v0.4»** — педагогическая компетенция как атом + anchor'ы (контент).

## 0. Сводная развилка

| Блок | Куда |
|---|---|
| TaskProfile, TeachingRelation per-atom, 17 направлений, Matching, UI-панели, test-v4 | **3a** |
| Permit, `mentor_questions.atom_id` API, code-splitting, test-v5 | **3b** |
| TeamCapability, калибровка 0–9 (контент), AI, полный граф | **3c** (нет в материалах) |
| Калибровка-инфраструктура без контента, полный интерактивный граф, техдолг 3c, test-v7 | **3d** |
| criteria_version, calibration stats, TeamCapability matching, updateTeam+status, deprecate `participant_competencies`, test-v8 | **3e** |
| AI-рекомендации (LLM-провайдер, RAG, безопасность) | **3f** по запросу |
| Педагогическая компетенция как атом, дополнение каталога | отдельный трек «каталог v0.4» |

> **Честная оговорка (из 3e, §2.8):** 3e не даёт пользователям новой ценности — только техдолги и метаданные. Если 3e не влезет — не провал; если влезет — «стало чище». По приоритету 3e — последняя. Но план — вот он.

---

# Фаза 3a

## 1. Скоуп Фазы 3a

**Обязательно:**

- **TaskProfile (§11.1)** — требования к задаче через атомы, а не свободный текст.
- **TeachingRelation per-atom (§12)** — кто кому и по какому атому может быть наставником; readiness вычисляется, не хранится.
- **17 направлений Хартии (§14)** — справочник + маппинг `atom → direction {home, related}` + фильтр каталога.
- **Matching (§11.2)** — соответствие участника задаче, кандидаты.
- **UI-панели:** `TaskProfilePanel` в `/tasks`, фильтр по направлениям в Passport, home/related в карточке атома.
- **Тест:** `scripts/test-passport-v4.ts` + CI.

**Не входит в 3a:**

| Что | Куда |
|---|---|
| Permit (§10.3) | 3b |
| TeamCapability (§11.4) | 3b / 3c |
| code-splitting UI (1.79 MB / 470 KB gzip) | 3b |
| Калибровка 0–9 (§6.5) | 3c / 3d |
| AI-рекомендации (§9.3, §16.6) | 3c / 3f |
| Полный интерактивный граф (§8.4) | 3c / 3d |
| `practice_review_policy` для оставшихся 50 атомов | 3c, вместе с калибровкой |
| Педагогическая компетенция как отдельный атом | 3b/3c, нет в 54-пилоте |

## 2. Карта Фазы 3a

### 2.1. TaskProfile

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 11.1 | `task_profiles` — расширение `tasks` через 1:1, nullable FK | `db/migrations/060_passport_phase3a.sql` | профиль создаётся | planned |
| 11.1 | `required_atoms: [{atom_id, min:{U,X,D,P,E}, role}]`, где `role ∈ {executor, designer, consultant, assessor}` | `task_profiles.required_atoms jsonb` + `TaskProfile` в `src/core/passport/types.ts` | валидация схемы в `task-profile.ts` | planned |
| 11.1 | `permit_ids: UUID[]` — допуски; Permit пока не реализуем, но поле есть | `task_profiles.permit_ids jsonb` | поле принимается, но не валидируется | planned |
| 11.1 | `acceptance_criteria`, `evidence_form`, `security_constraints` | `task_profiles.* jsonb` | 3 поля | planned |
| 16.2 | `POST /passport/tasks/:taskId/profile` — только `FIRST_ARCHITECT / COUNCIL_MEMBER / OTC`, задача без профиля | `src/core/passport/task-profile.ts`, `controller.ts` | создание + 403 | planned |
| 16.2 | `GET /passport/tasks/:taskId/profile` | `task-profile.ts`, `controller.ts` | возврат + 404 | planned |
| 11.1 | `PATCH /passport/tasks/:taskId/profile` — только создатель профиля или `FIRST_ARCHITECT` | `task-profile.ts`, `controller.ts` | частичное обновление | planned |
| 19.3 | `task_profiles.version` — каждое изменение через version | `task_profiles.version` + `task_profiles_history` | версия инкрементится | planned |

**Логика TaskProfile:**

- `tasks.required_competencies` не трогаем: legacy, используется `tasks/service.ts`.
- `task_profiles` — новая таблица, 1:1 с `tasks`. Старые задачи без профиля работают как раньше.
- `GET /passport/tasks/:taskId/profile` → 404, если профиля нет; UI `TaskProfilePanel` показывает «Профиль не задан».
- `required_atoms` валидируется: все `atom_id ∈ competency_atoms`, `min ∈ 0..9`, `role ∈ {executor, designer, consultant, assessor}`.

### 2.2. TeachingRelation per-atom

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 12.1 | `teaching_relations(mentor_id, mentee_id, atom_id, dimensions[], status, valid_from, valid_to, created_by)` | `db/migrations/060_...` | 1 запись | planned |
| 12.1 | Заменяет `participants.mentor_id` в перспективе, но не удаляет его. `participants.mentor_id` = «основной наставник» для совместимости | `teaching_relations` рядом | обе структуры живут | planned |
| 12.2 | readiness — вычисляемая. Критерий: `P ≥ 7` (depth_execution) + `X ≥ 5` + `E ≥ 5` по атому | `src/core/passport/teaching.ts#computeReadiness` | `ready / not_ready / unknown` | planned |
| 12.2 | Педагогическая компетенция — не отдельный атом в 3a, нет в 54-пилоте. readiness — грубый прокси, документируем это | `teaching.ts` | в UI только readiness | planned |
| 16.5 | `POST /passport/teaching/assign` — mentor сам назначает mentee, если `readiness='ready'` | `teaching.ts`, `controller.ts` | создание + 403 | planned |
| 16.5 | `GET /passport/teaching/mentors?atomId=...` — список кандидатов с readiness | `teaching.ts`, `controller.ts` | список | planned |
| 16.5 | `GET /passport/teaching/students` — мои mentee | `teaching.ts`, `controller.ts` | список | planned |
| 18 | `passport_access_log` — mentor видит mentee через `?scope=mentor`, проверка `teaching_relations` + `participants.mentor_id` | `visibility.ts#isMentor` расширяется | mentor-atom → access_log | planned |
| 18.1 | Прекращение TeachingRelation = отзыв доступа | `teaching.ts#revoke` | 403 после revoke | planned |
| 15 | `mentor_questions.atom_id` — опциональная привязка к атому | миграция 060 | поле есть, старые NULL | planned |

**NB по `participants.mentor_id`:** остаётся «основным наставником» для совместимости с `admin/controller.ts` (`assignMentorService`). `teaching_relations` — per-atom детализация. `?scope=mentor` проверяет: `participants.mentor_id === viewer` ИЛИ активная `teaching_relations(subject, viewer, atom_id)`.

### 2.3. 17 направлений Хартии

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 14 | `GET /passport/directions` — 17 направлений | `src/core/passport/directions.ts`, `controller.ts` | 17 записей | planned |
| 14 | `atom_direction_map(atom_id, direction_id, role, note)` | `db/migrations/060_...` | FK-валидность | planned |
| 14 | `role ∈ {home, main, related}`: home = D09 для всех 54, пилот; main — явный «владелец»; related — смежные | `atom_direction_map` | CHECK | planned |
| 14 | Сид: 54 атома → D09 (home); + маппинг related по кластерам, см. `scripts/seed-data/direction_map.ts` | `scripts/seed-data/directions.ts`, `seed-data/direction_map.ts` | идемпотентно | planned |
| 14 | `GET /passport/atoms/:atomId` → `directions: {home, main, related}` | `catalog.ts`, `controller.ts` | 0032: home=9, related=[...] | planned |
| 14 | `GET /passport/catalog?direction=N` — фильтр | `catalog.ts`, `controller.ts` | 54 при N=9; меньше при N=6 | planned |
| 8.4 | UI: `<select>` направления в Passport «Каталог» | `Passport.tsx` | фильтр работает | planned |
| 8.4 | UI: блок home/related в AtomCard | `AtomCard.tsx` | видно | planned |

**Маппинг related (дефолт, A24):**

- `requirements_and_computational_thinking` → related: `[6 (Ноология), 14 (Знание и Образование)]`
- `software_development` → related: `[]`
- `data_and_databases` → related: `[]`
- `server_interfaces_and_api` → related: `[]`
- `testing_and_quality` → related: `[13 (Верификация)]`
- `software_security` → related: `[13]`
- `infrastructure_and_operations` → related: `[15 (Внешний шлюз), 16 (Сетевая экосистема)]`

`main = home` для пилота, кроме явного переопределения — нет.

### 2.4. Matching

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 11.2 | `GET /passport/tasks/:taskId/matching?participantId=...` — соответствие участника | `src/core/passport/matching.ts`, `controller.ts` | 3 статуса: match / partial / no_match | planned |
| 11.2 | match: все `required_atoms` покрыты; для каждой роли — соответствующие атомы с min по измерениям | `matching.ts` | тест с полным покрытием | planned |
| 11.2 | partial: часть покрыта, есть `gaps: [{atomId, missingDimensions: [...], role}]` | `matching.ts` | тест | planned |
| 11.2 | no_match: критический gap, роль executor с `P < min` | `matching.ts` | тест | planned |
| 11.2 | `GET /passport/tasks/:taskId/candidates?limit=20` — top-N участников | `matching.ts`, `controller.ts` | список | planned |
| 11.2 | Кандидаты не раскрывают уровни: `participantId + matches`; уровни — через `?scope=task` | `matching.ts` + `resolveScopeGrant` | 403 без scope | planned |
| 18.2 | Запись в `passport_access_log` при candidates | `matching.ts` | access_log пополняется | planned |
| 8.4 | UI: MatchingPanel — «кандидаты на задачу» | `src/web/components/passport/MatchingPanel.tsx` новый | видно | planned |

**Алгоритм matching:**

- Для каждого `required_atoms[i]`: берём `person_atom_states` по `participantId`, для каждой применимой dimension проверяем `level >= min[dimension]` и `status ∈ {confirmed, provisional}`.
- `role = executor` — критично P; `role = assessor` — критично E; `role = designer` — критично D; `role = consultant` — критично U/X.
- Агрегация: match — все проверки пройдены; partial — есть gaps в не-критичных полях; no_match — критичный gap.
- Кандидаты: SQL по `person_atom_states` с фильтром, top-N по числу совпавших атомов без критичных gaps.

### 2.5. Расширения mentor_questions (опционально)

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `mentor_questions.atom_id UUID REFERENCES competency_atoms(atom_id)` — nullable | миграция 060 | поле есть | planned |
| `POST /passport/teaching/questions` — задать вопрос per-atom ментору | `teaching.ts`, `controller.ts` | создаётся с atom_id | planned |
| `GET /passport/teaching/questions` — мои вопросы | `teaching.ts`, `controller.ts` | список | planned |
| `GET /passport/teaching/mentor-questions` — вопросы ко мне как mentor'у | `teaching.ts`, `controller.ts` | список | planned |

Если в 3a не влезет — переносим в 3b: не критично, `mentor_questions` работает и без `atom_id`.

## 3. A-пункты Фазы 3a (A19–A32)

| # | Вопрос | Дефолт |
|---|---|---|
| A19 | TaskProfile — расширение `tasks` или новая таблица? | Новая `task_profiles` (1:1, FK на `tasks.id`, nullable). `tasks` не трогаем. `tasks.required_competencies` остаётся legacy. |
| A20 | `required_atoms[i].role` — per-atom или на уровне профиля? | Per-atom. `role ∈ {executor, designer, consultant, assessor}`. |
| A21 | Matching — что отдаём в API? | `matching → {status, gaps, checkedCount, coverage}`. `candidates → top-N {participantId, matches, gaps}`. Уровни — только через `?scope=task`. |
| A22 | TeachingRelation — заменяет `participants.mentor_id`? | Нет. Обе структуры живут. `participants.mentor_id` = «основной наставник». `teaching_relations` = per-atom детализация. `?scope=mentor` проверяет оба. |
| A23 | readiness — вычисляемое или хранимое? | Вычисляемое. Критерий: `P≥7 + X≥5 + E≥5` по атому. Педагогическая компетенция не реализуется в 3a. UI показывает `ready / not_ready / unknown`. |
| A24 | `atom_direction_map` — как заполнять? | Сид: home = 9 для всех 54; related — по кластерам. main = home в 3a. |
| A25 | UI для 17 направлений — какой уровень? | Фильтр в каталоге + home/related в карточке атома. Отдельной страницы `/passport/directions` нет. |
| A26 | `task_profiles` — сид или ручное? | Ручное через API. Нет реальных задач с профилями для сида. |
| A27 | `tasks/service.ts` — трогаем? | Нет. `task_profiles` — отдельная таблица, API — отдельные роуты. `TaskProfilePanel` — новый компонент в `/tasks`. |
| A28 | `mentor_questions.atom_id` — да? | Да, nullable. Старые вопросы без `atom_id` работают как раньше. |
| A29 | candidates — источник данных? | SQL по `person_atom_states` + `competency_atoms.dimension_applicability`. Top-N. Уровни скрыты. `access_log` пополняется. |
| A30 | UI TaskProfile — где? | `TaskProfilePanel` в `/tasks`, вкладка «Требования». `MatchingPanel` — отдельный компонент, вызывается из `/tasks/:id`. |
| A31 | `POST /passport/tasks/:taskId/profile` — кто? | `FIRST_ARCHITECT / COUNCIL_MEMBER / OTC`, только для задач без профиля, иначе 409; или через PATCH — создатель профиля или `FIRST_ARCHITECT`. |
| A32 | version для `task_profiles` — как? | `version INT NOT NULL DEFAULT 1`. PATCH инкрементит. `task_profiles_history` — append-only, по аналогии с `passport_history_events`. |

## 4. Порядок работ Фазы 3a

| Шаг | Что | Файлы |
|---|---|---|
| 1 | Миграция 060: `task_profiles` (+ history), `teaching_relations`, `atom_direction_map`, `mentor_questions.atom_id`, `passport_history_events.event_type += task_profile_created/updated, teaching_relation_created/revoked` | `db/migrations/060_passport_phase3a.sql` |
| 2 | Seed: 17 направлений + `atom_direction_map` (54 × home + related), идемпотентно | `scripts/seed-data/directions.ts`, `seed-data/direction_map.ts`, `scripts/seed-passport.ts` расширить |
| 3 | `GET /passport/directions`, `GET /passport/catalog?direction=`, `GET /passport/atoms/:atomId → directions` | `src/core/passport/directions.ts`, `catalog.ts`, `controller.ts`, UI `Passport.tsx`, `AtomCard.tsx` |
| **Чек-поинт 1** | Направления и фильтр работают; `test-passport-v4.ts` (каркас) — зелёный | — |
| 4 | TaskProfile: core + API + UI, `TaskProfilePanel` в `/tasks` | `src/core/passport/task-profile.ts`, `controller.ts`, `src/web/components/passport/TaskProfilePanel.tsx`, `src/web/pages/Tasks.tsx` |
| 5 | TeachingRelation: core + API + UI, `TeachingPanel` в Passport — вкладка «Наставничество», расширение `visibility.ts#isMentor` | `src/core/passport/teaching.ts`, `controller.ts`, `src/web/components/passport/TeachingPanel.tsx`, `src/web/pages/Passport.tsx` |
| 6 | Matching: core + API + UI, `MatchingPanel` | `src/core/passport/matching.ts`, `controller.ts`, `src/web/components/passport/MatchingPanel.tsx` |
| **Чек-поинт 2** | P0-часть 3a: TaskProfile + TeachingRelation + Matching работают; `test-passport-v4.ts` (P0) — зелёный | — |
| 7 | Опционально: `mentor_questions.atom_id` + 3 API-роута | `teaching.ts` |
| 8 | `test-passport-v4.ts` полный + регистрация в `ci-local.ps1` / `ci.yml` «Smoke — паспорт v4» | `scripts/test-passport-v4.ts` |
| 9 | Финальный прогон + отчёт в `docs/passport-phase3a.md` §«Изменения плана» | — |

Если 3a не влезает целиком — останавливаемся после чек-поинта 2 (шаги 1–6). `mentor_questions.atom_id` и `test-v4` — отдельной итерацией. Честный отчёт с «не сделано».

## 5. Критерии готовности Фазы 3a

- [ ] `POST /passport/tasks/:taskId/profile` → 201; GET → 200; PATCH → 200 + `version++`.
- [ ] `POST /passport/tasks/:taskId/profile` при существующем профиле → 409.
- [ ] `POST /passport/tasks/:taskId/profile` без прав (`VERIFIER`, `BALANCER`) → 403.
- [ ] `required_atoms` валидация: несуществующий `atom_id` → 422; `min=10` → 422.
- [ ] `GET /passport/tasks/:taskId/matching?participantId=...` → 3 статуса (`match / partial / no_match`), `gaps[]` с `missingDimensions`.
- [ ] `GET /passport/tasks/:taskId/candidates` → top-N, участники без раскрытых уровней.
- [ ] candidates без `?scope=task` у чужого → `participantId` есть, уровней нет.
- [ ] `access_log` пополняется при candidates.
- [ ] `POST /passport/teaching/assign` → 201; `GET /passport/teaching/students` → 200.
- [ ] `GET /passport/teaching/mentors?atomId=...` — readiness: `ready / not_ready / unknown`.
- [ ] `POST /passport/teaching/assign` при `readiness='not_ready'` → 403, с readiness в details.
- [ ] `?scope=mentor` для mentee: с `participants.mentor_id` → 200; с `teaching_relations` per-atom → 200; после revoke → 403.
- [ ] `GET /passport/directions` → 17 записей.
- [ ] `GET /passport/atoms/CYB.ATOM.0032` → `directions: {home: 9, main: 9, related: [...]}`.
- [ ] `GET /passport/catalog?direction=9` → 54 атома.
- [ ] `GET /passport/catalog?direction=6` → атомы related для D06.
- [ ] UI: `TaskProfilePanel` в `/tasks`, фильтр направлений в Passport → «Каталог», home/related в карточке атома.
- [ ] `pnpm typecheck`, `pnpm typecheck:web`, `pnpm exec vite build` — зелёные.
- [ ] `test-passport-v2.ts` (16/16), `test-passport-v3.ts` (46/46) — не сломаны.
- [ ] `test-passport-v4.ts` — 0 failed, 0 skipped.
- [ ] CI: «Smoke — паспорт v4» в `ci-local.ps1` + `ci.yml`.

## 6. Что НЕ входит в 3a

Permit, TeamCapability, code-splitting, калибровка 0–9, AI-рекомендации, полный граф, `practice_review_policy` для оставшихся 50 атомов, педагогическая компетенция как отдельный атом — всё в 3b/3c/3d/3e/3f.

**Не трогаем:**

- `PassportFull`, `/me/passport` контракт.
- `tasks`, `tasks/service.ts`, `reports`, `otc_decisions`, `otc_criteria`, `otc_escalations` — работает как есть.
- `participants.mentor_id` — не удаляем.
- `participant_competencies`.
- Миграции ≤ 059.
- `scripts/test-passport.ts`, `test-passport-v2.ts`, `test-passport-v3.ts` — не меняем, кроме одной строки в шапке v3 если понадобится, как с v2.

## 7. Оценка объёма Фазы 3a

| Блок | Строк, approx |
|---|---|
| Миграция 060 | ~120 |
| Seed directions + map | ~200 |
| `task-profile.ts` | ~200 |
| `teaching.ts` | ~180 |
| `directions.ts` | ~80 |
| `matching.ts` | ~180 |
| API, controller + схемы | ~280 |
| UI: TaskProfilePanel, TeachingPanel, MatchingPanel, правки Passport.tsx/Tasks.tsx/AtomCard.tsx | ~600 |
| `test-passport-v4.ts` | ~350 |
| `scripts/lib/passport-fixtures.ts` расширение | ~100 |
| **Итого** | **~2300** |

Риск не влезть в один заход — средний. Вертикальный срез (шаги 1–6) реалистичен. `mentor_questions.atom_id` + полный `test-v4` + CI — вторая итерация.

---

# Фаза 3b

## 1. Скоуп Фазы 3b

**Рекомендованный дефолт:**

- Permit (§10.3 паспорта) — схема + API + UI.
- `mentor_questions.atom_id` API — 3 роута, долг 3a.
- code-splitting UI — техдолг.

**Не входит в 3b:**

- TeamCapability → 3c, если дефолт.
- Калибровка 0–9 → 3c / 3d.
- AI-рекомендации, полный граф → 3c / 3d / 3f.
- Педагогическая компетенция как атом → отдельный трек «каталог v0.4».

## 2. Карта Фазы 3b

### 2.1. Permit (§10.3)

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 10.3 | `permits` — справочник допусков: `permit_id text PK`, `name`, `issued_by`, `scope`, `valid_until`, `verification_method`, `status ∈ {active, revoked, expired}` | `db/migrations/061_passport_phase3b.sql` | сид/CRUD | planned |
| 10.3 | `participant_permits` — выдача участнику: `participant_id`, `permit_id`, `issued_at`, `valid_until`, `verification_data jsonb`, `status ∈ {active, revoked, expired}` | `db/migrations/061_...` | FK + UNIQUE(active) | planned |
| 10.3 | Permit не выводится из `person_atom_states`: высокий уровень атома ≠ допуск. Правило фиксируется комментарием в `permits.ts` | `src/core/passport/permits.ts` новый | — | planned |
| 10.3 | `POST /passport/permits` — эмитент `FIRST_ARCHITECT` или `COUNCIL_MEMBER`; `issued_by = auth.participantId` | `permits.ts`, `controller.ts` | 201 + 403 | planned |
| 10.3 | `POST /passport/participants/:id/permits` — выдача; эмитент `FIRST_ARCHITECT` или `OTC`, либо сам `issued_by` permit'а | `permits.ts`, `controller.ts` | 201 + 403 | planned |
| 10.3 | `POST /passport/participant-permits/:id/revoke` | `permits.ts` | revoked + идемпотентно | planned |
| 10.3 | `GET /passport/permits` — справочник, public + active | `permits.ts`, `controller.ts` | список | planned |
| 10.3 | `GET /passport/participants/:id/permits` — допуски участника; для своего — все, для чужого — только active | `permits.ts`, `controller.ts` | свой/чужой | planned |
| 10.3 | `GET /passport/permits/for-task?taskId=N` — какие `permit_ids` требует `task_profiles` и у кого из кандидатов они есть | `permits.ts` | — | planned |
| 11.1 | `TaskProfile.permit_ids` теперь валидируется: все `permit_ids` должны существовать в `permits`; было — принимается без проверки | `task-profile.ts` | 422 на неизвестный | planned |
| 11.2 | Matching учитывает `permit_ids`: если у subject нет активного permit и требуется роль executor → `no_match`, критичный gap, `reason='missing_permit'` | `matching.ts` | gap с permit | planned |
| 8.4 | UI: `PermitsPanel` в Passport — «Мои допуски» + «Выдать допуск» для эмитентов | `src/web/components/passport/PermitsPanel.tsx` новый, `Passport.tsx` вкладка «Допуски» | видно | planned |

**Источники (`issued_by`):** строка свободного формата, например «внешний орган / профильное направление». В 3b без интеграций: `verification_method` = свободный текст, `verification_data` = JSONB для будущего.

### 2.2. mentor_questions.atom_id API — долг 3a, A28

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 12.4, 16.5 | `POST /passport/teaching/questions` — задать вопрос mentor'у по атому: `atomId?`, `mentorId?`, `question` | `teaching.ts` расширить, `controller.ts` | 201 | planned |
| 12.4 | `GET /passport/teaching/questions` — мои вопросы, `participant_id = auth` | `teaching.ts`, `controller.ts` | список | planned |
| 12.4 | `GET /passport/teaching/mentor-questions` — вопросы ко мне как mentor'у | `teaching.ts`, `controller.ts` | список | planned |
| 12.4 | `POST /passport/teaching/mentor-questions/:id/answer` — mentor → `mentor_questions.answer` | `teaching.ts`, `controller.ts` | 200 + 403 | planned |
| 12.4 | `atom_id` валидируется: должен существовать, nullable | `teaching.ts` | 422 | planned |

Если в 3b не влезает — этот блок переносим в 3c: роуты не критичны, `mentor_questions` работает и без `atom_id`.

### 2.3. code-splitting — техдолг 3a

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| — | `vite.config.ts`: `build.rollupOptions.output.manualChunks` — разбить вендоров по библиотекам: react, `@tanstack/react-query`, recharts/echarts/leaflet — по факту ревизии | `vite.config.ts` | `vite build` + размер | planned |
| — | Lazy-роуты, `React.lazy + Suspense`, для тяжёлых страниц: `/map-demo`, `/chart-demo`, `/constructor`, `/cells/map`, `/planetary`, `/experiments`, `/admin/*` | `src/web/App.tsx` | `vite build` + размер | planned |
| — | Замер до/после: `dist/web/assets/index-*.js`, сейчас 1 779 KB / 470 KB gzip; цель: main-chunk ≤ 600 KB / 200 KB gzip, остальное — lazy | ручной прогон `vite build` | числовой отчёт | planned |

Не гонимся за «≤ 500 KB одним чанком». Цель — разбить так, чтобы main-chunk грузился на каждой странице: роутинг, layout, auth; а тяжёлое — карты, чарты, крупные редакторы — только на своих страницах.

**Ревизия перед началом шага code-splitting:**

- `ls -la dist/web/assets/*.js`
- `npx vite-bundle-visualizer` или другой анализатор.

Возможно, реальную массу тянет recharts/echarts/leaflet/react-flow — проверить по `package.json`. Результат ревизии фиксируем в отчёте.

### 2.4. Тесты и CI Фазы 3b

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `scripts/test-passport-v5.ts` — Permit CRUD + выдача + revoke + `task_profile permit_ids` валидация + matching permit gap + mentor_questions API | `scripts/test-passport-v5.ts` новый | 0 failed, 0 skipped | planned |
| `scripts/lib/passport-fixtures.ts` — 3 хелпера: `createPermit`, `grantPermit`, `assignMentorQuestion` | `scripts/lib/passport-fixtures.ts` расширить | — | planned |
| `ci-local.ps1` — smoke: `passport-v5` | `scripts/ci-local.ps1` | — | planned |
| `ci.yml` — «Smoke — паспорт v5» | `.github/workflows/ci.yml` | — | planned |

## 3. A-пункты Фазы 3b (A33–A46)

| # | Вопрос | Дефолт |
|---|---|---|
| A33 | Permit — источник (`issued_by`)? | Свободный текст, строка. Никаких внешних интеграций в 3b. |
| A34 | Кто может выдавать Permit? | `FIRST_ARCHITECT / COUNCIL_MEMBER` — создание permit в справочнике; `FIRST_ARCHITECT / OTC / issued_by` — выдача участнику. |
| A35 | Кто может отзывать Permit у участника? | Тот же, кто выдал, или `FIRST_ARCHITECT`. Идемпотентно. |
| A36 | `Permit.valid_until` — обязателен? | Да. Если null — бессрочно. |
| A37 | `TaskProfile.permit_ids` — что если `permit_id` не существует? | 422; раньше принимался любой. Breaking для существующих профилей не должно быть: у нас их 1–2 в dev-БД, пересоздадим. |
| A38 | Matching — если у subject нет permit, а `permit_ids` требуют? | `no_match`, `gaps[].critical=true`, `gaps[].reason='missing_permit'`. |
| A39 | Matching — если permit есть, но истёк? | То же `missing_permit`, плюс `gaps[].permit_status='expired'`. |
| A40 | mentor_questions — `mentorId` обязателен при создании? | Если задан `atomId` и у participant есть primary mentor — `mentorId` из `mentor_id`. Иначе null: открытый вопрос в общий пул направления. |
| A41 | mentor_questions — ответ на вопрос кто может? | Только `mentor_id` вопроса или `FIRST_ARCHITECT` в порядке эскалации. |
| A42 | code-splitting — как разбивать? | По роутам, `React.lazy`, не по библиотекам. `manualChunks` — только если после lazy-роутов main всё ещё > 800 KB. |
| A43 | code-splitting — какие роуты lazy? | Тяжёлые/редко-посещаемые: `/map-demo`, `/chart-demo`, `/constructor`, `/cells/map`, `/planetary`, `/experiments`, `/admin/*`. `RootPage`, `/start`, `/tasks`, `/passport`, `/tasks/:id/report`, `/tasks/:id/profile`, `/login`, `/register`, `/waiting/*` — eager. |
| A44 | code-splitting — цель? | main-chunk ≤ 700 KB / 200 KB gzip. Не «≤ 500 KB», чтобы не ломать существующее. |
| A45 | TeamCapability — в 3b или 3c? | В 3c, дефолт развилки §1. |
| A46 | Педагогическая компетенция — куда? | Отдельный трек «каталог v0.4», не 3b/3c. |

## 4. Порядок работ Фазы 3b

| Шаг | Что | Файлы |
|---|---|---|
| 1 | Миграция 061: `permits`, `participant_permits`, `passport_history_events.event_type += permit_issued, permit_revoked, mentor_question_asked, mentor_question_answered` | `db/migrations/061_passport_phase3b.sql` |
| 2 | `permits.ts` core + `POST/GET /passport/permits`, `POST/GET /passport/participants/:id/permits`, `POST /passport/participant-permits/:id/revoke` | `src/core/passport/permits.ts`, `controller.ts` |
| 3 | `task-profile.ts` — валидация `permit_ids`; `matching.ts` — `missing_permit` gap | `task-profile.ts`, `matching.ts` |
| **Чек-поинт 1** | Permit API + `task_profile` + matching работают; ручной smoke | — |
| 4 | `teaching.ts` — 3 роута mentor_questions | `teaching.ts`, `controller.ts` |
| 5 | UI: `PermitsPanel.tsx` + вкладка «Допуски» в `Passport.tsx` | — |
| **Чек-поинт 2** | Permit + mentor_questions + UI работают | — |
| 6 | code-splitting: ревизия → `React.lazy + Suspense` для тяжёлых роутов → замер | `App.tsx`, `vite.config.ts` |
| **Чек-поинт 3** | `vite build` — main-chunk ≤ 700 KB / 200 KB gzip | — |
| 7 | `scripts/test-passport-v5.ts` + `passport-fixtures.ts`, 3 хелпера | `scripts/` |
| 8 | CI: `ci-local.ps1` + `ci.yml` — «Smoke — паспорт v5» | CI-файлы |
| 9 | Финальный прогон + отчёт `docs/passport-phase3b.md` §«Изменения плана» | — |

**Если 3b не влезает:**

- Останавливаемся после чек-поинта 2: Permit + mentor_questions. code-splitting — отдельной итерацией.
- Или после чек-поинта 3: Permit + mentor_questions + code-splitting; `test-v5` и CI — отдельной итерацией.
- Честный отчёт с «не сделано».

## 5. Критерии готовности Фазы 3b

- [ ] `POST /passport/permits` → 201; 403 для роли без прав.
- [ ] `POST /passport/participants/:id/permits` → 201; 403; повторная выдача активного → 409.
- [ ] `POST /passport/participant-permits/:id/revoke` → 200; повторный revoke → 200, идемпотентно.
- [ ] `GET /passport/participants/:id/permits` для чужого → только active; для своего — все.
- [ ] `TaskProfile.permit_ids` с неизвестным `permit_id` → 422.
- [ ] Matching — если `permit_ids` требуют, а у subject нет → `no_match` с `gaps[].critical=true`, `reason='missing_permit'`.
- [ ] Matching — если permit истёк → то же + `permit_status='expired'`.
- [ ] `POST /passport/teaching/questions` → 201; GET → свои; `POST .../answer` → 200; 403 для чужого.
- [ ] `mentor_questions.atom_id` валидируется: несуществующий → 422.
- [ ] UI: вкладка «Допуски» в Passport; для эмитентов — форма выдачи.
- [ ] `vite build` — main-chunk ≤ 700 KB / 200 KB gzip; замер до/после в отчёте.
- [ ] `pnpm typecheck`, `pnpm typecheck:web`, `pnpm exec vite build` — зелёные.
- [ ] `test-passport-v2` (16/16), `test-passport-v3` (46/46), `test-passport-v4` — не сломаны.
- [ ] `test-passport-v5` — 0 failed, 0 skipped.
- [ ] CI: «Smoke — паспорт v5» в `ci-local.ps1` + `ci.yml`.

## 6. Что НЕ входит в 3b

- TeamCapability — 3c.
- Калибровка 0–9 — 3c / 3d-инфраструктура.
- AI-рекомендации, полный граф — 3c / 3d / 3f.
- Педагогическая компетенция как атом — отдельный трек «каталог v0.4».
- Интеграции Permit с внешними органами — не в 3b/3c.
- TaskProfile с `permit_ids` в UI TaskProfilePanel: JSON-редактор уже принимает, но отдельного UI для выбора permit'ов нет — 3c.

**Не трогаем:**

- `PassportFull`, `/me/passport`.
- `tasks`, `tasks/service.ts`, `reports`, `otc_decisions`, `otc_criteria`, `otc_escalations`.
- `participants.mentor_id`.
- `participant_competencies`.
- Миграции ≤ 060.
- Тесты v1–v4, `smoke-passport-teaching` — не меняем.

## 7. Оценка объёма Фазы 3b

| Блок | Строк, approx |
|---|---|
| Миграция 061 | ~120 |
| `permits.ts` | ~200 |
| Расширение `task-profile.ts` + `matching.ts` | ~80 |
| `teaching.ts`, mentor_questions | ~150 |
| API, 7 роутов | ~200 |
| UI PermitsPanel + вкладка | ~250 |
| code-splitting: `App.tsx` + `vite.config` | ~60 + ревизия |
| `test-passport-v5.ts` | ~300 |
| `passport-fixtures.ts` расширение | ~80 |
| CI | ~10 |
| **Итого** | **~1450** |

Риск не влезть в один заход — средний. code-splitting — самая непредсказуемая часть: может всплыть, что тяжёлое сидит в общих компонентах, и придётся рефакторить.

---

# Фаза 3d

## 1. Скоуп и развилка Фазы 3d

**Осталось после 3c (5 пунктов):**

1. Калибровка 0–9 (§6.5) — инфраструктура + контент (anchor examples, сессии).
2. Полный интерактивный граф (§8.4) — 400–600 строк SVG.
3. `POST /passport/teams/:id` (update team) — техдолг 3c.
4. Batch `GET /participants?ids=` — техдолг 3c (для TeamAssessmentPanel).
5. Composite-индекс на `listTeamsForViewer` — техдолг 3c (минор).

**Развилка по классам задач:**

- **Технические (3d):** (3), (4), (5), граф — можно делать сразу.
- **Инфраструктура калибровки (3d):** таблицы, API загрузки anchor examples и сессий калибровки. Сам контент (реальные anchor'ы, критерии) — не программистская задача, её заполняют предметные специалисты.
- **Внешнее решение (3f):** AI-рекомендации — нужен LLM-провайдер, бюджет, RAG, безопасность. Без этого — «правила», не LLM.

**Рекомендованный дефолт:**

- **Фаза 3d:** Калибровка-инфраструктура (без контента) + полный граф + 3 техдолга. ~2260 строк.
- **Фаза 3e (по запросу):** техдолги + метаданные + TeamCapability matching.
- **Фаза 3f (по запросу):** AI-рекомендации, требует LLM-провайдера.
- **Трек «каталог v0.4»:** педагогическая компетенция как атом + дополнение каталога (workflow §16.1).

**Не входит в 3d:**

- Реальные anchor'ы — контентная задача. Инфраструктура (загрузка, привязка к атомам/измерениям, версия) — да.
- AI-рекомендации — 3f.
- Педагогическая компетенция — отдельный трек.

## 2. Карта Фазы 3d

### 2.1. Калибровка 0–9: инфраструктура (§6.5)

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 6.5 | `anchor_examples` — эталонные работы (`atom_id`, `dimension`, `level`, `title`, `description`, `url/text`, `version`, `created_by`). Контент — не в 3d, только инфраструктура | `db/migrations/063_passport_phase3d.sql` | FK + version | planned |
| 6.5 | `calibration_sessions` — сессия калибровки (`atom_id`, `dimension`, `status ∈ {draft, open, closed}`, `created_by`, `deadline`) | 063 | CRUD | planned |
| 6.5 | `calibration_assignments` — work × assessor, оценка, расхождение (2+ уровня → третий оценщик) | 063 | assignment | planned |
| 6.5 | `passport_assessments` — добавить `criteria_version`, `anchor_example_id` (nullable FK) | 063 (ALTER) | поля есть | planned |
| 6.5 | `POST /passport/calibration/anchors` — загрузить anchor (`FA | COUNCIL`) | `src/core/passport/calibration.ts` новый, `controller.ts` | 201 + 403 | planned |
| 6.5 | `GET /passport/calibration/anchors?atomId=&dimension=` — список | `calibration.ts` | список | planned |
| 6.5 | `POST /passport/calibration/sessions` — создать сессию | `calibration.ts` | 201 | planned |
| 6.5 | `POST /passport/calibration/sessions/:id/assign` — назначить work × assessor | `calibration.ts` | 201 | planned |
| 6.5 | `POST /passport/calibration/assignments/:id/score` — оценка (`level`) | `calibration.ts` | 200 + 409 повтор | planned |
| 6.5 | `GET /passport/calibration/sessions/:id/report` — расхождения, статус | `calibration.ts` | report | planned |
| 6.5 | UI `/calibration` — список сессий, `/calibration/:id` — report | `src/web/pages/CalibrationListPage.tsx`, `CalibrationPage.tsx` | видно | planned |

**Загрузка anchor примеров:** для 3d — JSONB-поле `content` (текст или URL). Без загрузки файлов; S3-интеграция — отдельно в 3f, если понадобится.

**«Расхождение 2+ уровня»:** report считает попарно; если `|a-b| ≥ 2` → флаг `needs_third`. Назначение третьего оценщика — отдельный роут. Медиана не применяется (§6.5 п.3).

### 2.2. Полный интерактивный граф (§8.4)

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 8.4 | `GET /passport/graph?cluster=&direction=&filter=` — узлы (54) + рёбра (133) + метаданные (`level`, `status`) | `src/core/passport/graph.ts` новый, `controller.ts` | граф | planned |
| 8.4 | SVG-граф: Force-directed без библиотек (простая итерационная layout-функция на 100–200 итераций) | `src/web/components/passport/GraphView.tsx` новый | визуально | planned |
| 8.4 | Клик на узел → открыть карточку атома (существующий `AtomCard`) | `GraphView.tsx` + `Passport.tsx` | navigation | planned |
| 8.4 | Фильтры: по кластеру, по направлению, по статусу уровня (`confirmed/declared/not_assessed`) | `GraphView.tsx` | фильтр | planned |
| 8.4 | Табличный режим обязателен (§17.4): toggle graph / table | `GraphView.tsx` | toggle | planned |
| 8.4 | Доступность: `role="img"`, `<title>` на каждом узле и ребре | `GraphView.tsx` | a11y | planned |
| 8.4 | Новая вкладка «Граф» в `Passport.tsx` (или `/passport/graph` — см. A62) | `Passport.tsx` | tab | planned |

**Почему без библиотек (план Фазы 1 §5):** тяжёлых зависимостей не добавляем. Force-directed на 54 узлах — 20 итераций по O(n²) = ~58 тыс. операций — мгновенно.

**Force-directed layout:**

- отталкивание между узлами (Кулон) + притяжение по рёбрам (Гук) + центростремительная сила;
- 100–200 итераций в `useEffect`, потом зафиксировать;
- `useMemo` для стабильности между рендерами.

### 2.3. Техдолг 3c

| # | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 3 | `PATCH /passport/teams/:id` — update (`name`, `expectedResult`, `participants`, `criteria`). Триггер на `assessor_id ∉ participants` остаётся. | `teams.ts`, `controller.ts` | 200 + 403/422 | planned |
| 4 | `GET /passport/participants?ids=uuid1,uuid2,...` — batch (`externalId`, `name`, `status`). Для TeamAssessmentPanel. | `controller.ts` (или `participants/controller.ts`) | список | planned |
| 5 | Composite-индекс `listTeamsForViewer` — `(assessor_id) WHERE assessor_id IS NOT NULL` + `(created_by)`. Проверить, нужен ли после 1000+ — но добавим в 063. | 063 | plan | planned |

### 2.4. Тесты и CI Фазы 3d

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `scripts/test-passport-v7.ts` — anchor CRUD, session+assign+score+report, update team, batch participants | `scripts/test-passport-v7.ts` | 0 failed | planned |
| `scripts/lib/passport-fixtures.ts` — 5 хелперов | расширение | — | planned |
| CI: `smoke: passport-v7` | — | — | planned |

## 3. A-пункты Фазы 3d (A60–A70)

| # | Вопрос | Дефолт |
|---|---|---|
| A60 | Формат `anchor_examples` | JSONB `content`: `{text?, url?, media_type?}`. Без файлов в 3d (S3 — 3f). |
| A61 | Кто создаёт anchor? | `FIRST_ARCHITECT / COUNCIL_MEMBER` (методология). Профильное направление — через «Коннект» (вне API). |
| A62 | Граф — где? | Новая вкладка «Граф» в `Passport.tsx` (не отдельная страница). Сохраняет контекст паспорта. |
| A63 | Что в графе — все 54 атома или агрегация? | Все 54 атома + 133 рёбра. В кластерах уже есть `CompetencyMap` (шаг 6a Фазы 1) — обзор, граф — детали. |
| A64 | Update team — какие поля? | `name`, `expectedResult`, `participants`, `criteria`. `status` — не в PATCH, отдельный роут. |
| A65 | Batch participants — где? | В `passport/controller.ts` — `GET /passport/participants?ids=`. Не трогаем `participants/controller.ts`. |
| A66 | Calibration sessions — deadline? | Опционально (`deadline TIMESTAMPTZ`). Не блокирует score после deadline — просто флаг `overdue` в report. |
| A67 | score — можно ли переписать? | Нет. `calibration_assignments` — append-only: INSERT оценки, SELECT MAX/FIRST в report. Пересмотр — через отдельный assignment. |
| A68 | report — что именно? | Список work × assessor → level, попарные расхождения, флаг `needs_third` (≥ 2), отсутствующие оценки. Без медианы. |
| A69 | `needs_third` — как назначается? | Отдельный роут `POST /passport/calibration/sessions/:id/assign-third?workId=&assessorId=`. Просто добавляет запись. |
| A70 | `passport_assessments.criteria_version` — откуда? | Из `competency_atoms.version` на момент INSERT. В `submitAssessment` — добавить version в payload. **NB:** в 3d выяснилось, что тип INTEGER несовместим с VARCHAR — фикс в 3e (A74). |

## 4. Порядок работ Фазы 3d

| Шаг | Что | Файлы |
|---|---|---|
| 0 | Сверка с кодом (§1.1) | — |
| 1 | Миграция 063: `anchor_examples`, `calibration_sessions`, `calibration_assignments`, `passport_assessments += criteria_version, anchor_example_id`, индексы на `team_capabilities` | `db/migrations/063_passport_phase3d.sql` |
| 2 | `calibration.ts` — anchor CRUD, session, assign, score, report | `src/core/passport/calibration.ts`, `controller.ts` |
| **Чек-поинт 1** | Calibration API работает | — |
| 3 | Техдолг: `PATCH /passport/teams/:id`, batch participants | `teams.ts`, `controller.ts` |
| 4 | `graph.ts` — узлы+рёбра+метаданные; API | `src/core/passport/graph.ts`, `controller.ts` |
| **Чек-поинт 2** | Graph API + техдолг | — |
| 5 | UI: `GraphView.tsx` (force-directed), вкладка «Граф», `CalibrationListPage.tsx` + `CalibrationPage.tsx` | `src/web/`, `Passport.tsx`, `App.tsx` |
| **Чек-поинт 3** | UI работает | — |
| 6 | `scripts/test-passport-v7.ts` + фикстуры | — |
| 7 | CI: `smoke: passport-v7` | — |
| 8 | Финальный прогон + отчёт `docs/passport-phase3d.md` §«Изменения плана» | — |

Если 3d не влезает — останавливаемся после чек-поинта 2 (Calibration API + техдолг + Graph API). UI и v7 — отдельная итерация.

## 5. Критерии готовности Фазы 3d

- [ ] `POST/GET /passport/calibration/anchors` — 201/200; 403 без прав.
- [ ] `POST /passport/calibration/sessions` → 201.
- [ ] `POST .../sessions/:id/assign` → 201.
- [ ] `POST .../assignments/:id/score` → 200; повтор → 409.
- [ ] `GET .../sessions/:id/report` — расхождения, `needs_third` при `|a-b| ≥ 2`.
- [ ] `PATCH /passport/teams/:id` → 200; триггер срабатывает при попытке `assessor_id ∈ participants`.
- [ ] `GET /passport/participants?ids=` — массив `{id, externalId, name, status}`.
- [ ] `GET /passport/graph` — 54 узла, 133 ребра, метаданные.
- [ ] `GraphView` — force-directed, toggle graph/table, `<title>` на узлах.
- [ ] `passport_assessments.criteria_version` заполняется для новых assessment.
- [ ] typecheck, typecheck:web, vite build — зелёные.
- [ ] v2–v6 — не сломаны.
- [ ] v7 — 0 failed.
- [ ] CI: `smoke: passport-v7`.

## 6. Что НЕ входит в 3d

- Реальные anchor примеры (контент) — заполняют специалисты, не код.
- AI-рекомендации — 3f.
- Педагогическая компетенция — отдельный трек.
- S3-загрузка файлов для anchor — 3f, если понадобится.
- Медиана / статистика расхождений (§6.5 п.5) — 3e.
- TeamCapability matching — 3e.

## 7. Оценка объёма Фазы 3d

| Блок | Строк |
|---|---|
| Миграция 063 | ~130 |
| `calibration.ts` | ~350 |
| `graph.ts` | ~120 |
| API, 8 роутов | ~280 |
| `PATCH /teams/:id` + batch participants | ~100 |
| UI `GraphView.tsx` (force-directed + toggle + a11y) | ~450 |
| UI `CalibrationListPage` + `CalibrationPage` | ~350 |
| `test-passport-v7.ts` | ~350 |
| Фикстуры | ~120 |
| CI | ~10 |
| **Итого** | **~2260** |

Риск: выше 3c — UI-граф непредсказуем: force-directed layout и производительность.

---

# Фаза 3e

## 1. Скоуп и блокирующая развилка Фазы 3e

**После 3d остались 8 пунктов — двух разных природ:**

| Класс | Пункт | Блокер |
|---|---|---|
| Технический | `criteria_version` в `submitAssessment` (A70) | — |
| Технический | Медиана/статистика расхождений (§6.5 п.5) | — |
| Технический | S3-загрузка anchor'ов (если нужно) | — |
| Технический | TeamCapability matching (`POST /passport/teams/match`) | — |
| Технический | `GraphView → React.lazy` (если понадобится) | — |
| Технический | `updateTeam + status` (draft/assessed/deprecated) | — |
| Технический | `participant_competencies` (053) → deprecate | — |
| Внешнее решение | AI-рекомендации (§9.3, §16.6) | LLM-провайдер |

**Рекомендованный дефолт:**

- **Фаза 3e (эта):** только 7 технических пунктов. ~1400 строк.
- **Фаза 3f (по запросу):** AI-рекомендации. Требует решения по LLM-провайдеру, бюджету, безопасности, RAG. Не раньше, чем появятся 20+ реальных пользователей.
- **Трек «каталог v0.4»:** педагогическая компетенция + anchor'ы (контент).

**Не входит в 3e:**

- AI-рекомендации — 3f.
- Реальные anchor'ы — контентная задача.
- LLM-интеграция — 3f.
- S3-загрузка anchor'ов — 3f, если понадобится.
- `GraphView → React.lazy` — не критично, откладываем до реальной потребности.

## 2. Где тонко (честно, до старта)

### 2.1. Медиана — это не медиана оценок

§6.5 п.3: «итог не определяется автоматически медианой». §6.5 п.5: «обезличенные показатели для анализа качества критериев». Значит:

- **Не** медиана оценок assessor'ов (запрещено).
- **Да** статистика расхождений: сколько пар с `|a-b| ≥ 2`, какие атомы/измерения чаще флагаются, какие assessor'ы систематически «строгие/мягкие».

**Тонко:** это метаданные о качестве калибровки, не о людях. Если в report попадут имена assessor'ов — давление. Нужен `GET /passport/calibration/stats?anonymized=true` (только агрегаты). Без «рейтинга assessor'ов» — только распределение расхождений по атомам. A71.

### 2.2. TeamCapability matching — комбинаторика

54 атома, N участников. `getCandidates` — top-N одиночек. `teams/match` — подбор команды под TaskProfile: set cover / assignment problem.

- Жадный алгоритм (не оптимально, но быстро) — O(N × M), где M — required atoms.
- Backtracking — NP-hard, нельзя в API.
- ILP — нельзя без библиотеки.

**Тонко:** без ограничений «жадный» может собрать команду из 50 человек «чтобы точно покрыть». Нужен `maxTeamSize` и штраф за размер. A72.

### 2.3. criteria_version в submitAssessment — простой, но с нюансом

Поле добавлено в 063. В `submitAssessment` (`assessment.ts`) — при INSERT в `passport_assessments` добавить `criteria_version: atom.version`. Но:

- `atom.version` — строка (`'0.2.0'`), `criteria_version` — INTEGER. Несовместимо.
- Либо менять тип колонки на VARCHAR, либо `version` тоже INTEGER, либо парсить.

**Тонко:** в шаге 1 3d `criteria_version` сделали INTEGER — это баг, несоответствие `competency_atoms.version VARCHAR(16)`. Нужна миграция 064 с `ALTER COLUMN TYPE VARCHAR(16)` или парсинг `'0.2.0' → 2` (плохо).

**Дефолт:** миграция 064 → `ALTER TABLE passport_assessments ALTER COLUMN criteria_version TYPE VARCHAR(16)`. При `submitAssessment` — `criteria_version: atom.version`. A74.

### 2.4. updateTeam + status — просто, но audit

Смена status (`draft → assessed` уже в `assessTeam`; `assessed → deprecated`) — отдельный роут. Нужен ли `passport_history_events`? По §10.3 — да, это действие актора. Но `event_type` в 063 не добавили (`team_deprecated`?). Миграция 064 — расширить CHECK. A75.

### 2.5. participant_competencies (053) — deprecate, но не удалять

- Оставляем таблицу.
- В docs `passport-implementation.md` §«Не сделано» — уже записано.
- В коде — не используем (`grep -rn "participant_competencies" src/`).
- Если используется где-то (в capacity, tasks) — оставить, но `@deprecated` в комментарии.
- Миграция не нужна — `COMMENT ON TABLE ... IS 'DEPRECATED: see person_atom_states (058)'`.

**Тонко:** `tasks.required_competencies` (JSONB, legacy) и `participant_competencies` — не путать. Оба legacy, оба заменены `task_profiles.required_atoms` (060) + `person_atom_states` (058). A76.

### 2.6. Главное «тонко» — 3e не даёт пользователям ничего нового

Все 7 пунктов — техдолги и улучшения. Новой ценности для пользователя нет. Если 3e не влезет — не провал. Если влезет — «стало чище».

**Честно:** 3e — последняя в очереди. Альтернатива — трек «каталог v0.4» (anchor'ы + педагогическая компетенция) или пауза для реальных пользователей, а 3e — позже.

## 3. Карта Фазы 3e

### 3.1. criteria_version (A70, A74) — первым, там баг

| Что | Файл | Тест | Статус |
|---|---|---|---|
| Миграция 064: `ALTER COLUMN criteria_version TYPE VARCHAR(16)` | `db/migrations/064_passport_phase3e.sql` | `\d passport_assessments` | planned |
| `submitAssessment` — `criteria_version: atom.version` | `src/core/passport/assessment.ts` | `GET /card → assessments[].criteriaVersion` | planned |
| `toAssessmentItem` — поле `criteriaVersion` | `src/core/passport/projection.ts`, `types.ts` | — | planned |
| UI AtomCard — показать `criteriaVersion` (опционально) | `src/web/components/passport/AtomCard.tsx` | — | planned |

### 3.2. Медиана/статистика расхождений (A71)

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `GET /passport/calibration/stats?atomId=&dimension=` — агрегаты: `by_work`, `by_assessor` (только `assessorHash`, не id), `flagged_works`, `distribution` | `src/core/passport/calibration.ts` (расширить), `controller.ts` | 200 + shape | planned |
| `assessorHash` — `sha256(assessor_id)` первые 8 символов. Не id. | `calibration.ts` | — | planned |
| UI `CalibrationStatsPage.tsx` (`/calibration/stats`) — таблицы агрегатов | `src/web/pages/CalibrationStatsPage.tsx` | видно | planned |

**Не делаем:** рейтинг assessor'ов, «лучший/худший», персональные оценки. Только агрегаты.

### 3.3. TeamCapability matching (A72)

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `POST /passport/teams/match` — по TaskProfile: `{ requiredAtoms, maxTeamSize }` → `{ team: participantId[], gaps, coverage }` | `src/core/passport/teams-match.ts` новый, `controller.ts` | 200 + shape | planned |
| Жадный алгоритм: сортировка по «сколько required_atoms покрывает», добавление пока не покрыто или не лимит | `teams-match.ts` | — | planned |
| `maxTeamSize ≤ 20` (защита от «соберём 50»), default 10 | `teams-match.ts` | 422 при > 20 | planned |
| UI `TeamMatchPanel.tsx` в `/teams` — «Подобрать команду под задачу» | `src/web/components/passport/TeamMatchPanel.tsx` | видно | planned |

### 3.4. updateTeam + status (A75)

| Что | Файл | Тест | Статус |
|---|---|---|---|
| Миграция 064: `event_type += 'team_deprecated'` | 064 | CHECK | planned |
| `PATCH /passport/teams/:id/status` — `{ status: 'deprecated' }` (`draft/active → assessed` — через `assessTeam`) | `teams.ts`, `controller.ts` | 200 + 403 | planned |
| Audit: `team_deprecated` в `passport_history_events` | `teams.ts` | — | planned |

### 3.5. participant_competencies deprecate (A76)

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `COMMENT ON TABLE participant_competencies IS 'DEPRECATED: see person_atom_states (058) + task_profiles (060)'` | 064 | — | planned |
| `grep -rn "participant_competencies" src/` — проверить, что не используется | — | — | planned |

### 3.6. Тесты и CI Фазы 3e

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `scripts/test-passport-v8.ts` — criteria_version, calibration stats, team match, team status | `scripts/test-passport-v8.ts` | 0 failed | planned |
| `scripts/lib/passport-fixtures.ts` — 4 хелпера | расширение | — | planned |
| CI: `smoke: passport-v8` | — | — | planned |

## 4. A-пункты Фазы 3e (A71–A76)

| # | Вопрос | Дефолт |
|---|---|---|
| A71 | Calibration stats — что именно? | Агрегаты по `(atom, dimension)`: `worksCount`, `flaggedCount (≥2)`, `avgDiff`, `distribution (0,1,2,3,4+)`. По assessor: `assessorHash (sha256[:8]) + flagRate`. Без id, без имён. |
| A72 | Team match — жадный или точный? | Жадный. `maxTeamSize ≤ 20`, default 10. Возвращает `{team, gaps, coverage}`. `coverage` — доля покрытых `required_atoms`. |
| A73 | S3 для anchor'ов? | Не в 3e. Anchor — `content JSONB (text/url)`. S3 — 3f, если понадобится. |
| A74 | `criteria_version` — VARCHAR(16)? | Да. Миграция 064 `ALTER COLUMN`. При `submitAssessment` — `atom.version`. |
| A75 | updateTeam status — какой роут? | `PATCH /passport/teams/:id/status` с `{ status: 'deprecated' }`. `assessed` — через `assessTeam`. `draft → active` — не нужен. |
| A76 | `participant_competencies` — удалять? | Нет. `COMMENT ON TABLE` + `@deprecated` в docstring (если где-то используется). Не трогаем данные. |

## 5. Порядок работ Фазы 3e

| Шаг | Что | Файлы |
|---|---|---|
| 0 | Сверка: `grep -rn "participant_competencies" src/` (A76), `\d passport_assessments` (A74) | — |
| 1 | Миграция 064: `criteria_version VARCHAR`, `event_type += team_deprecated`, `COMMENT ON participant_competencies` | 064 |
| 2 | `criteria_version` в `submitAssessment` + `toAssessmentItem` | `assessment.ts`, `projection.ts`, `types.ts` |
| 3 | Calibration stats (A71) | `calibration.ts`, `controller.ts` |
| **Чек-поинт 1** | `criteria_version` + stats работают | — |
| 4 | Team match (A72) | `teams-match.ts`, `controller.ts` |
| 5 | Team status (A75) | `teams.ts`, `controller.ts` |
| **Чек-поинт 2** | Team match + status работают | — |
| 6 | UI: `CalibrationStatsPage`, `TeamMatchPanel` | `src/web/pages`, `src/web/components` |
| 7 | `test-passport-v8.ts` + фикстуры | — |
| 8 | CI: `smoke: passport-v8` | — |
| 9 | Финальный прогон + отчёт | — |

## 6. Критерии готовности Фазы 3e

- [ ] `passport_assessments.criteria_version` — VARCHAR(16), заполняется.
- [ ] `GET /card → assessments[].criteriaVersion`.
- [ ] `GET /passport/calibration/stats` → агрегаты, без id.
- [ ] `POST /passport/teams/match` → `{team, gaps, coverage}`.
- [ ] `PATCH /passport/teams/:id/status` → 200, `team_deprecated` в history.
- [ ] `COMMENT ON participant_competencies` — DEPRECATED.
- [ ] typecheck, typecheck:web, vite build — зелёные.
- [ ] v2–v7 — не сломаны.
- [ ] v8 — 0 failed.
- [ ] CI: `smoke: passport-v8`.

## 7. Объём Фазы 3e

| Блок | Строк |
|---|---|
| Миграция 064 | ~50 |
| criteria_version | ~30 |
| Calibration stats | ~150 |
| Team match | ~250 |
| Team status | ~80 |
| Deprecate comment | ~10 |
| UI CalibrationStatsPage | ~200 |
| UI TeamMatchPanel | ~200 |
| `test-passport-v8.ts` | ~300 |
| Фикстуры | ~100 |
| CI | ~10 |
| **Итого** | **~1400** |

Риск средний. Team match — самый большой кусок, но жадный алгоритм простой. Calibration stats — новые SQL-агрегаты.