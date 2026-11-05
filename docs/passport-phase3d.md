# Фаза 3d — калибровка-инфраструктура + полный граф + техдолг 3c

**Дата:** 2026-11-05
**Статус:** закрыта (2026-11-05).
**План:** `docs/passport-phase3d.md` (см. историю — план был в чате,
здесь — отчёт о реализации).

## Изменения плана

### Сделано

**Миграция:** `db/migrations/063_passport_phase3d.sql`:
- `anchor_examples` (atom_id, dimension, level, title, description,
  content JSONB, version, created_by);
- `calibration_sessions` (atom_id, dimension, status ∈ {draft, open,
  closed}, deadline);
- `calibration_assignments` (session, anchor, assessor, level NULL,
  note, scored_at, UNIQUE(session, anchor, assessor));
- `passport_assessments` += `criteria_version`, `anchor_example_id`;
- индекс `team_capabilities.created_by`.

**Домен:**
- `src/core/passport/calibration.ts` — anchor CRUD, session, assign,
  score (только назначенный assessor, повтор → 409), report
  (maxDiff, needsThird при ≥ 2, без медианы).
- `src/core/passport/graph.ts` — `getGraph(viewerId, opts)`:
  узлы (54 → 55 после 0055), рёбра (133), meta; фильтры cluster,
  direction, filter ∈ {all, assessed, not_assessed}; deprecated
  отфильтрованы.
- `src/core/passport/teams.ts` — `updateTeam` (PATCH, техдолг 3c).
- `src/core/passport/types.ts` — DTO: AnchorExample, CalibrationSession,
  CalibrationAssignment, CalibrationReport, GraphNode, GraphEdge,
  GraphPayload, GraphNodeDimension, CreateAnchorInput,
  CreateSessionInput, CreateAssignmentInput.

**API (10 путей):**
- `POST/GET /passport/calibration/anchors`
- `POST/GET /passport/calibration/sessions`,
  `GET /passport/calibration/sessions/:id`
- `POST /passport/calibration/sessions/:id/assign`
- `POST /passport/calibration/assignments/:id/score`
- `GET /passport/calibration/sessions/:id/report`
- `PATCH /passport/teams/:teamId`
- `GET /passport/participants?ids=` (batch)
- `GET /passport/graph`

**UI:**
- `src/web/components/passport/GraphView.tsx` — force-directed SVG
  (150 итераций), toggle graph/table, filter, `<title>` на узлах,
  клик → onSelectAtom.
- `src/web/pages/Passport.tsx` — вкладка «Граф».
- `src/web/pages/CalibrationListPage.tsx` — `/calibration`.
- `src/web/pages/CalibrationPage.tsx` — `/calibration/:id` (summary +
  maxDiff/needsThird).
- `src/web/App.tsx` — 2 lazy-роута; `AdminLayout` вынесен из barrel
  (прямой lazy-импорт из `./pages/admin/AdminLayout`).
- `src/web/components/layout/Sidebar.tsx` — «Калибровка» (FA/COUNCIL).
- `src/web/pages/TeamPage.tsx` — ParticipantList через batch.
- `src/web/components/passport/TeamAssessmentPanel.tsx` — assessor
  через batch.

**Тесты/CI:**
- `scripts/lib/passport-fixtures.ts` += createAnchor, listAnchors,
  createCalibrationSession, assignAnchor, scoreAssignment,
  getSessionReport, updateTeam, getBatchParticipants, getGraph.
- `scripts/test-passport-v7.ts` — новый. 34 проверки:
  1. Anchor CRUD (201, 403, list, 404, 422);
  2. Session (201, 403);
  3. Assign (201 ×2, 409, 422 mismatch);
  4. Score (200 ×2, 409 повтор, 403 чужой, 422 level);
  5. Report (worksCount, scored=2, flagged=1, maxDiff=4, needsThird);
  6. Update team (200, 422 assessor ∈ participants);
  7. Batch participants (2/2, фильтрация невалидных);
  8. Graph (54/133, cluster → 10, direction=13 → 16, filter).
- `scripts/ci-local.ps1` — `smoke: passport-v7`.
- `.github/workflows/ci.yml` — «Smoke — паспорт v7».

### Решения (A60–A70)

- A60: anchor content — JSONB `{text?, url?, media_type?}`, без S3.
- A61: anchor создаёт FA | COUNCIL.
- A62: граф — вкладка в Passport.
- A63: 54 узла (55 после 0055), не агрегация.
- A64: PATCH team — name, expectedResult, participants, criteria.
  status не меняется (deprecated — отдельный роут в Группе 2).
- A65: batch `GET /passport/participants?ids=` в passport/controller.
- A66: deadline опционален, report.overdue — флаг.
- A67: assignment append-only по духу; score только если level IS NULL;
  повтор → 409.
- A68: report без медианы (§6.5 п.3).
- A69: третий assessor — новый assignAnchor (отдельный роут не нужен).
- A70: criteria_version — заполнение в submitAssessment —
  techdebt (закрыто в Группе 1, миграция 065).

### Не сделано (осознанно)

- Реальные anchor примеры — контентная задача (специалисты).
- S3-загрузка anchor — 3f.
- AI-рекомендации — 3f.
- Медиана/полная статистика — 3e (сейчас только maxDiff).
- Педагогическая компетенция как атом — трек «каталог v0.4».
- Team matching — 3e.

### Технический долг

- `getGraph` и `getOverview` фильтруют `status <> 'deprecated'`.
  История сохранена, `getAtomById` работает.
- `v8 lock-atoms` deprecated не удаляются (FK RESTRICT). Урок:
  `catalog_proposals` merge → атом навсегда.

### Тесты

- `test-passport-v2..v6` — зелёные.
- `test-passport-v7` — 34/34.
- `test-catalog-v04` — 30/30 (после 0055).
- `smoke-passport-teaching` — 12/12.
- `typecheck`, `typecheck:web`, `vite build` — зелёные.