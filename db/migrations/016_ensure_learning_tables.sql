-- D.2.01.16 — Ensure Learning tables.
-- В D.2.01.03 эти таблицы могли отсутствовать. Создаём идемпотентно.

BEGIN;

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status enrollment_status_enum NOT NULL DEFAULT 'enrolled',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (course_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_participant
  ON enrollments (participant_id, status);

CREATE TABLE IF NOT EXISTS digital_mentor_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_type varchar(16) NOT NULL DEFAULT 'ai',
  active_mentees integer NOT NULL DEFAULT 0,
  algorithm_version varchar(64) NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  direction_1_id uuid NOT NULL REFERENCES directions(id),
  direction_2_id uuid NOT NULL REFERENCES directions(id),
  module_basic_defense boolean NOT NULL DEFAULT false,
  module_respect boolean NOT NULL DEFAULT false,
  passed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_participant
  ON refresh_courses (participant_id);

CREATE TABLE IF NOT EXISTS module_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  module varchar(64) NOT NULL,
  passed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_module_passes_participant_module
  ON module_passes (participant_id, module);

DO $$
BEGIN
  RAISE NOTICE 'learning tables ensured';
END $$;

COMMIT;