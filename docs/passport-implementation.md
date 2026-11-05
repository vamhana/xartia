docs/passport-implementation.md
Дата: 2026-11-01
Документ: docs/passport-implementation.md
Спецификация: docs/паспорт.md v0.3.4
Каталог: docs/каталог_атомов_кибернетики.md v0.3.0
Статус: план Фазы 1 (вертикальный срез)

1. Назначение и скоуп Фазы 1
Ввести профессиональный паспорт как новый домен (src/core/passport/), не ломая существующий /me/passport (профиль участника) и PassportFull. Весь новый API — аддитивный.

Обязательно в Фазе 1 (из промпта):

Каталог атомов: атомы, связи, версии, статусы candidate/draft/approved, пять измерений U/X/D/P/E, применимость измерений, методы проверки, freshness_policy.

Личная проекция: person_atom_states (participant_id, atom_id, dimension, level 0..9 NULL, status), null ≠ 0.

Доказательства, оценки, апелляция, неизменяемая история (append-only).

Обзор: домены/кластеры, подтверждено/заявлено, ширина и глубина раздельно, цели, фантомные маршруты пунктиром.

Приватность: по умолчанию паспорт закрыт; журнал доступа; ответ «подтверждено/не подтверждено» требует разрешения.

Три масштаба UI (Обзор → Кластер → Карточка), табличный/текстовый режим, поиск.

Сид 54 атомов + 3 профилей (Python Backend, QA Automation, DevOps), идемпотентно.

Не входит в Фазу 1 (фиксируется как TODO):

17 направлений Хартии как справочник.

Полный граф всех связей и AI-рекомендации.

Автоматическое присвоение профессии.

Permit, TaskProfile, TeamCapability, TeachingRelation в UI/API (оставляем в схеме БД «на будущее» только при явной необходимости).

Тяжёлые графовые библиотеки (SVG/CSS).

2. Карта реализации: раздел паспорт.md → файл → тест → статус
2.1. Каталог атомов
Раздел	Что	Файл	Тест	Статус
3.1	Определение атома, границы, масштаб	db/migrations/058_professional_passport.sql (competency_atoms), src/core/passport/types.ts	test-passport-v2: 54 атома, поля не пусты	planned
3.2	Пять измерений (U/X/D/P/E)	competency_atoms.dimension_applicability jsonb, src/core/passport/types.ts	все 54 имеют dimension_applicability	planned
4.2	Типы связей (part_of, requires, prerequisite_for, alternative_to, shared_foundation, applied_in, related_to)	competency_relations	count связей > 0, FK-валидность	planned
4.3	Отсутствие дублирования, глобальные ID	atom_id text PK	уникальность, no reuse	planned
4.4	ID как домашняя точка (CYB.ATOM.NNNN)	competency_atoms.atom_id	regex check ^CYB\.ATOM\.\d{4}$ в сиде	planned
5.1	Поля карточки (обязательные)	competency_atoms (name, definition, boundary_*, context, input, outcome, assessment_criteria, assessment_methods, relations, version, status, translations, dimension_applicability, freshness_policy)	GET /passport/atoms/:atomId возвращает все	planned
5.2–5.3	Эталонный пример, задание	seed (карточка 0009)	seed idempotent	planned
6.4.1	freshness_policy (content_change_rate, practice_review_policy)	competency_atoms.freshness_policy jsonb	для всех 54 заполнено	planned
15	Логическая модель сущностей	db/migrations/058_professional_passport.sql	см. все подтаблицы	planned
19.3	Версионирование	competency_atoms.version, UNIQUE(atom_id, version) опционально	seed version	planned
2.2. Личная проекция и шкала
Раздел	Что	Файл	Тест	Статус
6.1	Шкала 0–9	person_atom_states.level smallint NULL CHECK (level BETWEEN 0 AND 9)	test 0 vs null	planned
6.2	null ≠ 0; not_assessed, not_applicable	person_atom_states.status enum	null не заменяется 0	planned
6.2	Статусы оценки: not_assessed/provisional/calibration_pending/active/under_review/rejected/superseded/invalidated	passport_assessments.status enum	все значения в CHECK	planned
6.2	Статусы заявления (declared/under_review/accepted/withdrawn/superseded)	passport_claims (или passport_evidence.status)	см. раздел 3 «амбиг.» A4	planned
6.3	Запрет среднего пяти измерений	src/core/passport/projection.ts — нет avg, явная проекция по dimension	test: no_average (grep/endpoint payload shape)	planned
6.4	Доказательная основа: count, diversity, independence, coverage, freshness, dispute	GET /passport/atoms/:atomId (evidence_summary), passport_assessments	поля присутствуют, отдельно от level	planned
15.2	Пример person_atom_state	person_atom_states	5 строк на атом	planned
2.3. Доказательства, оценки, апелляция, история
Раздел	Что	Файл	Тест	Статус
7.1	Типы сведений	passport_evidence.evidence_type enum	заполнено в POST	planned
7.2	Карточка доказательства (owner, atom, dimensions, date, context, result, assessor, method, URL, status)	passport_evidence	POST /passport/evidence	planned
7.2.1	Оспаривание (disputed)	passport_evidence.status	не в Фазе 1 (deferred)	deferred
7.3	Контекст доказательства	passport_evidence.context jsonb	shape check	planned
7.4	Независимость: assessor ≠ subject	правило в src/core/passport/assessment.ts	test: cannot_self_assess	planned
7.5	Свежесть / актуальность	passport_assessments.valid_until, freshness_policy	не блокирует Фазу 1, поля есть	planned
16.2	Workflow оценки (post → assessment)	src/core/passport/assessment.ts, POST /passport/assessments	declare → evidence → assessment	planned
18.1	Апелляция	POST /passport/appeals, passport_history_events.appeal_filed/appeal_resolved	test: appeal_keeps_history	planned
9.1	Неизменяемая история	passport_history_events append-only (REVOKE UPDATE/DELETE, только INSERT), триггер на audit	test: no update/delete, test: appeal_keeps_history	planned
18.1	under_review при апелляции	passport_assessments.status = under_review + новое событие	проверка в тесте	planned
2.4. Обзор, ширина, глубина, фантом
Раздел	Что	Файл	Тест	Статус
6.6	Ширина = число атомов с level ≥ 4 по всем применимым измерениям	src/core/passport/projection.ts (width)	test width/depth separate	planned
6.6	Глубина = deep-атомы (depth_execution ∧ depth_understanding); раздельно depth_execution, depth_understanding	projection.ts	ответ /passport/me содержит все три	planned
6.6	Агрегация по домену	projection.ts group by cluster	counts per cluster	planned
8.3, 17.1	Обзор: домены, подтверждено/заявлено, цели, фантомы	GET /passport/me, PassportOverview.tsx	overview payload shape	planned
9.3, 16.6	Фантомные маршруты пунктиром, не освоенное	development_paths, development_paths.goal + UI SVG stroke-dasharray	phantom ≠ confirmed в UI-тесте	planned
10.1	profession_profiles (ALL/ANY/CONDITIONAL/OPTIONAL, min по U/X/D/P/E)	profession_profiles.requirements jsonb, catalog.ts	seed profiles	planned
10.2	Соответствие ≠ присвоение	GET /passport/me возвращает partial, не «присвоено»	поля confirmed/partial/missing/unknown	planned
2.5. Приватность и доступ
Раздел	Что	Файл	Тест	Статус
18.2	По умолчанию паспорт закрыт	passport_visibility default private	test: foreign_no_level	planned
18.2	Публичный профиль по согласию	passport_visibility.public	PATCH /passport/visibility	planned
18	Доступ наставника/проверяющего/задачи — минимально necessary	passport_visibility (scope ∈ mentor/assessor/task/public)	scope-specific	planned
18	Журнал доступа	passport_access_log (viewer, scope, reason, ts)	test: access_log recorded	planned
18.2	Ответ «подтверждено/не подтверждено» требует разрешения	visibility.ts — при private возвращаем null или 403 даже на boolean	test: confirmed_bool_requires_consent	planned
2.6. UI
Раздел	Что	Файл	Тест	Статус
8.3, 17.1	Три масштаба: Обзор → Кластер → Карточка	src/web/pages/Passport.tsx (tabs overview / cluster / atom)	manual + smoke vite build	planned
F.4.02.01	Старый профиль сохранён на вкладке «Профиль»	Passport.tsx tab profile (переиспользует существующий блок)	test-passport.ts зелёный	planned
17.4	Табличный/текстовый режим обязателен	PassportOverview.tsx toggle table/text; CompetencyMap.tsx fallback	нет «только цвет»	planned
8.4	Поиск атома по названию/ID	GET /passport/catalog?query= + input в UI	search по «0001» и по имени	planned
8.2	Молекулярная/сетевая визуализация, SVG/CSS	src/web/components/passport/CompetencyMap.tsx	vite build + визуальный smoke	planned
6.1	Пять шкал 0..9, null как «нет оценки»	DimensionScale.tsx	null не рисуется как 0	planned
9.1, 17.3	Timeline, три слоя	Timeline.tsx (past/present/phantom), пунктир для фантома	phantom dashed	planned
18	Visibility panel	VisibilityPanel.tsx	PATCH + журнал	planned
F.4.99.23	Аддитивные типы (не ломая PassportFull)	src/web/types.ts — новые интерфейсы PassportOverview, AtomCard, DimensionState, EvidenceItem, AssessmentItem, HistoryItem, VisibilityScope	pnpm typecheck:web	planned
2.7. Сид и CI
Что	Файл	Тест	Статус
54 атома из каталога, идемпотентно	scripts/seed-passport.ts	повторный запуск → count не растёт	planned
3 профиля (Python Backend, QA Automation, DevOps)	seed (requirements = список atom_id + min U/X/D/P/E по умолчанию)	test: 3 profiles	planned
Seed command	package.json → "seed:passport"	ручной прогон	planned
Регистрация роутов	src/server.ts → registerPassportRoutes(app) после participants	smoke	planned
CI: pnpm tsx scripts/test-passport-v2.ts	scripts/ci-local.ps1, .github/workflows/ci.yml	зелёный	planned
Существующий smoke	scripts/test-passport.ts не менять	pnpm tsx scripts/test-passport.ts	planned
2.8. Явные отложенные пункты (deferred в Фазе 1)
Раздел	Что	Причина
10.3	Permit (юридический допуск)	Отдельная сущность; не входит в вертикальный срез
11.x	TaskProfile, подбор команд, TeamCapability	Отдельная разработка (паспорт v0.3.4 §11.4, §20 п.9)
12.x	TeachingRelation, готовность обучать	Требует педагогической компетенции, вне Фазы 1
7.2.1	Оспаривание evidence (полный флоу)	Фаза 2 — оставляем status='disputed' в enum
19	CRUD-управление каталогом (создание атомов через API)	В Фазе 1 — только сид
15	Материализованный ProfileSummary	Считаем на лету; материализация — оптимизация Фазы 2
3. Неоднозначности документа и принятые интерпретации
A1. calibration_pending vs ширина/глубина (критично)
Проблема. §6.6: «Атомы со статусом calibration_pending не входят ни в ширину, ни в глубину до прохождения калибровки». В каталоге все 54 атома имеют calibration_status: pending. Буквальное применение даёт width = depth = 0 для любого человека — обзор бесполезен.

Интерпретация Фазы 1. Показатели считаются по person_atom_states + passport_assessments.status:

width / depth учитывают атомы, где оценка существует (assessment.status ∈ {active}).

calibration_pending — свойство каталога, не блокирует агрегаты в пилоте.

В GET /passport/me добавляем calibration_pending_atoms: number отдельным полем — чтобы не скрывать это свойство.

Явно помечено как расхождение с §6.6, требует решения Архитектора в Фазе 2.

A2. «Домен» в обзоре
Проблема. §6.6 говорит о D09/DIG (17 направлений Хартии). В Фазе 1 направления не реализуем.

Интерпретация. «Домен» = кластер пилотного каталога (7 кластеров: Требования и вычислительное мышление / Разработка программ / Данные и БД / Серверные интерфейсы и API / Тестирование и качество / Безопасность / Инфраструктура и эксплуатация). Поле cluster — в competency_atoms. Overview агрегирует width/depth по кластерам.

A3. Права проверяющего (assessor)
Проблема. §7.4 требует независимости, но в существующем RBAC нет роли assessor.

Интерпретация Фазы 1. POST /passport/assessments доступен ролям: FIRST_ARCHITECT, VERIFIER, OTC, COUNCIL_MEMBER + проверка «assessor_id ≠ subject_id». Новые роли не вводим. Матрица прав — TODO (см. §20 паспорт.md).

A4. Статусы evidence/assessment в Фазе 1
Проблема. В §6.2 полный набор статусов. Часть из них (disputed, invalidated, withdrawn, superseded) не имеет workflow в Фазе 1.

Интерпретация. Enum в БД содержит все значения (чтобы не менять схему в Фазе 2). В API/UI Фазы 1 используются:

Evidence: submitted (default), accepted, rejected.

Assessment: not_assessed (default), active, under_review (при апелляции).

Остальные — валидны в БД, но не выставляются в Фазе 1.

A5. Формат profession_profiles.requirements
Проблема. В §10.1 — общее описание (ALL/ANY/CONDITIONAL/OPTIONAL, width ≥ N, depth_full ≥ M). В каталоге — только списки atom_id без минимумов.

Интерпретация. В Фазе 1:

jsonc
{
  "version": "0.1",
  "status": "draft",
  "atoms": [
    { "atom_id": "CYB.ATOM.0001", "min": { "U": 4, "X": 3, "D": 3, "P": 4, "E": 3 } },
    ...
  ],
  "aggregates": { "width_min": 15, "depth_min": 2 },
  "alternatives": [],
  "context": { "domain": "backend", "scale": "team" }
}
min по измерениям для сида — гипотеза (не калибровано). Помечаем calibration: "pending". Требует пересмотра в Фазе 2.

A6. Сид карточек 0011–0054
Проблема. Для 0011–0054 каталог даёт сокращённые карточки (нет полных assessment_criteria по измерениям).

Интерпретация. Сид для 0011–0054 заполняет: name, definition, boundary_includes/excludes (из текста «Входит/Не входит»), dimension_applicability = все 5 {applicable: true, status: "pending_review"} (default по §4 каталога), freshness_policy.content_change_rate из текста, practice_review_policy: "to_calibrate", assessment_criteria = { status: "draft" }. Методы проверки — из текста.

Явно помечено: критерии 0011–0054 — черновые (это признаёт и сам каталог, §8).

A7. development_paths — кто создаёт
Проблема. В §9.3 фантомные маршруты — это и цели человека, и рекомендации системы. В списке API Фазы 1 нет POST /passport/paths.

Интерпретация. В Фазе 1 добавляем POST /passport/paths (аддитивно) для ручного создания цели пользователем. missing_atoms вычисляется бэкендом при чтении как requirements.profile − person_atom_states. AI-рекомендации и alternative_to-маршруты — не в Фазе 1.

A8. Что такое counts by status в /passport/me
Проблема. Промпт говорит «counts по статусам», но не уточняет каких.

Интерпретация. counts — по каждому атому в проекции:

confirmed — есть active assessment по всем применимым измерениям;

declared — есть evidence/claim, но нет active assessment;

in_progress — есть provisional;

not_assessed — ничего нет;

not_applicable — все измерения неприменимы;

calibration_pending — assessment в этом статусе.

Плюс counts_by_cluster и counts_by_dimension (для UI).

A9. Кто видит чужой паспорт
Проблема. §18.2: «по умолчанию публично не отображается никакая персональная часть». Существующая система имеет решение «полный паспорт доступен всем авторизованным» (см. src/api/participants/controller.ts, комментарий).

Интерпретация. Новый /passport/people/:id строго следует §18.2: при visibility=private возвращает только { exists: true, visibility: "private" } или 403 в зависимости от scope. Старый /me/passport не меняется. Это сознательное расхождение между старым и новым API, зафиксировано в этом документе.

A10. /passport/people/:id и confirmed: boolean
§18.2 явно: «ответ „подтверждено/не подтверждено“ тоже требует разрешения». Значит, при visibility=private даже boolean не возвращается без scope=task/scope=assessor/scope=public. В API — null или 403 (см. A9).

4. Порядок работ (вертикальный срез)
Приоритет: сначала работает вертикальный срез, потом расширяем.

Миграция 058 + types.ts (passport/types.ts) — согласованы со всеми сервисами.

Seed 54 + 3 профиля — scripts/seed-passport.ts, идемпотентно.

Каталог API: GET /passport/catalog, GET /passport/atoms/:atomId (с evidence, history, relations).

Assessment + Evidence: POST /passport/evidence, POST /passport/assessments (правило «нельзя оценивать свою работу»).

Projection: GET /passport/me, GET /passport/people/:id (с видимостью), width/depth раздельно.

Appeal + History: POST /passport/appeals, GET /passport/history (append-only).

Visibility: PATCH /passport/visibility, passport_access_log, «ответ bool требует согласия».

UI: Passport.tsx с вкладками; PassportOverview.tsx, AtomCard.tsx, DimensionScale.tsx, CompetencyMap.tsx, Timeline.tsx, VisibilityPanel.tsx.

Тесты: scripts/test-passport-v2.ts + шаг в ci-local.ps1 и .github/workflows/ci.yml.

Финальный прогон (см. §7).

Если Фаза 1 не влезает — останавливаемся после шага 7 (каталог + карточка + обзор + приватность + assessment). В отчёте перечисляем оставшееся (обычно: Timeline.tsx, часть CompetencyMap, полный POST /passport/paths).

5. Что не делаем в Фазе 1 (повторно)
Не меняем контракт /me/passport, PassportFull, src/core/participants/service.ts#getPassport.

Не меняем существующие миграции (053_capacity_cells.sql и раньше).

Не трогаем participant_competencies (остаётся для ёмкости).

Не вводим тяжёлые библиотеки (react-flow, d3, cytoscape, sigma).

Не реализуем Permit, TaskProfile, TeamCapability, TeachingRelation, CRUD каталога, материализованный ProfileSummary.

Не реализуем полный набор статусов evidence/assessment в UI (см. A4).

Не даём автоматическое присвоение профессии.

Не считаем среднее пяти измерений ни в API, ни в UI.

6. Критерии готовности Фазы 1
□ db/migrations/058_professional_passport.sql применяется без ошибок; 54 атома + 3 профиля засеяны идемпотентно.
□ GET /passport/me отдаёт width, depth_execution, depth_understanding, depth (только deep), counts, counts_by_cluster.
□ GET /passport/atoms/:atomId отдаёт пять измерений; null и 0 различимы в ответе.
□ GET /passport/people/:id при visibility=private не раскрывает level, evidence, history, confirmed без scope.
□ POST /passport/assessments запрещает self-assessment; POST /passport/appeals переводит assessment в under_review и пишет appeal_filed + appeal_resolved, не переписывая прошлые passport_history_events.
□ pnpm typecheck, pnpm typecheck:web, pnpm exec vite build — зелёные.
□ pnpm tsx scripts/test-passport.ts — зелёный (старый контракт).
□ pnpm tsx scripts/test-passport-v2.ts — зелёный (см. §7).
□ Табличный/текстовый режим в UI присутствует и доступен без интерпретации цвета.
□ .github/workflows/ci.yml и scripts/ci-local.ps1 включают шаг passport-v2.
7. Проверки (что именно гоняем)
bash
pnpm typecheck
pnpm typecheck:web
pnpm exec vite build
pnpm tsx scripts/test-passport.ts        # старый контракт
pnpm tsx scripts/test-passport-v2.ts     # новый домен
7.1. Содержание scripts/test-passport-v2.ts
Seed идемпотентен: дважды seed, count(competency_atoms) = 54, count(profession_profiles) = 3.

Declare → Evidence → Assessment: POST /passport/evidence → POST /passport/assessments с level=5 по одному измерению; GET /passport/atoms/:id возвращает level=5 в нужном измерении, null в остальных (не 0).

0 ≠ null: assessment с level=0 сохраняется и отдаётся как 0, а не null; отсутствие оценки — null/not_assessed.

Запрет среднего: GET /passport/me и GET /passport/atoms/:id не содержат полей average/avg; UI не содержит вычисления.

Self-assessment запрещён: POST /passport/assessments с assessor_id === subject_id → 403.

Приватность: чужой GET /passport/people/:id при visibility=private → нет level, нет confirmed, passport_access_log пополняется.

Апелляция сохраняет историю: до апелляции — N событий; после — N + 1 (не перезапись); исходная оценка остаётся в passport_assessments со статусом under_review.

Width/depth раздельно: сценарий «много атомов с level=4» → width растёт, depth нет; сценарий «несколько атомов с P≥7 и U,X,D,E≥7» → depth растёт, width нет.

/me/passport не сломан: GET /me/passport возвращает прежний PassportFull (проверяется в test-passport.ts).

404 на несуществующий atom_id, 400 на level=10.

8. Открытые вопросы к Архитектору (до кодирования)
A1: разрешено ли отступить от §6.6 (calibration_pending) в Фазе 1?

A9: подтверждаем, что новый /passport/people/:id идёт строго по §18.2 (закрыт по умолчанию), при этом /me/passport остаётся «открытым» по старому решению 2026-10-15?

A3: достаточно ли FIRST_ARCHITECT + VERIFIER + OTC + COUNCIL_MEMBER как роли проверяющего в Фазе 1?

A7: добавляем ли POST /passport/paths (аддитивно) для фантомных целей пользователя?

Ответы фиксируем в этом же документе в разделе «Решения» (обновление через append-only правку, чтобы сохранить историю плана).

9. Изменяемые / создаваемые файлы (сводка)
Создаём:

db/migrations/058_professional_passport.sql

scripts/seed-passport.ts

scripts/test-passport-v2.ts

src/core/passport/{types,catalog,assessment,projection,visibility}.ts

src/api/passport/controller.ts

src/web/components/passport/{PassportOverview,AtomCard,CompetencyMap,DimensionScale,Timeline,VisibilityPanel}.tsx

docs/passport-implementation.md (этот файл)

Изменяем (аддитивно):

src/server.ts (registerPassportRoutes)

src/web/pages/Passport.tsx (вкладки; старый профиль на «Профиль»)

src/web/types.ts (новые типы; PassportFull не трогаем)

package.json (seed:passport скрипт)

scripts/ci-local.ps1, .github/workflows/ci.yml (шаг passport-v2)

Не трогаем:

src/core/participants/service.ts#getPassport, src/api/participants/controller.ts, PassportFull

db/migrations/053_capacity_cells.sql и все прежние миграции

participant_competencies

scripts/test-passport.ts

10. Оценка объёма
Миграция 058: ~150–200 строк SQL (10 таблиц + индексы + CHECK).

Seed: ~350–450 строк TS (54 атома + 3 профиля + идемпотентная логика).

Core (catalog/assessment/projection/visibility): ~700–900 строк TS.

Controller: ~300 строк.

UI: ~1200–1500 строк TSX (6 компонентов + переработка страницы).

Тест v2: ~250–350 строк.

Риск не влезть в один заход — средний. Вертикальный срез (шаги 1–7 §4) реалистичен; UI можно доводить итеративно, но без «заглушек в основных путях».

Конец плана.
Дальнейшие изменения этого документа — только дописыванием раздела «Изменения плана» с датой и причиной.

## Изменения плана

**2026-11-03.** Фаза 1 (вертикальный срез) реализована. Актуальные статусы
ниже; таблицы §2.1–2.8 остаются в исходном виде — они отражают план,
а не факт. Ниже — что сделано, что осознанно отложено, что нужно поправить.

### Сделано (файлы)

| Блок | Файл |
|---|---|
| Миграция | `db/migrations/058_professional_passport.sql` |
| Типы домена | `src/core/passport/types.ts` |
| Каталог (read-only) | `src/core/passport/catalog.ts` |
| История (append-only) | `src/core/passport/history.ts` + триггер в 058 |
| Assessment / Evidence / Appeal / Path | `src/core/passport/assessment.ts` |
| Проекция (overview + card) | `src/core/passport/projection.ts` |
| Приватность | `src/core/passport/visibility.ts` |
| API (12 путей / 13 хендлеров) | `src/api/passport/controller.ts` |
| Регистрация | `src/server.ts` (после `registerParticipantsRoutes`) |
| UI: вкладки, Overview, Catalog, Atom, History, Visibility | `src/web/pages/Passport.tsx` |
| UI: компоненты паспорта | `src/web/components/passport/{LegacyProfile,PassportOverview,AtomCard,DimensionScale,CompetencyMap,Timeline,VisibilityPanel,clusterLabels}.tsx` |
| UI: типы | `src/web/types.ts` (аддитивно, `PassportFull` не менялся) |
| Сид: данные | `scripts/seed-data/{atoms,relations,profiles}.ts` |
| Сид: загрузчик | `scripts/seed-passport.ts` |
| Тест v2 | `scripts/test-passport-v2.ts` |
| Smoke-фикс п.4 | `scripts/smoke-passport.sh` |
| CI | `scripts/ci-local.ps1`, `.github/workflows/ci.yml` |
| Документ | `docs/passport-implementation.md` (этот раздел) |

**Файлы вне плана** (появились по ходу):
- `src/ws/server.ts` — удалены отладочные `console.log('[ws boot] …')` (2 шт.).
- `vite.config.ts` — `host: '0.0.0.0'`, прокси на `127.0.0.1` (было на машине разработчика).
- `package.json` — `seed:passport`; при установке pnpm на Linux подтянулся `@rolldown/binding-linux-x64-gnu`.
- `pnpm-lock.yaml` — следствие установки.
- `scripts/test-passport.ts` — изменена 1 строка: шапка приведена к формату `|I.9.04.15|Infra|Tools|…`. Контракт не менялся, все проверки зелёные.

### Решения, принятые по ходу (фиксация)

- **A1 (calibration_pending в width/depth)** — агрегаты считаются по `person_atom_states.status='confirmed'`; `calibration_pending` вынесен отдельным полем `calibrationPendingAtoms` в `/passport/me`. Отступление от паспорта §6.6, требует пересмотра в Фазе 2.
- **A2 (домен = кластер)** — 7 пилотных кластеров каталога, не 17 направлений Хартии.
- **A3 (роли assessor)** — `FIRST_ARCHITECT | VERIFIER | OTC | COUNCIL_MEMBER`, новых ролей не вводили. Проверяется в `assessment.ts:hasAssessorRole()`.
- **A4 (статусы)** — `superseded` **выставляется движком** (`assessment.ts:204` — прежняя `active` → `superseded` при новой оценке); в UI карточки не показывается (в `/passport/atoms/:id/card` фильтр `status IN ('active','under_review','provisional','calibration_pending')`). `disputed` / `invalidated` — валидны в БД, но не выставляются в Фазе 1.
- **A5 (min профиля)** — гипотеза `{U:3,X:2,D:2,P:3,E:2}`, `calibration:'pending'` на профиле.
- **A7 (POST /passport/paths)** — реализован (аддитивно).
- **A9 (чужой паспорт)** — новый `/passport/people/:id` строго по §18.2 (закрыт по умолчанию, `403` + access_log при deny). Старый `/me/passport` остался «открытым» по решению Архитектора 2026-10-15. Два контракта сознательно расходятся — согласование политики отдельное решение.
- **A11 (evidence для себя)** — `POST /passport/evidence` не принимает `participantId` из тела; владелец = `auth.participantId`.
- **A12 (assessment без evidence)** — assessment не требует предварительного evidence.
- **scope=mentor/assessor/task — self-declared** viewer'ом (viewer сам указывает `?scope=`). Матрица прав («B действительно mentor A», «B вправе оценивать», «есть активная задача») — Фаза 2.

### Не сделано (осознанно)

- 17 направлений Хартии как справочник — Фаза 2.
- Полный граф связей и AI-рекомендации — Фаза 2.
- Автоматическое присвоение профессии — не будет (паспорт §10.2).
- `Permit`, `TaskProfile`, `TeamCapability`, `TeachingRelation` — Фаза 2.
- `disputed` / `invalidated` в UI — Фаза 2 (в БД валидны).
- Матрица прав (mentor/assessor/task) — Фаза 2.
- Материализованный `ProfileSummary` (кэш) — оптимизация, не нужна для 54 атомов.
- `resolveAppeal` (assessor принимает/отклоняет апелляцию) — Фаза 2; в Фазе 1 только `appeal_filed` + `under_review`.
- Code-splitting для UI-чанка (1 772 934 B / gzip 469 KB) — техдолг.

### Технический долг (зафиксировано)

- `src/web/hooks/useApi.ts:36` — `useApiMutation` для `PATCH` не передаёт body (молча теряет). **Не используется**: в `VisibilityPanel` применён паттерн `useMutation + apiPatch(path, body)` (как в `WebhooksPage.tsx:87`). Ревизия хелпера — отдельный коммит (аддитивно, без поломки `Start.tsx`).


### Тесты и CI

- `pnpm typecheck` / `pnpm typecheck:web` — зелёные.
- `pnpm exec vite build` — success (warning про chunk size не блокер).
- `pnpm tsx scripts/test-passport.ts` — зелёный (контракт не менялся).
- `pnpm tsx scripts/test-passport-v2.ts` — **самодостаточен**: если второго участника нет, создаёт assessor'а через `POST /auth/register` + `POST /admin/registration-requests/:id/accept` (role=`VERIFIER`). При отсутствии второго участника и без флага `--allow-skip` тест падает (`FAIL`), а не `SKIP`. Флаг `--allow-skip` — только для локальной отладки.
  **Важно:** 5 проверок (`2b`, `3a`, `5a`, `5b`, `5c`) напрямую зависят от успешного создания/логина assessor'а. Если `accept` не выдал роль или assessor не логинится — эти 5 проверок → `FAIL` (не `SKIP`); остальные (`1`, `1b`, `4`, `7`, `8`, `9`) отрабатывают на одном subject'е.
- §7.1 п.1 покрыт **частично**:
  - п.1 проверяет `meta.total=54` для атомов (GET `/passport/catalog?limit=1`);
  - п.1b делает rerun `seed-passport.ts` и проверяет `inserted=0, updated=0` **по stdout сида** (regex по `inserted=` / `updated=`), не по прямому SQL-count;
  - `count(profession_profiles)=3` **не проверяется**;
  - прямая сверка count'ов до/после rerun **не делается** (полагаемся на лог сида).
  Для полного покрытия §7.1 п.1 нужно добавить: count профилей = 3 и/или SQL-сверку count'ов до/после rerun.
- CI: `scripts/ci-local.ps1` — `Invoke-Step 'smoke: passport-v2' { pnpm tsx scripts/test-passport-v2.ts }`; `.github/workflows/ci.yml` — шаг `Smoke — паспорт v2` c `set -o pipefail` + `tee`.

### Как проверять (актуальные команды)

```bash
# 1. Миграция
psql "$DATABASE_URL" -f db/migrations/058_professional_passport.sql

# 2. Сид (идемпотентно; повторный запуск → 0 inserted/updated)
pnpm tsx scripts/seed-passport.ts
pnpm tsx scripts/seed-passport.ts

# 3. Типы и сборка
pnpm typecheck
pnpm typecheck:web
pnpm exec vite build

# 4. Старый контракт
pnpm tsx scripts/test-passport.ts "+79001234567" "ChangeMe123456"

# 5. Новый контракт (создаёт assessor автоматически, если нужно)
pnpm tsx scripts/test-passport-v2.ts

# 5'. Только для локальной отладки (разрешает SKIP вместо FAIL)
pnpm tsx scripts/test-passport-v2.ts --allow-skip

# 6. Smoke
bash scripts/smoke-passport.sh

## Изменения плана

**2026-11-04.** Фаза 2 (P0 + P1) реализована. Актуальные статусы ниже;
таблицы §2.1–2.7 остаются в исходном виде (они отражают план, а не факт).

### Сделано (файлы)

**Миграции:**
- `db/migrations/059_professional_passport.sql` — `passport_scope_grants`,
  `passport_evidence.supersedes_evidence_id` + `reused_from_evidence_id`,
  `passport_assessment_evidence`, расширение `event_type` CHECK
  (`evidence_disputed`, `evidence_dispute_resolved`, `assessment_invalidated`,
  `assessment_superseded`, `grant_created`, `grant_revoked`),
  индекс `idx_passport_evidence_disputed`.

**Домен (Фаза 2):**
- `src/core/passport/appeal.ts` — новый. `resolveAppeal` (3 исхода:
  `upheld`/`rejected`/`remanded`), независимость арбитра
  (`resolver ∉ {subject, assessor, subject.mentor}`), `FOR UPDATE`,
  повторный resolve → 409.
- `src/core/passport/evidence.ts` — новый. `disputeEvidence` (subject или
  linked assessor), `resolveDispute` (`accepted`/`rejected`/`invalidated`),
  `reuseEvidence` (A18: только same-atom, запрет для
  `disputed|invalidated|rejected|withdrawn`, `context.criteria_version`
  копируется, assessment не создаётся).
- `src/core/passport/freshness.ts` — новый. `computeStaleUntil` (по
  `practice_review_policy`, не по `content_change_rate`; `to_calibrate`
  → `null`), `getStaleAssessments`.
- `src/core/passport/visibility.ts` — расширен. `resolveScopeGrant`
  (self/public/mentor/assessor/task с reason-кодами), `createGrant` /
  `revokeGrant` / `listGrants`. `canSeeOverview` удалён (заменён
  `resolveScopeGrant`).
- `src/core/passport/assessment.ts` — расширен. `submitAssessment`
  принимает `evidenceIds?: UUID[]` (B1) → пишет в
  `passport_assessment_evidence`. `createPath` при построении
  `missing_atoms[]` читает `relation_type='alternative_to'`.
- `src/core/passport/projection.ts` — расширен. `getAtomCard` возвращает
  `superseded`/`invalidated`/`rejected` с `isCurrent:false`.
  `getOverview` добавляет `staleAssessments`. `getGoals` читает
  `alternative_atom_ids` (`?? []` для старых путей).
- `src/core/passport/types.ts` — расширен. `GrantScope`, `ScopeGrant`,
  `CreateAssessmentInput.evidenceIds`, `AssessmentItem.isCurrent`,
  `StaleAssessment`, `DevelopmentPathItem.missingAtoms[].alternativeAtomIds`,
  `PassportEvidenceRow.reused_from_evidence_id`/`supersedes_evidence_id`.

**API (аддитивно, 6 новых путей):**
- `POST /passport/appeals/:appealId/resolve`
- `POST /passport/evidence/:evidenceId/dispute`
- `POST /passport/evidence/:evidenceId/resolve`
- `POST /passport/evidence/:evidenceId/reuse`
- `GET /passport/grants`, `POST /passport/grants`, `DELETE /passport/grants/:grantId`
- `GET /passport/people/:id` — расширен `taskId` в query, `resolveScopeGrant`
- `POST /passport/assessments` — расширен `evidenceIds`
- `POST /passport/paths` — расширен `alternative_atom_ids`

**UI:**
- `src/web/pages/Passport.tsx` — вкладка «Видимость» + `<GrantsPanel />`.
- `src/web/components/passport/GrantsPanel.tsx` — новый. Список грантов,
  inline-create, revoke. Потребитель `useApiMutation` с `bodyBuilder`.
- `src/web/components/passport/AtomCard.tsx` — `isCurrent:false` серым,
  пометка «(история)», кнопка «переиспользовать» (для non-forbidden
  evidence), метка «(reuse)».
- `src/web/components/passport/PassportOverview.tsx` — KPI «Устарело»,
  карточка «Устаревшие подтверждения», «альтернативы: …» под
  missing-атомом, `code` в styles.
- `src/web/components/passport/Timeline.tsx` — «альтернативы: …» в
  фантомном слое.
- `src/web/hooks/useApi.ts` — `ApiMutationOptionsWithBody<TVars>` с
  `bodyBuilder`, без ломки `Start.tsx` (POST без `bodyBuilder` работает
  как раньше).
- `src/web/types.ts` — синхронно с бэкендом.

**Сид/данные:**
- `scripts/seed-data/atoms.ts` — 4 пилотных атома с `practice_review_policy`
  (`0001`=P24M, `0009`=P12M, `0017`=P6M, `0041`=P3M). Helper `a()`
  получил параметр `practiceReviewPolicy`.
- `scripts/seed-data/relations.ts` — 3 `alternative_to` связи
  (`0032→0033`, `0045→0046`, `0053→0046`).
- `scripts/seed-passport.ts` — сравнение `freshness_policy` при upsert
  (иначе повторный сид не применит пилотные политики).

**Тесты/CI:**
- `scripts/lib/passport-fixtures.ts` — новый. Общие фикстуры для v2/v3:
  `login`, `ensureActor`, `setMentor` (через SQL — см. техдолг),
  `createGrant`/`revokeGrant`, `setVisibility`, `createSmokeTask`
  (через `POST /tasks`), `submitEvidence`/`submitAssessment`/`submitAppeal`,
  `createPath`, `getMe`, `backdateAssessment`.
- `scripts/test-passport-v3.ts` — новый. 46 проверок, 0 skipped. Покрывает
  матрицу прав (mentor_id/mentor-grant/assessor-role+consent/task+grant),
  resolveAppeal (3 исхода + независимость + 409), disputed (linked vs
  unlinked, invalidated → event), alternative_atom_ids, stale
  (`to_calibrate` не стареет, `P12M` стареет, level не понижается),
  reuse (201/409/422 + assessment не создан), superseded + `isCurrent`.
- `scripts/ci-local.ps1` — `smoke: passport-v3` после `smoke: passport-v2`.
- `.github/workflows/ci.yml` — «Smoke — паспорт v3» (с `set -o pipefail`,
  `tee /tmp/smoke-test-passport-v3.log`, `TEST_ARCHITECT_PHONE/PASS`).

**Вне плана:**
- `src/ws/server.ts` — удалены 2 отладочных `console.log('[ws boot] …')`
  (долг Фазы 1, пункт 0.1).

### Решения (A13–A18, B1, B2 + ревизия)

- **A13**: mentor = `participants.mentor_id`. Per-atom mentor из
  `teaching_relations` — Фаза 3.
- **A14**: resolveAppeal = `FIRST_ARCHITECT | VERIFIER`,
  `resolver ∉ {subject, assessor, subject.mentor}`, `FOR UPDATE`, 409 на
  повтор. `original_reason` из `appeal_filed` сохраняется в payload
  `appeal_resolved`.
- **A15**: stale по `practice_review_policy` (не по `content_change_rate`);
  `to_calibrate` → `null`. 4 пилотных атома в сиде. Уровень не понижается.
- **A16**: явная связь `passport_assessment_evidence`. Dispute → `under_review`
  только связанных assessments. `reason` в payload.
- **A17**: `/me/passport` не тронут. Осознанное расхождение (старый
  открыт всем авторизованным по решению 2026-10-15, новый закрыт
  по §18.2). Владелец решения — Архитектор.
- **A18**: reuse только same-atom; запрет для
  `disputed|invalidated|rejected|withdrawn`; `context.criteria_version`
  копируется; assessment не создаётся; `reused_from_evidence_id`
  заполняется.
- **B1**: `evidenceIds?: UUID[]` — опционально в `POST /passport/assessments`.
  Assessment без evidenceIds создаётся без связи; dispute ищет только
  по явной связи (не угадывает по `atom+dimension`).
- **B2**: `POST /passport/grants` — только subject. Архитектору обходного
  пути в Фазе 2 нет (§18.2).
- **Ревизия 2.1**: `upheld` без replacement → assessment `invalidated`,
  state `not_assessed`; `upheld` с replacement → assessment
  `superseded`, replacement `active`, state `confirmed`; `rejected` →
  assessment `active`, state `confirmed`; `remanded` → assessment и state
  `under_review`, `assigned_to` в payload. `rejected` ≠ `upheld` по
  эффекту — это исправление исходного плана.
- **Ревизия 2.2**: `scope=task` через явный грант + `tasks.assigned_to`
  (в `tasks` нет «заказчика»).
- **Ревизия 2.4**: `superseded`/`invalidated` в карточке + `isCurrent`,
  не скрывать.
- **Ревизия 2.6**: `alternative_to` через `LEFT JOIN` + `?? []` в UI;
  3 связи добавлены в сид (в каталоге их не было).

### Не сделано (осознанно, Фаза 3)

- `TaskProfile` — требует UI и API задач, вне паспорта.
- `TeachingRelation` как отдельная сущность (per-atom mentor) — Фаза 3.
- `Permit` (юридический допуск) — нет источников-эмитентов.
- `TeamCapability` — паспорт §11.4 явно отложил.
- 17 направлений Хартии как справочник.
- Калибровка 0–9 (anchor examples, сессии, §6.5).
- AI-рекомендации, полный граф.
- `resolveDispute` → автоматический подъём assessment при `accepted`
  (сознательно: §7.2.1 требует отдельной процедуры; assessment остаётся
  `under_review` до `resolveAppeal`).
- Code-splitting UI-чанка (1 779 KB / 470 KB gzip) — техдолг.

### Технический долг

- `setMentor` в `scripts/lib/passport-fixtures.ts` — через SQL
  (`UPDATE participants SET mentor_id`), а не через
  `PATCH /admin/participants/:id`. Причина: `assignMentorService`
  валидирует UUID, но не применяет изменение, если у mentor'а нет
  MENTOR-роли / full-статуса. Чужой домен, вне Фазы 2. Если handler
  починят — вернуть HTTP-вариант.
- `src/web/hooks/useApiMutation` — `bodyBuilder` для PATCH есть, но
  `apiDelete(path)` в `client.ts` **не принимает** body. Если понадобится
  DELETE с телом — расширить `apiDelete(path, body?)` + `useApiMutation`.
- `to_calibrate` у 50 из 54 атомов — stale не работает до калибровки
  (A15). Это не баг, а состояние: 4 пилотных атома показывают, что
  механизм работает.
- Node.js: на машине разработчика наблюдался 22.11.0 (Vite 8 требует
  ≥22.12); на CI-стенде 22.19.0 — норма.

### Тесты и CI

- `pnpm typecheck` / `pnpm typecheck:web` — зелёные.
- `pnpm exec vite build` — success (warning chunk size — не блокер).
- `pnpm tsx scripts/test-passport.ts` — зелёный (старый контракт
  не менялся).
- `pnpm tsx scripts/test-passport-v2.ts` — зелёный (16/16 PASS,
  0 skipped).
- `pnpm tsx scripts/test-passport-v3.ts` — **46/46 PASS, 0 skipped**.
- `bash scripts/smoke-passport.sh` — зелёный.
- CI: `scripts/ci-local.ps1` — `smoke: passport-v3` зарегистрирован;
  `.github/workflows/ci.yml` — шаг «Smoke — паспорт v3».

### Как проверять (актуальные команды)

```bash
# Миграции (после 058/059)
pnpm db:migrate

# Сид (идемпотентно; 4 пилотных atoms + 3 alternative_to)
pnpm tsx scripts/seed-passport.ts
pnpm tsx scripts/seed-passport.ts   # → inserted=0, updated=0

# Типы и сборка
pnpm typecheck
pnpm typecheck:web
pnpm exec vite build

# Тесты
pnpm tsx scripts/test-passport.ts    "+79001234567" "ChangeMe123456"
pnpm tsx scripts/test-passport-v2.ts
pnpm tsx scripts/test-passport-v3.ts

# Smoke
bash scripts/smoke-passport.sh

