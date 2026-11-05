-- 062 — Фаза 3c профессионального паспорта.
-- См. docs/passport-phase3c.md.
--
-- 1. team_capabilities         — способность команды как целого (§11.4).
-- 2. team_capability_assessments — история оценок команды.
-- 3. passport_visibility.scope += 'team' (A54, A55).
-- 4. passport_history_events.event_type += 'team_assessed' (A57).
--
-- Принципы (A47):
--   * participants — JSONB array<UUID> (состав команды).
--   * assessor_id ∉ participants — триггер BEFORE INSERT/UPDATE
--     (CHECK с подзапросом в PG невозможен).
--   * FK на participants(id) для assessor_id — да (assessor должен существовать).
--   * FK на участников в JSONB — НЕ проверяется в БД (валидация в API).
--   * TeamCapability НЕ учитывается в width/depth индивидуального паспорта
--     (§11.4: «не сводится к сумме индивидуальных»).

-- ─────────────────────────────────────────────────────────────────────
-- 1. team_capabilities
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_capabilities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  expected_result   TEXT NOT NULL,
  participants      JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- criteria shape: { [criterionKey: string]: { description?: string } }
  -- A56: criteria_scores в assess использует ключи из criteria.
  assessor_id       UUID REFERENCES participants(id) ON DELETE RESTRICT,
  status            VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'assessed', 'deprecated')),
  created_by        UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_team_capabilities_participants_array
    CHECK (jsonb_typeof(participants) = 'array'),
  CONSTRAINT chk_team_capabilities_criteria_object
    CHECK (jsonb_typeof(criteria) = 'object'),
  CONSTRAINT chk_team_capabilities_participants_nonempty
    CHECK (jsonb_array_length(participants) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_team_capabilities_status
  ON team_capabilities(status);

CREATE INDEX IF NOT EXISTS idx_team_capabilities_assessor
  ON team_capabilities(assessor_id) WHERE assessor_id IS NOT NULL;

-- GIN-индекс на participants — для поиска «я в командах» (GET /teams).
CREATE INDEX IF NOT EXISTS idx_team_capabilities_participants_gin
  ON team_capabilities USING GIN (participants);

-- ─────────────────────────────────────────────────────────────────────
-- 1.1. Триггер: assessor_id ∉ participants (A47)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION team_capabilities_assessor_not_in_participants()
RETURNS TRIGGER AS $$
DECLARE
  in_participants BOOLEAN;
BEGIN
  IF NEW.assessor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(NEW.participants) AS p(pid)
     WHERE p.pid = NEW.assessor_id::text
  ) INTO in_participants;

  IF in_participants THEN
    RAISE EXCEPTION
      'team_capabilities.assessor_id (%) must not be in participants',
      NEW.assessor_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_team_capabilities_assessor_check
  ON team_capabilities;
CREATE TRIGGER trg_team_capabilities_assessor_check
  BEFORE INSERT OR UPDATE OF participants, assessor_id
  ON team_capabilities
  FOR EACH ROW EXECUTE FUNCTION team_capabilities_assessor_not_in_participants();

-- ─────────────────────────────────────────────────────────────────────
-- 2. team_capability_assessments (append-only)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_capability_assessments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           UUID NOT NULL
    REFERENCES team_capabilities(id) ON DELETE CASCADE,
  level             SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 9),
  criteria_scores   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- shape: { [criterionKey: string]: number 0..9 }
  context           JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessor_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  assessed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_team_assessments_scores_object
    CHECK (jsonb_typeof(criteria_scores) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_team_assessments_team
  ON team_capability_assessments(team_id, assessed_at DESC);

-- Append-only (по аналогии с passport_history_events).
CREATE OR REPLACE FUNCTION team_capability_assessments_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'team_capability_assessments is append-only: % not allowed (id=%)',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_team_capability_assessments_immutable
  ON team_capability_assessments;
CREATE TRIGGER trg_team_capability_assessments_immutable
  BEFORE UPDATE OR DELETE ON team_capability_assessments
  FOR EACH ROW EXECUTE FUNCTION team_capability_assessments_immutable();

-- ─────────────────────────────────────────────────────────────────────
-- 3. passport_visibility.scope += 'team'
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'passport_visibility'::regclass
       AND conname = 'passport_visibility_scope_check'
  ) THEN
    ALTER TABLE passport_visibility
      DROP CONSTRAINT passport_visibility_scope_check;
  END IF;
END $$;

ALTER TABLE passport_visibility
  ADD CONSTRAINT passport_visibility_scope_check
  CHECK (scope IN ('public', 'mentor', 'assessor', 'task', 'team'));

-- ─────────────────────────────────────────────────────────────────────
-- 4. passport_history_events.event_type += 'team_assessed'
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
    'teaching_relation_created','teaching_relation_revoked',
    -- Фаза 3b
    'permit_issued','permit_revoked',
    'mentor_question_asked','mentor_question_answered',
    -- Фаза 3c
    'team_assessed'
  ));