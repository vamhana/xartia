-- 065 — Фикс: passport_assessments.criteria_version → VARCHAR(16).
-- В 063 ошибочно объявлен INTEGER, а competency_atoms.version — VARCHAR(16)
-- ('0.2.0'). При первом submitAssessment с version запись упала бы
-- на "invalid input syntax for type integer: '0.2.0'".
--
-- Также: event_type += 'team_deprecated' (техдолг 3c, п.2.3 группы 2).
-- Можно вынести в 066, но проще одной миграцией.
--
-- Идемпотентно.

-- ─────────────────────────────────────────────────────────────────────
-- 1. criteria_version: INTEGER → VARCHAR(16)
-- ─────────────────────────────────────────────────────────────────────
-- IF EXISTS — страховка на случай, если колонки нет (не должно быть
-- после 063, но миграция должна быть перезапускаемой).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'passport_assessments'
       AND column_name = 'criteria_version'
       AND data_type = 'integer'
  ) THEN
    ALTER TABLE passport_assessments
      ALTER COLUMN criteria_version TYPE VARCHAR(16)
      USING criteria_version::text;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. event_type += 'team_deprecated'
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE passport_history_events
  DROP CONSTRAINT IF EXISTS passport_history_events_event_type_check;

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
    'team_assessed',
    -- Каталог v0.4
    'catalog_proposal_created','catalog_proposal_merged',
    -- Группа 1 техдолгов (3c)
    'team_deprecated'
  ));