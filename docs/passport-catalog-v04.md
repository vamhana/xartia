# Трек «Каталог v0.4» — план

**Статус:** в работе с 2026-11-05.
**Отличие от фаз 1–3e:** фазы 1–3e — про **паспорт** (проекция человека
на решётку). Этот трек — про **саму решётку** (компетенции). После
3e каталог = 54 пилота; здесь — инфраструктура для **расширения**
и первый пример.

## 1. Скоуп

**Часть A — workflow предложений (инфраструктура §16.1):**
- `catalog_proposals` (draft/submitted/in_review/approved/rejected/merged).
- API: `POST/GET/PATCH /passport/catalog/proposals`,
  `POST .../merge`.
- `merge` для `new_atom` — INSERT в `competency_atoms`;
  для `update_atom` — UPDATE + bump version;
  для `deprecate_atom` — status='deprecated'.
- `passport_history_events.event_type += 'catalog_proposal_created',
  'catalog_proposal_merged'`.

**Часть B — педагогическая компетенция (первый пример):**
- `CYB.ATOM.0055` — «Передать понимание предметной области неспециалисту».
- §12.2 паспорта: «высокий уровень выполнения не делает наставником».
  Сейчас `readiness = P≥7 + X≥5 + E≥5` — прокси. Атом — отдельная
  способность, нужная для `TeachingRelation`.
- 5 измерений U/X/D/P/E, все применимы (с обоснованием для `E`).
- `practice_review_policy: 'to_calibrate'` (новый, не калиброван).
- `status: 'candidate'` — до предметной проверки.
- **Создаётся через workflow**, не seed: proposal → approve → merge.

**Часть C — anchor'ы для 3 атомов (контент):**
- `CYB.ATOM.0001` (требования), `CYB.ATOM.0009` (функция),
  `CYB.ATOM.0031` (модульный тест) — по 3 anchor'а (level 2, 5, 7).
- **Черновые** (`description: 'Черновой эталон, требует ревью'`).
- Через API `POST /passport/calibration/anchors`.
- Цель: `report` / `needsThird` начинают **семантически** работать.

## 2. Не входит

- Полное заполнение каталога (годы).
- Калибровка 0–9 реальными сессиями — отдельно (3f).
- AI-рекомендации — 3f.
- `CYB.ATOM.0055` как **approved** — требует «Коннект» (§16.1, §19.5).
- S3-загрузка anchor'ов — 3f.

## 3. A-пункты

| # | Вопрос | Дефолт |
|---|---|---|
| A77 | `proposal_type` | `new_atom \| update_atom \| deprecate_atom` |
| A78 | `merge` — отдельный роут или авто при `approved`? | Отдельный `POST .../merge` (FA/COUNCIL). `approve` — решение, `merge` — запись. §16.1. |
| A79 | `CYB.ATOM.0055` — новый ID | Да, после 0054. Не переиспользуем. |
| A80 | Кластер для 0055 | `requirements_and_computational_thinking` — не расширяем CHECK на новый кластер. |
| A81 | `dimension_applicability` для 0055 | Все 5. `E` применима: «может проверить, понял ли слушатель». |
| A82 | Сколько anchor'ов? | 3 атома × 3 уровня = 9. |
| A83 | Anchor — статус? | В `anchor_examples` нет status. Черновые — `description: 'Черновой'`, `version: 1`. |
| A84 | Кто создаёт anchor'ы в seed? | `scripts/seed-catalog-v04.ts` от admin. Через API, не SQL. |
| A85 | `test-passport-v2.ts` п.1 (`total=54`) | **Изменить на `>= 54`** — пилот 54, каталог расширяется. Минимальное изменение контракта, фиксируется в отчёте. |
| A86 | `catalog_proposals` — TTL? | Нет TTL. `draft` может висеть. Очистка — cron, если понадобится (3f). |
| A87 | `test-passport-v2.ts` п.1 — ещё что-то? | Только эта строка. Остальное в v2–v7 не трогать. |

## 4. Карта: раздел → файл → тест → статус

### 4.1. Workflow

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 16.1 | `catalog_proposals` | `db/migrations/064_passport_catalog_v04.sql` | FK + CHECK | `planned` |
| 16.1 | `event_type += 'catalog_proposal_created', 'catalog_proposal_merged'` | 064 | CHECK | `planned` |
| 16.1 | `createProposal`, `listProposals`, `getProposal`, `setProposalStatus`, `mergeProposal` | `src/core/passport/catalog-proposals.ts` (новый), `controller.ts` | API smoke | `planned` |
| 16.1 | 5 роутов | `controller.ts` | — | `planned` |
| 16.1 | UI `CatalogProposalPage.tsx` (`/catalog/proposals/:id`) — просмотр + approve/reject/merge (FA/COUNCIL) | `src/web/pages/` | видно | `planned` |

### 4.2. Педагогическая компетенция

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 12.2 | `scripts/seed-catalog-v04.ts` — через API: proposal `new_atom` → approve → merge (CYB.ATOM.0055) | `scripts/seed-catalog-v04.ts` (новый) | идемпотентно | `planned` |
| 12.2 | `test-passport-v2.ts` п.1: `>= 54` (A85) | `scripts/test-passport-v2.ts` | — | `planned` |
| 12.2 | `TeachingRelation.readiness` — расширить критерий: `P≥7 + X≥5 + E≥5 + 0055.E≥5` (опционально, если 0055 существует) | `src/core/passport/teaching.ts` | — | `planned` (отложено до 0055 approved) |

### 4.3. Anchor'ы

| Раздел | Что | Файл | Тест | Статус |
|---|---|---|---|---|
| 6.5 | `scripts/seed-catalog-v04.ts` — 9 anchor'ов через API для 0001/0009/0031 | `scripts/seed-catalog-v04.ts` | идемпотентно | `planned` |
| 6.5 | UI `AtomCard` — показать `anchorExamples.length` (опционально) | — | — | `planned` |

### 4.4. Тесты/CI

| Что | Файл | Тест | Статус |
|---|---|---|---|
| `scripts/test-catalog-v04.ts` — workflow, merge, 0055, 9 anchor'ов | `scripts/test-catalog-v04.ts` | 0 failed | `planned` |
| CI: `smoke: catalog-v04` **после** `smoke: passport-v7` | `ci-local.ps1`, `ci.yml` | — | `planned` |

## 5. Порядок

| Шаг | Что |
|---|---|
| 0 | Сверка: `grep -rn "participant_competencies" src/`, `\d competency_atoms`, `SELECT MAX(atom_id)`, `grep -n "ATOM_SEEDS.length" scripts/` |
| 1 | Миграция 064: `catalog_proposals`, event_type |
| 2 | `catalog-proposals.ts` + 5 роутов |
| **Чек-поинт 1** | Workflow API работает |
| 3 | `seed-catalog-v04.ts`: proposal → approve → merge (0055) |
| 4 | `test-passport-v2.ts` п.1: `>= 54` |
| **Чек-поинт 2** | 55 атомов, все старые тесты зелёные |
| 5 | Anchor'ы (9) через seed-catalog-v04 |
| 6 | UI `CatalogProposalPage.tsx` (опционально) |
| 7 | `test-catalog-v04.ts` |
| 8 | CI `smoke: catalog-v04` |
| 9 | Финальный прогон + отчёт |

## 6. Критерии готовности

- [ ] `POST/GET/PATCH /passport/catalog/proposals` → 201/200/200.
- [ ] `POST .../merge` для `new_atom` → 201 (создан атом 0055).
- [ ] `POST .../merge` для `update_atom` → 200 (bump version).
- [ ] `CYB.ATOM.0055` в БД: `status='candidate'`, все 5 измерений.
- [ ] 9 anchor'ов: 3 атома × 3 уровня.
- [ ] `test-passport-v2.ts` — `>= 54`, зелёный.
- [ ] `test-catalog-v04.ts` — 0 failed.
- [ ] `typecheck`, `typecheck:web`, `vite build` — зелёные.
- [ ] CI: `smoke: catalog-v04`.

## 7. Объём

~1200 строк. Риск средний: `catalog-proposals.ts` (400), seed (250), UI (150),
test (300), миграция (60).

## 8. Что после каталога v0.4

- **Фаза 3e** — когда появятся 20+ реальных пользователей (по плану).
- **Фаза 3f** — AI-рекомендации (LLM-провайдер).
- **Расширение каталога** (другие атомы) — workflow готов, контент — специалисты.

## Изменения плана

**2026-11-05.** Трек «Каталог v0.4» реализован (Часть A workflow + Часть B
педагогическая компетенция + Часть C 9 anchor'ов). UI `CatalogProposalPage.tsx`
из §5 шаг 5 — **отложен** (см. «Не сделано»). Актуальные статусы ниже;
таблицы §4 остаются в исходном виде.

### Сделано (файлы)

**Миграции:**
- `db/migrations/064_passport_catalog_v04.sql`:
  - `catalog_proposals` (proposal_type ∈ {new_atom, update_atom, deprecate_atom},
    status ∈ {draft, submitted, in_review, approved, rejected, merged},
    payload JSONB, `chk_catalog_proposals_target` разрешает `new_atom` с
    `atom_id IS NULL OR status='merged'` — для проставления `atom_id`
    постфактум при merge);
  - триггер `trg_catalog_proposals_touch_updated_at` (BEFORE UPDATE →
    `updated_at = now()`);
  - `chk_catalog_proposals_reason` (`reason IS NULL OR status='rejected'`);
  - `passport_history_events.event_type += 'catalog_proposal_created',
    'catalog_proposal_merged'`;
  - `COMMENT ON participant_competencies` — «ёмкость», не паспорт.

**Домен:**
- `src/core/passport/catalog-proposals.ts` — новый. `createProposal`
  (валидация payload по типу: new_atom — все обязательные поля + cluster +
  dimension_applicability + freshness_policy; update_atom — хотя бы одно
  поле; deprecate_atom — reason), `listProposals`, `getProposal`,
  `setProposalStatus` (машина переходов: draft→submitted→in_review→approved;
  →rejected из любого не-merged; причины прав: submitted/rejected — автор
  или reviewer-роль; in_review/approved — только reviewer-роль),
  `mergeProposal` (new_atom — INSERT competency_atoms с MAX+1,
  update_atom — UPDATE + bump version (minor), deprecate_atom —
  status='deprecated'; всё в транзакции, `atom_id` проставляется
  постфактум для new_atom).
- `src/core/passport/types.ts` — DTO: `CatalogProposalType`,
  `CatalogProposalStatus`, `CatalogProposalRow`, `CatalogProposal`.

**API (аддитивно, 5 новых путей):**
- `POST /passport/catalog/proposals`
- `GET /passport/catalog/proposals`
- `GET /passport/catalog/proposals/:proposalId`
- `PATCH /passport/catalog/proposals/:proposalId` (status)
- `POST /passport/catalog/proposals/:proposalId/merge`

**Педагогическая компетенция (Часть B):**
- `CYB.ATOM.0055` — «Передать понимание предметной области неспециалисту»,
  `cluster = requirements_and_computational_thinking`, все 5 измерений
  применимы (обоснование в `assessment_criteria.E`), `freshness_policy` =
  `{content_change_rate: 'slow', practice_review_policy: 'P24M'}`,
  `version = '0.1.0'`, `status = 'candidate'`. Создана **через workflow**
  (seed-catalog-v04: proposal → submitted → in_review → approved → merge),
  а не напрямую INSERT. В `ATOM_SEEDS` **не входит** — seed его не
  трогает, `seed-passport.ts` остаётся идемпотентным (54 пилота в seed
  + 0055 в БД; итого 55).

**Anchor'ы (Часть C):**
- 9 anchor'ов для 3 атомов (`0001`, `0009`, `0031`) × 3 уровня (`2`, `5`, `7`),
  dimension = `P`. **Черновые** (`description: 'Черновой эталон уровня N
  (требует ревью)'`), `version = 1`, создаются через `POST
  /passport/calibration/anchors`. Идемпотентность — по `title`
  (`anchor:NNNN:P:L`), не через UNIQUE (2 anchor'а одного уровня
  допустимы — разные подходы).
- Итог: 14 anchor'ов в dev-БД (5 от смоуков 3d + 9 от seed), в CI
  (эфемерная БД) — ровно 9.

**Тесты/CI:**
- `scripts/seed-catalog-v04.ts` — новый. Идемпотентно:
  - `ensureAtom0055`: если 0055 нет — workflow; если есть с
    `to_calibrate` — `UPDATE` до `P24M` (dev-fix для смоук-запусков);
  - `ensureAnchors`: 9 anchor'ов, идемпотентно по title;
  - итог печатает `competency_atoms.total`, `to_calibrate`,
    `anchor_examples.total`.
- `scripts/test-catalog-v04.ts` — новый. 30 проверок:
  1. seed-предусловие (0055, total ≥ 54, anchor ≥ 9, to_calibrate = 0);
  2. 0055 метаданные (status=candidate, version=0.1.0);
  3. workflow: create → reject (без reason → 422; с reason → 200;
     merge rejected → 409);
  4. permissions (outsider create 201; in_review → 403; merge → 403);
  5. update_atom (bump version 0.2.0 → 0.3.0, definition обновлён);
  6. deprecate_atom (status 0041 → deprecated, cleanup → candidate);
  7. list merged ≥ 2.
- `scripts/lib/passport-fixtures.ts` — расширен: `createCatalogProposal`,
  `listCatalogProposals`, `setProposalStatus`, `mergeProposal`, `getAtom`.
- `scripts/test-passport-v2.ts` — п.1: `= 54` → `>= 54` (A85). Это
  **единственное** изменение контракта в треке.
- `scripts/seed-passport.ts` — сравнение `atomTotal !== ATOM_SEEDS.length`
  → `atomTotal < ATOM_SEEDS.length` (каталог расширяется, seed гарантирует
  только наличие 54 пилотов).
- `scripts/test-catalog-v04.ts` — cleanup 0001 после п.5 (иначе
  `seed-passport` откатывает version при следующем запуске → `updated=1`
  → `test-passport-v2.ts#1b` FAIL).
- CI: `smoke: catalog-v04` (в `ci-local.ps1` + `.github/workflows/ci.yml`)
  после `smoke: passport-v7`. **Порядок:** `smoke: passport-v7` →
  `seed: catalog-v04` → `smoke: catalog-v04`.

### Решения (A77–A87)

- **A77**: `proposal_type ∈ {new_atom, update_atom, deprecate_atom}`.
- **A78**: `merge` — отдельный роут (approve ≠ merge). `approve` —
  решение, `merge` — запись. §16.1.
- **A79**: `CYB.ATOM.0055` — новый ID после 0054, не переиспользуется.
- **A80**: кластер `requirements_and_computational_thinking` — не
  расширяем CHECK на новый.
- **A81**: все 5 измерений применимы. `E` — «проверить, понял ли
  слушатель» (обоснование в `assessment_criteria.E`).
- **A82**: 3 атома × 3 уровня = 9 anchor'ов.
- **A83**: `anchor_examples` без status; черновые — через `description:
  'Черновой'`, `version = 1`.
- **A84**: anchor'ы создаются через API от admin (`seed-catalog-v04.ts`),
  не SQL.
- **A85**: `test-passport-v2.ts` п.1 `= 54` → `>= 54`.
- **A86**: без TTL. `draft` может висеть. Очистка — cron, если понадобится
  (3f).
- **A87**: только п.1. Остальные v2–v7 не трогаем.

### Не сделано (осознанно)

- **UI `CatalogProposalPage.tsx`** (`/catalog/proposals/:id`) — §5 шаг 5
  плана. Workflow работает через API; UI — для UX. Отложен. Причина:
  без реальных пользователей proposals — редкая операция (сейчас
  1–2 за прогон), API достаточен.
- **Полная калибровка 0–9** реальными сессиями — отдельно (3f).
- **AI-рекомендации** — 3f (LLM-провайдер).
- **S3-загрузка anchor'ов** — 3f (если понадобится).
- **approved статус для 0055** — требует «Коннект» (§16.1, §19.5),
  не код.

### Технический долг

- `seed-passport.ts` откатывает изменения pilot-атомов, внесённые через
  `catalog_proposals`. Это **правильное поведение** для dev, но в проде,
  если workflow станет основным путём обновления каталога, потребуется
  `--skip-pilots` или `WHERE status NOT IN ('approved','deprecated')`
  в seed-логике. Зафиксировано, решается в 3f или при первом реальном
  use-case.
- `bumpMinorVersion` в `catalog-proposals.ts` — упрощённый semver
  (`0.1.0 → 0.2.0`). Для major/minor bump нужен явный флаг в payload
  (не в 3d/v0.4).
- `nextAtomId` — `MAX(atom_id)+1` под транзакцией, но без advisory lock.
  При параллельных merge двух new_atom — race → 23505 (UNIQUE). В 3f:
  `pg_advisory_xact_lock(hashtext('catalog_atoms_next_id'))` перед SELECT MAX.

### Тесты и CI

- `pnpm typecheck` / `pnpm typecheck:web` — зелёные.
- `pnpm exec vite build` — success. lazy-чанки: `CatalogProposalPage`
  отсутствует (UI не сделан), `TeamsListPage` / `TeamPage` /
  `CalibrationListPage` / `CalibrationPage` — на месте. `INEFFECTIVE_DYNAMIC_IMPORT` нет.
- `pnpm tsx scripts/test-passport.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v2.ts` — **16/16 PASS**.
- `pnpm tsx scripts/test-passport-v3.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v4.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v5.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v6.ts` — зелёный.
- `pnpm tsx scripts/test-passport-v7.ts` — зелёный.
- `pnpm tsx scripts/seed-catalog-v04.ts` — идемпотентен
  (`updated=0`, `SKIP × 10`, `total=55`, `to_calibrate=0`, `anchor=18`).
- `pnpm tsx scripts/test-catalog-v04.ts` — **30/30 PASS**.
- `bash scripts/smoke-passport.sh` — зелёный.
- CI: `smoke: catalog-v04` в `ci-local.ps1` + «Smoke — каталог v0.4»
  в `.github/workflows/ci.yml` (после `seed: catalog-v04`).

### Как проверять (актуальные команды)

```bash
pnpm db:migrate
pnpm typecheck
pnpm typecheck:web
pnpm exec vite build

# passport v2–v7
pnpm tsx scripts/test-passport.ts    "+79001234567" "ChangeMe123456"
pnpm tsx scripts/test-passport-v2.ts
pnpm tsx scripts/test-passport-v3.ts
pnpm tsx scripts/test-passport-v4.ts
pnpm tsx scripts/test-passport-v5.ts
pnpm tsx scripts/test-passport-v6.ts
pnpm tsx scripts/test-passport-v7.ts

# catalog v0.4
pnpm tsx scripts/seed-catalog-v04.ts
pnpm tsx scripts/test-catalog-v04.ts

# smoke
bash scripts/smoke-passport.sh

Дописать в раздел «Сделано (файлы) → UI»:

markdown
- `src/web/pages/CatalogProposalPage.tsx` — новый. `/catalog/proposals/:id`.
  Просмотр + действия по статусу (submit / in_review / approve / reject /
  merge). Роли: автор видит submit своего draft; FA/COUNCIL видят
  in_review/approve/reject/merge. Права проверяются на бэке; UI
  скрывает кнопки для UX.
- `src/web/App.tsx` — lazy-роут `/catalog/proposals/:id` (чанк ~5 KB).
- `src/web/types.ts` — DTO `PassportCatalogProposal`,
  `PassportCatalogProposalType`, `PassportCatalogProposalStatus`.
И «Не сделано» — обновить:

markdown
- Список предложений (`/catalog/proposals`) — TODO 3f. Сейчас попасть
  на деталь можно по прямой ссылке (ID из API или из ответа при
  создании). Для ревьюера — редкая операция (1–2 proposals за прогон),
  API достаточно.
И «Технический долг»:

markdown
- `CatalogProposalPage` — без списка. При появлении реальных авторов
  (не-разработчиков) — нужен `/catalog/proposals` (список с фильтром
  по статусу/атору). 3f.