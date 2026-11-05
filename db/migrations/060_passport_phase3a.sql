-- 060 — Фаза 3a профессионального паспорта.
-- См. docs/passport-phase3a.md.
--
-- 1. task_profiles        — профиль задачи через атомы (§11.1).
--    task_profiles_history — append-only, по аналогии с passport_history_events.
-- 2. teaching_relations   — per-atom наставничество (§12).
-- 3. atom_direction_map   — маппинг атом → 17 направлений (§14).
-- 4. mentor_questions.atom_id — опциональная привязка вопроса к атому.
-- 5. passport_history_events.event_type CHECK — расширение.
--
-- Принципы:
--   * tasks.required_competencies (legacy JSONB) не трогаем.
--   * participants.mentor_id (основной наставник) не трогаем.
--     teaching_relations — per-atom детализация, живут параллельно (A22).
--   * Идемпотентно: IF NOT EXISTS / DO $$ IF EXISTS.
--   * Append-only для history — триггер (как 058).

-- ─────────────────────────────────────────────────────────────────────
-- 1. TaskProfile
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL UNIQUE
    REFERENCES tasks(id) ON DELETE CASCADE,
  required_atoms        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- shape: [{ atom_id: string,
  --           min: {U?,X?,D?,P?,E?: 0..9},
  --           role: 'executor'|'designer'|'consultant'|'assessor' }]
  permit_ids            JSONB NOT NULL DEFAULT '[]'::jsonb,
  acceptance_criteria   JSONB,
  evidence_form         JSONB,
  security_constraints  JSONB,
  version               INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  status                VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','deprecated')),
  created_by            UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_task_profiles_required_atoms_array
    CHECK (jsonb_typeof(required_atoms) = 'array'),
  CONSTRAINT chk_task_profiles_permit_ids_array
    CHECK (jsonb_typeof(permit_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_task_profiles_status
  ON task_profiles(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS task_profiles_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_profile_id  UUID NOT NULL
    REFERENCES task_profiles(id) ON DELETE CASCADE,
  version          INT NOT NULL,
  snapshot         JSONB NOT NULL,
  actor_id         UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_profiles_history_profile
  ON task_profiles_history(task_profile_id, version DESC);

-- Append-only: триггер по аналогии с passport_history_events (058).
CREATE OR REPLACE FUNCTION task_profiles_history_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'task_profiles_history is append-only: % not allowed (id=%)',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_profiles_history_immutable
  ON task_profiles_history;
CREATE TRIGGER trg_task_profiles_history_immutable
  BEFORE UPDATE OR DELETE ON task_profiles_history
  FOR EACH ROW EXECUTE FUNCTION task_profiles_history_immutable();

-- ─────────────────────────────────────────────────────────────────────
-- 2. TeachingRelation (per-atom)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teaching_relations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id     UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  mentee_id     UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  atom_id       TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE CASCADE,
  dimensions    JSONB NOT NULL DEFAULT '["U","X","D","P","E"]'::jsonb,
  -- shape: ['U','X','D','P','E'] — какие измерения mentor готов вести.
  status        VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked','expired')),
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to      TIMESTAMPTZ,
  reason        TEXT,
  created_by    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_teaching_relations_not_self
    CHECK (mentor_id <> mentee_id),
  CONSTRAINT chk_teaching_relations_dimensions_array
    CHECK (jsonb_typeof(dimensions) = 'array')
);

-- Один активный relation на (mentor, mentee, atom). Отозванные/истёкшие
-- могут дублироваться (история).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_teaching_relations_active
  ON teaching_relations(mentor_id, mentee_id, atom_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_teaching_relations_mentee
  ON teaching_relations(mentee_id, atom_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_teaching_relations_mentor
  ON teaching_relations(mentor_id, atom_id) WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────
-- 3. AtomDirectionMap (17 направлений Хартии)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atom_direction_map (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id       TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE CASCADE,
  direction_id  UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  role          VARCHAR(16) NOT NULL
    CHECK (role IN ('home','main','related')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (atom_id, direction_id, role)
);

CREATE INDEX IF NOT EXISTS idx_atom_direction_map_direction
  ON atom_direction_map(direction_id, role);

CREATE INDEX IF NOT EXISTS idx_atom_direction_map_atom
  ON atom_direction_map(atom_id, role);

-- ─────────────────────────────────────────────────────────────────────
-- 4. mentor_questions.atom_id (опциональная привязка)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE mentor_questions
  ADD COLUMN IF NOT EXISTS atom_id TEXT
    REFERENCES competency_atoms(atom_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mentor_questions_atom
  ON mentor_questions(atom_id) WHERE atom_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. passport_history_events.event_type — расширить CHECK
--    (новые типы для 3a). Идемпотентно через DO / DROP / ADD.
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'passport_history_events'::regclass
       AND conname = 'passport_history_events_event_type_check'
  ) THEN
    ALTER TABLE passport_history_events
      DROP CONSTRAINT passport_history_events_event_type_check;
  END IF;
END $$;

ALTER TABLE passport_history_events
  ADD CONSTRAINT passport_history_events_event_type_check
  CHECK (event_type IN (
    -- Фаза 1
    'claim_declared',
    'evidence_submitted','evidence_accepted','evidence_rejected',
    -- Фаза 2
    'evidence_disputed','evidence_dispute_resolved',
    'assessment_created','assessment_activated','assessment_under_review',
    'assessment_invalidated','assessment_superseded',
    'appeal_filed','appeal_resolved',
    'visibility_changed',
    'grant_created','grant_revoked',
    'path_created','path_completed','path_abandoned',
    -- Фаза 3a
    'task_profile_created','task_profile_updated',
    'teaching_relation_created','teaching_relation_revoked'
  ));