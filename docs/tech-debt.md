# Технический долг XartIA — паспорт

**Дата:** 2026-11-05
**Статус:** сводный реестр после закрытия Групп 1–2 (микрофиксы + малые фичи).
**Источник:** отчёты `docs/passport-phase{1,2,3a,3b,3c,3d}.md`,
`docs/passport-implementation.md`, `docs/passport-catalog-v04.md`.

## Принцип

Здесь только **то, что осознанно отложено**. Не «TODO в коде», а
архитектурные решения с указанием, **почему** отложено и **когда**
пересматривается.

Три уровня:
- **Closed** — исправлено, но история важна (для контекста).
- **Deferred (3e/3f)** — ждёт внешнего триггера (пользователи, LLM).
- **Strategic** — не код: контент, политика, инфра.

---

## Closed (Группа 1 — микрофиксы, 2026-11-05)

| # | Что было | Как закрыто |
|---|---|---|
| 1.1 | `passport_assessments.criteria_version` — `INTEGER`, а `competency_atoms.version` — `VARCHAR(16)` (`'0.2.0'`). При первом `submitAssessment` — `ERROR: invalid input syntax for integer`. | Миграция 065: `ALTER COLUMN TYPE VARCHAR(16)`. `submitAssessment` пишет `atom.version`. `toAssessmentItem.criteriaVersion`. |
| 1.2 | `useApiMutation` для `DELETE` не передавал body. | Добавлено `apiDelete(path, body?)` в `useApiMutation`. |
| 1.3 | `bumpMinorVersion` — только minor. Semver `0.1.0 → 0.2.0`, никак не `1.0.0` или `0.1.1`. | `bumpVersion(v, kind)` с `kind ∈ {major, minor, patch}`. `payload.bump` в `update_atom` proposal. Default `minor`. |
| 1.4 | `nextAtomId` — `MAX+1` без lock. Два параллельных `merge new_atom` → race → 23505. | `pg_advisory_xact_lock(hashtext('catalog_atoms_next_id'))` перед `SELECT MAX`. |
| 1.5 | `GraphView` — eager в `Passport.tsx` (~6 KB в main). | `React.lazy` + `Suspense` в `Passport.tsx`. Чанк `GraphView 6.47 kB / 2.67 gzip`. |

**Тест:** `scripts/test-passport-v8.ts` (13/13), покрывает 1.1, 1.3, 1.4.
1.2 и 1.5 — UI, проверяются `typecheck` + `vite build`.

## Closed (Группа 2 — малые фичи, 2026-11-05)

| # | Что было | Как закрыто |
|---|---|---|
| 2.1 | `seed-passport.ts` откатывал pilot-атомы, изменённые через `catalog_proposals` (version bump от update_atom). | Флаг `--skip-pilots`: если `versionBumped` (semver compare) **или** `status ∈ {approved, deprecated}` — атом считается `unchanged`, не откатывается. Без флага — поведение прежнее (полный seed). |
| 2.2 | Нет UI-списка proposals; попасть на detail — только по прямой ссылке с UUID. | `CatalogProposalsListPage.tsx` (`/catalog/proposals`) + роут + sidebar `📝 Предложения` (FA/COUNCIL). Фильтр по статусу, клик → detail. |
| 2.3 | Смена `status` команды (`draft → assessed` через `assessTeam`), но `assessed → deprecated` — нет роута. | `PATCH /passport/teams/:id/status` (`deprecated`). `deprecateTeam` в `teams.ts`. `team_deprecated` в `passport_history_events` (миграция 065). Идемпотентно. |

**Тест:** регресс v2–v8 + catalog-v04. Smoke 2.1 (обычный → updated=1, `--skip-pilots` → unchanged), 2.2/2.3 (HTTP 200).

## Deferred — 3e (ждёт 20+ реальных пользователей)

По решению 2026-11-05: **не реализуется до появления 20+ пользователей паспорта**. План — `docs/passport-phase3e.md`.

| # | Что | Оценка |
|---|---|---|
| 3.1 | **Calibration stats** (`GET /passport/calibration/stats`): агрегаты по `(atom, dimension)`, `assessorHash = sha256[:8]`, `flaggedCount`, `distribution`. Без id, без рейтингов. | ~150 строк |
| 3.2 | **TeamCapability matching** (`POST /passport/teams/match`): жадный алгоритм, `maxTeamSize ≤ 20` (default 10), `{team, gaps, coverage}`. | ~250 строк |

**Почему deferred:** без реальных данных (≥ 20 участников × ≥ 3 профиля) — это «правила с ярлыком рекомендации». Не даёт новой ценности пользователю.

## Deferred — 3f (AI, блокер LLM-провайдер)

Требует отдельного решения: какой LLM, бюджет, RAG, безопасность.

| # | Что | Блокер |
|---|---|---|
| 4.1 | AI-рекомендации маршрутов (§9.3, §16.6) | LLM-провайдер, RAG, безопасность |
| 4.2 | S3-загрузка anchor'ов (PDF/DOCX) | Решение: нужен ли S3 для anchor, или `content.text` достаточно |
| 4.3 | Медиана калибровки (§6.5 п.5) | Отдельный от 3.1 (3.1 — агрегаты; 4.3 — медиана как решение) |

## Strategic — не код

| # | Что | Владелец |
|---|---|---|
| 5.1 | **Реальные anchor'ы** (5–10 на 2–3 атома от предметных специалистов). `calibration_sessions` сейчас — инфраструктура без контента. | Специалисты D09/D14, «Коннект» |
| 5.2 | **Калибровка 0–9** реальными сессиями. Без эталонов шкала 0–9 — черновая. | D06, D13 |
| 5.3 | **20+ реальных пользователей** паспорта (Python Backend / QA / DevOps). | Архитектор, найм |
| 5.4 | `/me/passport` политика (открыт всем авторизованным, расходится с §18.2 для нового API). | Архитектор (решение 2026-10-15) |
| 5.5 | **`participant_competencies`** (053) — **не техдолг**. Отдельный домен «ёмкость» (5 мест в `src/core/capacity`). `COMMENT ON TABLE` в 064. | — |
| 5.6 | Node.js 22.11 → 22.12 (Vite 8 требует ≥ 22.12). | Окружение |
| 5.7 | `setMentor` через `admin/controller.ts` (сейчас в `passport-fixtures` SQL, потому что `assignMentorService` не применяет для `VERIFIER`/`associated`). | Чужой домен (admin), отдельный тикет |
| 5.8 | **v8 lock-atoms** накапливаются в dev-БД (deprecated, но в `competency_atoms`). В CI — эфемерная БД, не накапливаются. Урок: `catalog_proposals` merge → атом навсегда; откат — только `deprecate_atom`. | Не требует действия (dev-only) |

## Зафиксированные архитектурные принципы

Из отчётов фаз (не техдолг, но важно для будущих изменений):

1. **Append-only**: `passport_history_events`, `team_capability_assessments`, `task_profiles_history`. Триггеры блокируют UPDATE/DELETE.
2. **`null ≠ 0`**: `person_atom_states.level` — `0` (измеренная нулевая) и `NULL` (нет оценки) различимы в API, UI, тестах.
3. **5 измерений — не усреднять**: в коде нет `avg`, в UI нет «одного балла».
4. **width и depth — раздельно**: в `/passport/me` — 4 отдельных поля (`width`, `depthExecution`, `depthUnderstanding`, `depthFull`).
5. **deprecated — вне обзора**: `getGraph` / `getOverview` фильтруют `status <> 'deprecated'`. История и данные сохранены.
6. **catalog_proposals → merge → навсегда**: атом не удаляется (append-only history + FK RESTRICT). Откат — только `deprecate_atom`.
7. **Приватность по умолчанию**: чужой паспорт — `403` без consent. Даже `boolean confirmed` требует `scope`.

## Что НЕ в этом документе

- **Реализованные** фичи 1–3d, catalog-v04 — в соответствующих `docs/passport-*.md`.
- **Открытые вопросы** к документу `паспорт.md` — в самом документе §20.
- **Процессные** вопросы (workflow, «Коннект», Хартия) — вне репозитория.

## История

| Дата | Изменение |
|---|---|
| 2026-11-05 | Создан. Группы 1–2 закрыты. 3e/3f — deferred, strategic — выделены. |