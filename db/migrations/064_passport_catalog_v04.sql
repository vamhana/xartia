-- 064 — Каталог v0.4: workflow предложений (§16.1) + deprecate-комментарий.
-- См. docs/passport-catalog-v04.md.
--
-- 1. catalog_proposals — workflow «предложение → ревью → утверждение → merge».
-- 2. passport_history_events.event_type += catalog_proposal_created,
--    catalog_proposal_merged.
-- 3. COMMENT ON participant_competencies — «ёмкость», не «паспорт».
--
-- Педагогическая компетенция (CYB.ATOM.0055) и 9 anchor'ов создаются
-- через seed-catalog-v04.ts (API), НЕ через миграцию.

-- ─────────────────────────────────────────────────────────────────────
-- 1. catalog_proposals
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_type   VARCHAR(24) NOT NULL
    CHECK (proposal_type IN ('new_atom', 'update_atom', 'deprecate_atom')),
  -- Для new_atom: atom_id NULL (генерируется при merge).
  -- Для update_atom/deprecate_atom: atom_id обязателен.
  atom_id         TEXT REFERENCES competency_atoms(atom_id) ON DELETE SET NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft','submitted','in_review','approved','rejected','merged'
    )),
  reason          TEXT,
  review_note     TEXT,
  created_by      UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  reviewed_by     UUID REFERENCES participants(id) ON DELETE SET NULL,
  merged_by       UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  merged_at       TIMESTAMPTZ,
  CONSTRAINT chk_catalog_proposals_target
    CHECK (
      -- new_atom создаёт атом при merge; атом_id проставляется
      -- постфактум (status='merged') для прослеживаемости.
      (proposal_type = 'new_atom'
        AND (atom_id IS NULL OR status = 'merged'))
      OR (proposal_type IN ('update_atom','deprecate_atom') AND atom_id IS NOT NULL)
    ),
  CONSTRAINT chk_catalog_proposals_reason
    CHECK (reason IS NULL OR status = 'rejected'),
  CONSTRAINT chk_catalog_proposals_payload_object
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_catalog_proposals_status
  ON catalog_proposals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_proposals_atom
  ON catalog_proposals(atom_id) WHERE atom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_proposals_created_by
  ON catalog_proposals(created_by);

-- Триггер updated_at: DEFAULT now() — только INSERT. Без триггера
-- колонка была бы «мёртвой» при UPDATE (см. review от 2026-11-05).
CREATE OR REPLACE FUNCTION catalog_proposals_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catalog_proposals_touch_updated_at
  ON catalog_proposals;
CREATE TRIGGER trg_catalog_proposals_touch_updated_at
  BEFORE UPDATE ON catalog_proposals
  FOR EACH ROW EXECUTE FUNCTION catalog_proposals_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 2. event_type += catalog_proposal_created, catalog_proposal_merged
-- ─────────────────────────────────────────────────────────────────────
-- DROP CONSTRAINT IF EXISTS — не завязано на имя (в 058/062 имя
-- совпадает с дефолтным, но IF EXISTS страхует от ручных переименований).

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
    'catalog_proposal_created','catalog_proposal_merged'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- 3. COMMENT ON participant_competencies — «ёмкость», не «паспорт»
-- ─────────────────────────────────────────────────────────────────────
-- COMMENT ON принимает ровно один Sconst (литерал), не выражение.
-- Многострочный литерал через dollar-quoting.

COMMENT ON TABLE participant_competencies IS $comment$
Домен «ёмкость» (053). Уровни 1..5, используется в src/core/capacity.

Не путать с person_atom_states (058) — это профессиональный паспорт,
уровни 0..9. Паспорт и ёмкость — разные модели; не сводить.
$comment$;