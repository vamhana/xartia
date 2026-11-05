-- 061 — Фаза 3b профессионального паспорта.
-- См. docs/passport-phase3b.md.
--
-- 1. permits             — справочник допусков (§10.3).
-- 2. participant_permits — выдача допуска участнику.
-- 3. passport_history_events.event_type CHECK — расширение
--    (permit_issued, permit_revoked, mentor_question_asked,
--     mentor_question_answered).
--
-- Принципы (A33–A37, A40–A41):
--   * Permit не выводится из уровней атомов (§10.3) — отдельная процедура.
--   * issued_by — свободный текст (внешний орган), БЕЗ интеграций в 3b.
--   * created_by / participant_permits.issued_by — UUID (актор в системе).
--   * valid_until — опционально (null = бессрочно).
--   * Идемпотентно: IF NOT EXISTS / DO $$ IF EXISTS.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Справочник допусков
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS permits (
  permit_id             TEXT PRIMARY KEY
    CHECK (permit_id ~ '^PERMIT\.[A-Z][A-Z0-9_]*\.[0-9]{4}$'),
  name                  TEXT NOT NULL,
  issued_by             TEXT NOT NULL,   -- свободный текст (внешний орган)
  scope                 TEXT,            -- «до 15 м» и т.п.
  valid_until           TIMESTAMPTZ,     -- NULL = бессрочный
  verification_method   TEXT NOT NULL,   -- свободный текст
  status                VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  created_by            UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permits_status
  ON permits(status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_permits_created_by
  ON permits(created_by);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Выдача допуска участнику
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS participant_permits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  permit_id          TEXT NOT NULL REFERENCES permits(permit_id) ON DELETE RESTRICT,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until        TIMESTAMPTZ,        -- NULL → бессрочно (см. также permits.valid_until)
  verification_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  issued_by          UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID REFERENCES participants(id) ON DELETE SET NULL,
  revoke_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один активный допуск на (participant, permit). Отозванные могут дублироваться.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_participant_permits_active
  ON participant_permits(participant_id, permit_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_participant_permits_participant
  ON participant_permits(participant_id, status);

CREATE INDEX IF NOT EXISTS idx_participant_permits_permit
  ON participant_permits(permit_id, status);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Расширение event_type CHECK (идемпотентно)
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
    'mentor_question_asked','mentor_question_answered'
  ));