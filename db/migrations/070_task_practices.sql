-- ============================================================================
-- 070 — TeachingPracticeLink (обучение на производстве, ТЗ §3.5).
--
-- Связь учитель ↔ ученик через две реальные задачи:
--   source_task_id  — задача учителя, на примере которой идёт обучение;
--   learner_task_id — собственная задача ученика, где он применяет
--                     изучаемое. Учитель не подменяет ученика в этой задаче.
--
-- Согласие обеих сторон: teacher_consent / learner_consent. Статус 'active'
-- только когда обе true. Инициатор (created_by) автоматически даёт согласие
-- за себя.
--
-- Педагогическая компетенция как отдельная сущность в модели ОТСУТСТВУЕТ.
-- Проверяется только предметная readiness по атому (computeReadiness).
-- Это архитектурный пробел, зафиксирован в отчёте.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS task_practices (
  id                       UUID PRIMARY KEY,
  teacher_id               UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  learner_id               UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  source_task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  learner_task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  competency_atom_id       TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE RESTRICT,
  expected_learning_result TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'active', 'submitted', 'completed', 'cancelled')),
  teacher_consent          BOOLEAN NOT NULL DEFAULT false,
  learner_consent          BOOLEAN NOT NULL DEFAULT false,
  created_by               UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancel_reason            TEXT,

  CONSTRAINT chk_tp_distinct_participants CHECK (teacher_id <> learner_id),
  CONSTRAINT chk_tp_cancel_reason
    CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CONSTRAINT chk_tp_active_consents
    CHECK (status <> 'active' OR (teacher_consent AND learner_consent))
);

-- Одна активная практика на пару (teacher, learner, atom).
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_practices_active_pair
  ON task_practices (teacher_id, learner_id, competency_atom_id)
  WHERE status IN ('proposed', 'active', 'submitted');

CREATE INDEX IF NOT EXISTS idx_task_practices_teacher
  ON task_practices(teacher_id, status);

CREATE INDEX IF NOT EXISTS idx_task_practices_learner
  ON task_practices(learner_id, status);

-- Для проверки I.2.12 в OTC (Этап 5): «учитель не принимает результат ученика».
CREATE INDEX IF NOT EXISTS idx_task_practices_learner_task
  ON task_practices(learner_task_id) WHERE status IN ('active', 'submitted', 'completed');

COMMIT;