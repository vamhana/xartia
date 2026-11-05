# docs/passport-phase3a.md + docs/passport-phase3b.md — единый план

## 0. Развилка по объёму

По итогам 3a в бэклоге 5 пунктов:

- Permit (§10.3 паспорта) — схема + API + UI.
- TeamCapability (§11.4) — отдельная сущность, крупный кусок.
- code-splitting UI (1.79 MB / 470 KB gzip) — техдолг.
- mentor_questions.atom_id API — 3 роута, долг 3a.
- Педагогическая компетенция как атом — требует пополнения каталога (§16.1 workflow). Не в 3b — отдельный трек «каталог v0.4».

**Рекомендованный дефолт:**

- **Фаза 3b:** Permit + mentor_questions API + code-splitting. Относительно независимые, ~1500 строк, реалистично за один заход.
- **Фаза 3c:** TeamCapability + калибровка 0–9 + AI + полный граф. Самые рискованные/крупные.
- **Отдельный трек:** «каталог v0.4» — добавление педагогической компетенции как атома + её критериев. Это workflow §16.1 (профессиональное обсуждение, утверждение), не техническая задача.

Если TeamCapability оставить в 3b — разбить 3b на два под-этапа с чек-поинтом, но объём вырастет.

---

# Фаза 3a

## 1. Скоуп Фазы 3a

**Обязательно:**

- **TaskProfile (§11.1)** — требования к задаче через атомы, а не свободный текст.
- **TeachingRelation per-atom (§12)** — кто кому и по какому атому может быть наставником; readiness вычисляется, не хранится.
- **17 направлений Хартии (§14)** — справочник + маппинг atom → direction {home, related} + фильтр каталога.
- **Matching (§11.2)** — соответствие участника задаче, кандидаты.
- **UI-панели:** TaskProfilePanel в существующей `/tasks`, фильтр по направлениям в Passport, home/related в карточке атома.
- **Тест:** `scripts/test-passport-v4.ts` + CI.

**Не входит в 3a (перенос в 3b/3c):**

| Что | Куда |
|---|---|
| Permit (§10.3) | 3b |
| TeamCapability (§11.4) | 3b |
| code-splitting UI (1.79 MB / 470 KB gzip) | 3b |
| Калибровка 0–9 (§6.5) | 3c |
| AI-рекомендации (§9.3, §16.6) | 3c |
| Полный интерактивный граф (§8.4) | 3c |
| practice_review_policy для оставшихся 50 атомов | 3c, вместе с калибровкой |
| Педагогическая компетенция как отдельный атом | 3b/3c, нет в 54-пилоте |

## 2. Карта: раздел паспорта → файл → тест → статус

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

Если в 3a не влезет — этот блок переносим в 3b: не критично, `mentor_questions` работает и без `atom_id`.

## 3. A-пункты Фазы 3a

| # | Вопрос | Дефолт |
|---|---|---|
| A19 | TaskProfile — расширение `tasks` или новая таблица? | Новая `task_profiles` (1:1, FK на `tasks.id`, nullable). `tasks` не трогаем. `tasks.required_competencies` остаётся legacy. |
| A20 | `required_atoms[i].role` — per-atom или на уровне профиля? | Per-atom. `role ∈ {executor, designer, consultant, assessor}`. |
| A21 | Matching — что отдаём в API? | `matching → {status, gaps, checkedCount, coverage}`. `candidates → top-N {participantId, matches, gaps}`. Уровни — только через `?scope=task`. |
| A22 | TeachingRelation — заменяет `participants.mentor_id`? | Нет. Обе структуры живут. `participants.mentor_id` = «основной наставник». `teaching_relations` = per-atom детализация. `?scope=mentor` проверяет оба. |
| A23 | readiness — вычисляемое или хранимое? | Вычисляемое. Критерий: `P≥7 + X≥5 + E≥5` по атому. Педагогическая компетенция не реализуется в 3a. UI показывает `ready / not_ready / unknown`. |
| A24 | `atom_direction_map` — как заполнять? | Сид: home = 9 для всех 54; related — по кластерам, см. §2.3. main = home в 3a. |
| A25 | UI для 17 направлений — какой уровень? | Фильтр в каталоге + home/related в карточке атома. Отдельной страницы `/passport/directions` нет; перенос в 3b — там полный граф. |
| A26 | `task_profiles` — сид или ручное? | Ручное через API. Нет реальных задач с профилями для сида. |
| A27 | `tasks/service.ts` — трогаем? | Нет. `task_profiles` — отдельная таблица, API — отдельные роуты. `TaskProfilePanel` — новый компонент в `/tasks`. |
| A28 | `mentor_questions.atom_id` — да? | Да, nullable. Старые вопросы без `atom_id` работают как раньше. |
| A29 | candidates — источник данных? | SQL по `person_atom_states` + `competency_atoms.dimension_applicability`. Top-N. Уровни скрыты. `access_log` пополняется. |
| A30 | UI TaskProfile — где? | `TaskProfilePanel` в `/tasks`, вкладка «Требования». `MatchingPanel` — отдельный компонент, вызывается из `/tasks/:id`. |
| A31 | `POST /passport/tasks/:taskId/profile` — кто? | `FIRST_ARCHITECT / COUNCIL_MEMBER / OTC`, только для задач без профиля, иначе 409; или через PATCH — создатель профиля или `FIRST_ARCHITECT`. |
| A32 | version для `task_profiles` — как? | `version INT NOT NULL DEFAULT 1`. PATCH инкрементит. `task_profiles_history` — append-only, по аналогии с `passport_history_events`. |

Если ответов не будет — идём по дефолтам и фиксируем в §«Изменения плана» шага 12.

## 4. Порядок работ Фазы 3a

| Шаг | Что | Файлы |
|---|---|---|
| 1 | Миграция 060: `task_profiles` (+ history), `teaching_relations`, `atom_direction_map`, `mentor_questions.atom_id`, `passport_history_events.event_type += task_profile_created/updated, teaching_relation_created/revoked` | `db/migrations/060_passport_phase3a.sql` |
| 2 | Seed: 17 направлений + `atom_direction_map` (54 × home + related), идемпотентно | `scripts/seed-data/directions.ts`, `seed-data/direction_map.ts`, `scripts/seed-passport.ts` расширить |
| 3 | `GET /passport/directions`, `GET /passport/catalog?direction=`, `GET /passport/atoms/:atomId → directions` | `src/core/passport/directions.ts`, `catalog.ts`, `controller.ts`, UI `Passport.tsx`, `AtomCard.tsx` |
| **Чек-поинт 1** | Направления и фильтр работают; `test-passport-v4.ts` (каркас, шаг 3) — зелёный | — |
| 4 | TaskProfile: core + API + UI, `TaskProfilePanel` в `/tasks` | `src/core/passport/task-profile.ts`, `controller.ts`, `src/web/components/passport/TaskProfilePanel.tsx`, `src/web/pages/Tasks.tsx` |
| 5 | TeachingRelation: core + API + UI, `TeachingPanel` в Passport — вкладка «Наставничество», расширение `visibility.ts#isMentor` | `src/core/passport/teaching.ts`, `controller.ts`, `src/web/components/passport/TeachingPanel.tsx`, `src/web/pages/Passport.tsx` |
| 6 | Matching: core + API + UI, `MatchingPanel` | `src/core/passport/matching.ts`, `controller.ts`, `src/web/components/passport/MatchingPanel.tsx` |
| **Чек-поинт 2** | P0-часть 3a: TaskProfile + TeachingRelation + Matching работают; `test-passport-v4.ts` (P0) — зелёный | — |
| 7 | Опционально, если влезает: `mentor_questions.atom_id` + 3 API-роута | `teaching.ts` |
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

Permit, TeamCapability, code-splitting, калибровка 0–9, AI-рекомендации, полный граф, `practice_review_policy` для оставшихся 50 атомов, педагогическая компетенция как отдельный атом — всё в 3b/3c.

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
- Калибровка 0–9 → 3c.
- AI-рекомендации, полный граф → 3c.
- Педагогическая компетенция как атом → отдельный трек «каталог v0.4».

## 2. Карта: раздел паспорта → файл → тест → статус

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

### 2.3. code-splitting — техдолг 3a, §2.7 отчёта

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

## 3. A-пункты Фазы 3b

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
| A43 | code-splitting — какие роуты lazy? | Тяжёлые/редко-посещаемые: `/map-demo`, `/chart-demo`, `/constructor`, `/cells/map`, `/planetary`, `/experiments`, `/admin/*`. `RootPage`, `/start`, `/tasks`, `/passport`, `/tasks/:id/report`, `/tasks/:id/profile`, `/login`, `/register`, `/waiting/*` — eager, частые. |
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

- TeamCapability — 3c, дефолт развилки §1.
- Калибровка 0–9 — 3c.
- AI-рекомендации, полный граф — 3c.
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

## Изменения плана

**2026-11-04.** Фаза 3b (Permit + mentor_questions + code-splitting) реализована.
Актуальные статусы ниже; таблицы §2 остаются в исходном виде (они отражают
план, а не факт).

### Сделано (файлы)

**Миграции:**
- `db/migrations/061_passport_phase3b.sql`:
  - `permits` (справочник, `permit_id TEXT PK`, `issued_by` — свободный текст);
  - `participant_permits` (выдача, partial UNIQUE на active,
    `verification_data JSONB`, `revoked_at/revoked_by/revoke_reason`);
  - `passport_history_events.event_type` += `permit_issued`, `permit_revoked`,
    `mentor_question_asked`, `mentor_question_answered`.

**Домен:**
- `src/core/passport/permits.ts` — новый. `createPermit` (FA | COUNCIL),
  `issuePermitToParticipant` (FA | OTC | COUNCIL), `revokeParticipantPermit`
  (issuer | FA, идемпотентно), `listPermits`, `getParticipantPermits`
  (свои — все статусы; чужие — только active без verification_data),
  `pickEffectiveValidUntil` (min из participant_permits.valid_until и
  permits.valid_until).
- `src/core/passport/task-profile.ts` — валидация `permit_ids` (должны
  существовать и быть active; иначе 422) в `createTaskProfile` и
  `updateTaskProfile`.
- `src/core/passport/matching.ts` — `checkPermitsGap`: permit-gap с
  `reason='missing_permit'`, `permitStatus='absent'|'expired'|'revoked'`,
  `critical=true`. Приоритет: active > expired > revoked; active с
  истёкшим effectiveValidUntil → expired. `checkedCount` и `coverage`
  теперь включают permit'ы. `getCandidates` — permit-gap учитывается
  (кандидаты с permit-gap → no_match, не попадают в top-N).
- `src/core/passport/teaching.ts` — расширен. `createMentorQuestion`
  (mentorId из primary, если не задан), `getMyQuestions`,
  `getMentorQuestions`, `answerMentorQuestion` (mentor вопроса | FA).
  `atom_id` валидируется.
- `src/core/passport/types.ts` — DTO: `Permit`, `ParticipantPermit`,
  `CreatePermitInput`, `IssuePermitInput`, `MentorQuestion`,
  `CreateMentorQuestionInput`, `MentorQuestionStatus`; `MatchGap`
  расширен (`atomId: string | null`, `permitId?`, `reason`,
  `permitStatus?`); `HistoryEventType` += 4 типа.

**API (аддитивно, 9 новых путей):**
- `POST /passport/permits`, `GET /passport/permits`
- `POST /passport/participants/:id/permits`,
  `GET /passport/participants/:id/permits`
- `POST /passport/participant-permits/:id/revoke`
- `POST /passport/teaching/questions`,
  `GET /passport/teaching/questions`,
  `GET /passport/teaching/mentor-questions`,
  `POST /passport/teaching/mentor-questions/:id/answer`

**UI:**
- `src/web/components/passport/PermitsPanel.tsx` — новый. «Мои допуски»,
  «Справочник», «Выдать», «Создать permit».
- `src/web/pages/Passport.tsx` — вкладка «Допуски» (`meId` из `useUser`).
- `src/web/components/passport/MatchingPanel.tsx` — рендер permit-gap
  (`atomId=null` + `permitId`).
- `src/web/types.ts` — DTO: `PassportPermit`, `PassportParticipantPermit`,
  `PassportMentorQuestion`, `PassportMentorQuestionStatus`;
  `PassportMatchGap` расширен.

**Code-splitting (6a + 6b):**
- `vite.config.ts` — `manualChunks`: `react-vendor`, `tanstack`,
  `charts` (recharts), `maps` (leaflet), `grid` (react-grid-layout),
  `state-vendor`, `vendor`. `chunkSizeWarningLimit: 700`.
- `src/web/App.tsx` — `React.lazy` для ~40 роутов; eager только:
  `/`, `/login`, `/register`, `/waiting/*`, `/start`, `/tasks`,
  `/passport`, `/tasks/:id/report`, `/tasks/:id/profile`. `Suspense`
  fallback на `<Routes>`.
- `src/web/pages/_MapDemo.tsx` — новый. Inline `/map-demo` вынесен из
  `App.tsx` для lazy.
- **Метрики (шаг 6):** main `index-*.js` — 1 803 069 B → **245 424 B**
  raw; gzip — **59.53 KB** (было 475.46 KB). Lazy-чанков 40+.
  Цель A44 (≤ 700 KB / ≤ 200 KB gzip) перевыполнена в 3×.

**Тесты/CI:**
- `scripts/lib/passport-fixtures.ts` — расширен: `createPermit`,
  `listPermits`, `issuePermit`, `revokeParticipantPermit`,
  `createMentorQuestion`, `answerMentorQuestion`, `listMyQuestions`.
- `scripts/test-passport-v5.ts` — новый. Покрывает:
  1. Permit CRUD: create 201, duplicate 409, bad permitId 422, без прав 403;
  2. Issue: 201, duplicate active 409, без прав 403;
  3. `task_profile.permit_ids`: unknown → 422, valid → 201;
  4. Matching permit-gap: active → match; revoked → no_match/revoked;
     idempotent revoke; expired → no_match/expired;
  5. mentor_questions: create 201, bad atomId 422, list, FA answer 200,
     чужой answer 403.
- `scripts/ci-local.ps1` — `smoke: passport-v5` после v4.
- `.github/workflows/ci.yml` — «Smoke — паспорт v5».

### Решения (A33–A46)

- **A33**: `issued_by` — свободный текст. Без интеграций в 3b.
- **A34**: создание permit — `FIRST_ARCHITECT | COUNCIL_MEMBER`;
  выдача — `FIRST_ARCHITECT | OTC | COUNCIL_MEMBER`. (В плане §3 у
  A34 было `issued_by` — исправлено: `issued_by` текст, не UUID.)
- **A35**: отзыв — issuer (`participant_permits.issued_by`) или
  `FIRST_ARCHITECT`, идемпотентно.
- **A36**: `valid_until` опционален (null = бессрочно).
  `effectiveValidUntil = min(participant_permits.valid_until,
  permits.valid_until)`.
- **A37**: неизвестный/inactive `permit_id` в `task_profiles` → 422.
- **A38**: matching без permit → `no_match`, `reason='missing_permit'`,
  `critical=true`, `permitStatus='absent'`.
- **A39**: истёкший/отозванный permit → `no_match`,
  `permitStatus='expired'|'revoked'`.
- **A40**: `mentorId` при создании вопроса — fallback на
  `participants.mentor_id`; иначе `null` (открытый вопрос).
- **A41**: ответ — только `mentor_id` вопроса или `FIRST_ARCHITECT`.
- **A42**: `manualChunks` — по библиотекам (не по роутам); `React.lazy`
  делает страницы отдельными чанками.
- **A43**: lazy для 40 роутов; eager — 9 критичных (см. выше).
- **A44**: цель main ≤ 700 KB / 200 KB gzip. Достигнуто: 245 KB / 60 KB.
- **A45**: `TeamCapability` → 3c.
- **A46**: педагогическая компетенция как атом → отдельный трек
  «каталог v0.4».

### Не сделано (осознанно, 3c / отдельный трек)

- `TeamCapability` (§11.4) — 3c.
- Калибровка 0–9 (§6.5) — 3c.
- AI-рекомендации, полный граф — 3c.
- Педагогическая компетенция как атом — отдельный трек «каталог v0.4».
- Cron-задача для обновления `permits.status` → `expired` — 3c
  (сейчас вычисляется на чтении, БД не переписывается).
- `AdminLayout` — статически импортируется в `App.tsx`, `[INEFFECTIVE_DYNAMIC_IMPORT]`
  warning. Не критично (~40 KB в main). Техдолг 3c.

### Технический долг

- `checkPermitsGap` — без Map, явный приоритет active > expired >
  revoked. Если у участника несколько строк на один permit — берётся
  приоритетная.
- `ValidationError` с details в `teaching.ts` — второй аргумент
  `[{path, message}]` (как в остальном проекте).
- `AdminLayout` + admin barrel — статически в main (warning от Vite).
  Если захотим — вынести `AdminLayout` в отдельный файл `pages/admin/Layout.tsx`
  и lazy-импортировать (3c).

### Тесты и CI

- `pnpm typecheck` / `pnpm typecheck:web` — зелёные.
- `pnpm exec vite build` — success. main 245 KB raw / 60 KB gzip.
  Есть warning `[INEFFECTIVE_DYNAMIC_IMPORT]` для admin (не блокер).
- `pnpm tsx scripts/test-passport.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v2.ts` — 16/16 PASS, 0 skipped.
- `pnpm tsx scripts/test-passport-v3.ts` — 46/46 PASS, 0 skipped.
- `pnpm tsx scripts/test-passport-v4.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v5.ts` — **22/22 PASS, 0 failed**.
- `pnpm tsx scripts/smoke-passport-teaching.ts` — 12/12 PASS.
- `bash scripts/smoke-passport.sh` — зелёный.
- CI: `smoke: passport-v5` в `ci-local.ps1` + «Smoke — паспорт v5»
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
pnpm tsx scripts/smoke-passport-teaching.ts

# Smoke
bash scripts/smoke-passport.sh