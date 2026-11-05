-- 059 — Фаза 2 профессионального паспорта (аддитивно к 058).
-- См. docs/passport-phase2.md.
--
-- 1. passport_scope_grants — явные разрешения на доступ к чужому паспорту
--    (scope=mentor|assessor|task) с TTL и отзывом. Реализует §18.2 «доступ
--    предоставляется только на заявленную цель и в минимально необходимом
--    объёме… может быть ограничен по сроку и отозван».
-- 2. passport_evidence: supersedes_evidence_id (заменило) и
--    reused_from_evidence_id (переиспользовано из) — разные семантики, разные FK.
-- 3. passport_assessment_evidence — явная связь assessment ↔ evidence
--    (§7.2.1: dispute → under_review только связанных).
-- 4. passport_history_events.event_type CHECK — расширение новыми типами.
-- 5. Индекс на passport_evidence(status) WHERE status='disputed'.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Явные гранты на доступ
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passport_scope_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  scope       VARCHAR(16) NOT NULL
    CHECK (scope IN ('mentor','assessor','task')),
  task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
  reason      TEXT,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (subject_id <> viewer_id),
  CHECK (scope <> 'task' OR task_id IS NOT NULL),
  -- ВНИМАНИЕ: UNIQUE (subject_id, viewer_id, scope, task_id) не работает
  -- для task_id IS NULL (Postgres: NULL ≠ NULL). Отдельный partial UNIQUE
  -- ниже.
  UNIQUE (subject_id, viewer_id, scope, task_id)
);

-- Один активный non-task грант на (subject, viewer, scope).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_passport_scope_grants_active_non_task
  ON passport_scope_grants(subject_id, viewer_id, scope)
  WHERE task_id IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_passport_scope_grants_viewer
  ON passport_scope_grants(viewer_id, scope)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_passport_scope_grants_subject
  ON passport_scope_grants(subject_id, scope)
  WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Evidence: «заменило» и «переиспользовано из»
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE passport_evidence
  ADD COLUMN IF NOT EXISTS supersedes_evidence_id UUID
    REFERENCES passport_evidence(id) ON DELETE SET NULL;

ALTER TABLE passport_evidence
  ADD COLUMN IF NOT EXISTS reused_from_evidence_id UUID
    REFERENCES passport_evidence(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Явная связь assessment ↔ evidence (для disputed workflow)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passport_assessment_evidence (
  assessment_id UUID NOT NULL REFERENCES passport_assessments(id) ON DELETE CASCADE,
  evidence_id   UUID NOT NULL REFERENCES passport_evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (assessment_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_passport_assessment_evidence_evidence
  ON passport_assessment_evidence(evidence_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Расширение event_type CHECK (идемпотентно через DO/DROP/ADD)
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
    'claim_declared',
    'evidence_submitted','evidence_accepted','evidence_rejected',
    'evidence_disputed','evidence_dispute_resolved',
    'assessment_created','assessment_activated','assessment_under_review',
    'assessment_invalidated','assessment_superseded',
    'appeal_filed','appeal_resolved',
    'visibility_changed',
    'grant_created','grant_revoked',
    'path_created','path_completed','path_abandoned'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- 5. Индекс на активные споры (быстрый поиск для resolve workflow)
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_passport_evidence_disputed
  ON passport_evidence(status, atom_id, dimension)
  WHERE status = 'disputed';