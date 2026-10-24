-- ============================================================================
-- 003_tables.sql
-- XartIA Charter 5.0 — создание всех таблиц
-- Зависит от: 001_extensions.sql, 002_enums.sql
-- Порядок: D.1.01 → D.1.34 → D.1.99
-- ============================================================================

BEGIN;

-- ============================================================================
-- D.1.01.01 — Auth
-- ============================================================================

CREATE TABLE auth_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL,
  token_hash      VARCHAR(64) NOT NULL UNIQUE,
  refresh_hash    VARCHAR(64) NOT NULL UNIQUE,
  ip              INET,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE registration_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           VARCHAR(512) NOT NULL,            -- encrypted (pgcrypto)
  phone_hash      VARCHAR(64) NOT NULL,             -- HMAC-SHA256
  messengers      JSONB NOT NULL,
  status          registration_status_enum NOT NULL DEFAULT 'new',
  assigned_to     UUID,
  interview_at    TIMESTAMPTZ,
  notes           TEXT,
  consent_video   BOOLEAN NOT NULL DEFAULT false,
  consent_data    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_registration_messengers
    CHECK (jsonb_typeof(messengers) = 'object'
           AND messengers <> '{}'::jsonb)
);

CREATE TABLE interviews (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              UUID NOT NULL REFERENCES registration_requests(id) ON DELETE CASCADE,
  interviewer_id          UUID NOT NULL,
  video_url               TEXT,
  transcript              TEXT,
  questions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_cognitive         INT CHECK (score_cognitive BETWEEN 0 AND 10),
  score_behavioral        INT CHECK (score_behavioral BETWEEN 0 AND 10),
  score_reflective        INT CHECK (score_reflective BETWEEN 0 AND 10),
  score_technical         INT CHECK (score_technical BETWEEN 0 AND 10),
  recommendation_direction UUID,
  recommendation_profession UUID,
  recommendation_role     VARCHAR(64),
  verdict                 interview_verdict_enum NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interview_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    VARCHAR(64) NOT NULL,
  question    TEXT NOT NULL,
  author_id   UUID,
  version     INT NOT NULL DEFAULT 1,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_registration_phone_hash ON registration_requests(phone_hash);
CREATE INDEX idx_registration_status     ON registration_requests(status, created_at DESC);
CREATE INDEX idx_registration_assigned   ON registration_requests(assigned_to)
  WHERE status = 'interview_scheduled';
CREATE INDEX idx_auth_sessions_participant ON auth_sessions(participant_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_sessions_expires   ON auth_sessions(expires_at);
CREATE INDEX idx_interviews_request      ON interviews(request_id);
CREATE INDEX idx_interview_questions_active ON interview_questions(active)
  WHERE active = true;

-- ============================================================================
-- D.1.02.01 — Participants
-- ============================================================================

CREATE TABLE participants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id         VARCHAR(32) NOT NULL UNIQUE,
  wave_letter         CHAR(1),
  wave_number         INT CHECK (wave_number BETWEEN 0 AND 99999),
  direction_id        UUID NOT NULL,
  subdirection        VARCHAR(64),
  profession_id       UUID,
  name                VARCHAR(255) NOT NULL,
  pseudonym           VARCHAR(64),
  phone               VARCHAR(512) NOT NULL,        -- encrypted
  phone_hash          VARCHAR(64) NOT NULL UNIQUE,
  messengers          JSONB NOT NULL DEFAULT '{}'::jsonb,
  password_hash       VARCHAR(255) NOT NULL,
  status              participant_status_enum NOT NULL DEFAULT 'associated',
  profile_risk        risk_enum NOT NULL DEFAULT 'compatible',
  mentor_id           UUID,
  cell_id             UUID,
  geolocation         GEOGRAPHY(POINT, 4326),
  geo_enabled         BOOLEAN NOT NULL DEFAULT false,
  entered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  welcome_pack_given  BOOLEAN NOT NULL DEFAULT false,
  is_first_architect  BOOLEAN NOT NULL DEFAULT false,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_external_id_format
    CHECK (external_id ~ '^[А-Я]?\d{5}-\d{1,2}(:.+)?$')
);

CREATE UNIQUE INDEX uniq_first_architect ON participants(is_first_architect)
  WHERE is_first_architect = true;

CREATE TABLE participant_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  field           VARCHAR(64) NOT NULL,
  old_value       JSONB,
  new_value       JSONB,
  reason          TEXT,
  authorized_by   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE participant_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status          participant_status_enum NOT NULL,
  reason          TEXT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ
);

CREATE INDEX idx_participants_external_id  ON participants(external_id);
CREATE INDEX idx_participants_phone_hash   ON participants(phone_hash);
CREATE INDEX idx_participants_direction    ON participants(direction_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_participants_status       ON participants(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_participants_mentor       ON participants(mentor_id) WHERE mentor_id IS NOT NULL;
CREATE INDEX idx_participants_cell         ON participants(cell_id) WHERE cell_id IS NOT NULL;
CREATE INDEX idx_participants_geo          ON participants USING GIST(geolocation) WHERE geo_enabled = true;
CREATE INDEX idx_history_participant       ON participant_history(participant_id, created_at DESC);
CREATE INDEX idx_status_history_participant ON participant_status_history(participant_id, valid_from DESC);

-- ============================================================================
-- D.1.03.01 — Directions
-- ============================================================================

CREATE TABLE directions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number          INT NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 99),
  name            VARCHAR(128) NOT NULL,
  type            direction_type_enum NOT NULL,
  status          direction_status_enum NOT NULL DEFAULT 'active',
  zone_exclusive  JSONB NOT NULL DEFAULT '[]'::jsonb,
  zone_shared     JSONB NOT NULL DEFAULT '[]'::jsonb,
  zone_adjacent   JSONB NOT NULL DEFAULT '[]'::jsonb,
  council_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  abolished_at    TIMESTAMPTZ
);

CREATE TABLE professions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  name            VARCHAR(128) NOT NULL,
  competencies    JSONB NOT NULL DEFAULT '[]'::jsonb,
  roles           JSONB NOT NULL DEFAULT '[]'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  name            VARCHAR(128) NOT NULL,
  type            role_type_enum NOT NULL,
  rights          JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_term_days   INT,
  max_terms       INT,
  cooldown_days   INT,
  conflicts_with  JSONB NOT NULL DEFAULT '[]'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE participant_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  direction_id    UUID REFERENCES directions(id) ON DELETE RESTRICT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,
  status          role_assignment_status_enum NOT NULL DEFAULT 'active',
  granted_by      UUID
);

CREATE TABLE councils (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  type            council_type_enum NOT NULL,
  status          council_status_enum NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE council_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id      UUID NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,
  term_number     INT NOT NULL DEFAULT 1,
  status          council_member_status_enum NOT NULL DEFAULT 'active'
);

CREATE INDEX idx_directions_number        ON directions(number);
CREATE INDEX idx_directions_status        ON directions(status);
CREATE INDEX idx_professions_direction    ON professions(direction_id, active);
CREATE INDEX idx_roles_direction          ON roles(direction_id, active);
CREATE INDEX idx_participant_roles_participant ON participant_roles(participant_id, status) WHERE status = 'active';
CREATE INDEX idx_participant_roles_role   ON participant_roles(role_id, status);
CREATE INDEX idx_council_members_council  ON council_members(council_id, status) WHERE status = 'active';
CREATE INDEX idx_council_members_participant ON council_members(participant_id, status);

-- ============================================================================
-- D.1.04.01 — Cells
-- ============================================================================

CREATE TABLE cells (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level           INT NOT NULL CHECK (level BETWEEN 0 AND 11),
  number          VARCHAR(16) NOT NULL,
  profile         VARCHAR(64),
  parent_cell_id  UUID REFERENCES cells(id) ON DELETE CASCADE,
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  members_count   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_cell_number_level UNIQUE (level, number)
);

CREATE TABLE cell_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id         UUID NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  role_in_cell    cell_role_enum NOT NULL DEFAULT 'member',
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ
);

CREATE INDEX idx_cells_parent      ON cells(parent_cell_id) WHERE parent_cell_id IS NOT NULL;
CREATE INDEX idx_cells_direction   ON cells(direction_id);
CREATE INDEX idx_cells_level       ON cells(level);
CREATE INDEX idx_cell_members_cell ON cell_members(cell_id) WHERE valid_to IS NULL;
CREATE INDEX idx_cell_members_participant ON cell_members(participant_id) WHERE valid_to IS NULL;

-- ============================================================================
-- D.1.05.01 — Mandates
-- ============================================================================

CREATE TABLE mandates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function        VARCHAR(128) NOT NULL,
  direction_id    UUID REFERENCES directions(id) ON DELETE RESTRICT,
  holder_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  granted_by      UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  status          mandate_status_enum NOT NULL DEFAULT 'active',
  conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope           JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_mandate_expires CHECK (expires_at > granted_at)
);

CREATE TABLE delegations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function        VARCHAR(128) NOT NULL,
  from_id         UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  to_id           UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  direction_id    UUID REFERENCES directions(id) ON DELETE RESTRICT,
  scope           JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL,
  status          delegation_status_enum NOT NULL DEFAULT 'active',
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID REFERENCES participants(id),
  CONSTRAINT chk_delegation_dates CHECK (valid_to > valid_from)
);

CREATE TABLE rotations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id      UUID NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  executed_at     TIMESTAMPTZ,
  successor_id    UUID REFERENCES participants(id),
  status          rotation_status_enum NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE cooldowns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reason          VARCHAR(128) NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_mandates_holder   ON mandates(holder_id, status) WHERE status = 'active';
CREATE INDEX idx_mandates_function ON mandates(function, direction_id, status);
CREATE INDEX idx_mandates_expires  ON mandates(expires_at) WHERE status = 'active';
CREATE INDEX idx_delegations_to    ON delegations(to_id, status) WHERE status = 'active';
CREATE INDEX idx_delegations_from  ON delegations(from_id, status);
CREATE INDEX idx_rotations_scheduled ON rotations(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_cooldowns_participant ON cooldowns(participant_id, valid_to);

-- ============================================================================
-- D.1.06.01 — Plans
-- ============================================================================

CREATE TABLE plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id         VARCHAR(64) NOT NULL UNIQUE,
  type                plan_type_enum NOT NULL,
  title               VARCHAR(255) NOT NULL,
  expected_result     TEXT NOT NULL,
  lead_direction_id   UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  status              plan_status_enum NOT NULL DEFAULT 'draft',
  criteria            JSONB NOT NULL DEFAULT '{}'::jsonb,
  checkpoints         JSONB NOT NULL DEFAULT '[]'::jsonb,
  stop_conditions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by         UUID REFERENCES participants(id),
  approved_at         TIMESTAMPTZ,
  signed_by_keeper    UUID REFERENCES participants(id),
  signature           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_external_id_format
    CHECK (external_id ~ '^PLAN-\d{4}-\d{2}-\d{2}-\d{3}$'),
  CONSTRAINT chk_crisis_plan_scenario
    CHECK (type <> 'crisis' OR criteria ? 'scenario')
);

CREATE TABLE plan_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  task_id           UUID NOT NULL,
  assigned_direction UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  role              plan_task_role_enum NOT NULL DEFAULT 'executor'
);

CREATE TABLE daily_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  approved_by     UUID REFERENCES participants(id),
  status          daily_plan_status_enum NOT NULL DEFAULT 'draft',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_daily_plan_dir_date UNIQUE (direction_id, date)
);

CREATE INDEX idx_plans_external_id    ON plans(external_id);
CREATE INDEX idx_plans_status         ON plans(status, type);
CREATE INDEX idx_plans_lead_direction ON plans(lead_direction_id);
CREATE INDEX idx_plan_tasks_plan      ON plan_tasks(plan_id);
CREATE INDEX idx_plan_tasks_task      ON plan_tasks(task_id);
CREATE INDEX idx_daily_plans_dir_date ON daily_plans(direction_id, date DESC);

-- ============================================================================
-- D.1.07.01 — Tasks
-- ============================================================================

CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           VARCHAR(64) NOT NULL UNIQUE,
  plan_id               UUID REFERENCES plans(id) ON DELETE SET NULL,
  direction_id          UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  description           TEXT NOT NULL,
  required_competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  location              GEOGRAPHY(POINT, 4326),
  priority              priority_enum NOT NULL,
  status                task_status_enum NOT NULL DEFAULT 'created',
  assigned_to           UUID REFERENCES participants(id) ON DELETE SET NULL,
  deadline              TIMESTAMPTZ,
  parent_task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_external_id_format
    CHECK (external_id ~ '^[А-Я]{3}-\d{4}-\d{2}-\d{2}-\d{3}$'),
  CONSTRAINT chk_priority_deadline
    CHECK (priority <> 'critical' OR deadline IS NOT NULL)
);

CREATE INDEX idx_tasks_external_id ON tasks(external_id);
CREATE INDEX idx_tasks_status      ON tasks(status, priority, deadline);
CREATE INDEX idx_tasks_assigned    ON tasks(assigned_to) WHERE status IN ('assigned', 'in_progress');
CREATE INDEX idx_tasks_direction   ON tasks(direction_id, status);
CREATE INDEX idx_tasks_plan        ON tasks(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_tasks_deadline    ON tasks(deadline) WHERE status NOT IN ('accepted', 'returned');
CREATE INDEX idx_tasks_geo         ON tasks USING GIST(location) WHERE location IS NOT NULL;
CREATE INDEX idx_tasks_parent      ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- ============================================================================
-- D.1.08.01 — Reports
-- ============================================================================

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  type            report_type_enum NOT NULL,
  media_url       TEXT,
  media_size      BIGINT,
  comment         TEXT,
  geolocation     GEOGRAPHY(POINT, 4326),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_report_type_media CHECK (
    (type = 'text'  AND comment IS NOT NULL) OR
    (type IN ('photo','video') AND media_url IS NOT NULL)
  )
);

CREATE INDEX idx_reports_task        ON reports(task_id, created_at DESC);
CREATE INDEX idx_reports_participant ON reports(participant_id, created_at DESC);
CREATE INDEX idx_reports_geo         ON reports USING GIST(geolocation) WHERE geolocation IS NOT NULL;

-- ============================================================================
-- D.1.09.01 — OTC
-- ============================================================================

CREATE TABLE otc_decisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  otc_id            UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  verdict           otc_verdict_enum NOT NULL,
  comment           TEXT,
  criteria_version  INT NOT NULL,
  crisis_protocol   BOOLEAN NOT NULL DEFAULT false,
  audited_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otc_appeals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     UUID NOT NULL REFERENCES otc_decisions(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  reason          TEXT NOT NULL,
  status          appeal_status_enum NOT NULL DEFAULT 'filed',
  reviewed_by     UUID REFERENCES participants(id),
  result          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE acceptance_criteria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  task_type       VARCHAR(64) NOT NULL,
  criteria        JSONB NOT NULL,
  version         INT NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  active          BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_criteria_version UNIQUE (direction_id, task_type, version)
);

CREATE INDEX idx_otc_decisions_report  ON otc_decisions(report_id);
CREATE INDEX idx_otc_decisions_otc     ON otc_decisions(otc_id, created_at DESC);
CREATE INDEX idx_otc_decisions_crisis  ON otc_decisions(crisis_protocol) WHERE crisis_protocol = true;
CREATE INDEX idx_otc_appeals_decision  ON otc_appeals(decision_id);
CREATE INDEX idx_otc_appeals_participant ON otc_appeals(participant_id, status);
CREATE INDEX idx_criteria_direction_active ON acceptance_criteria(direction_id, task_type, active) WHERE active = true;

-- ============================================================================
-- D.1.10.01 — Signals / Connections / Arbitrations / UniversalRuns
-- ============================================================================

CREATE TABLE signals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id        VARCHAR(64) NOT NULL UNIQUE,
  initiator_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  type               signal_type_enum NOT NULL,
  description        TEXT NOT NULL,
  justification      TEXT NOT NULL,
  directions         JSONB NOT NULL DEFAULT '[]'::jsonb,
  desired_deadline   TIMESTAMPTZ,
  priority           priority_enum NOT NULL,
  status             signal_status_enum NOT NULL DEFAULT 'new',
  iterations         INT NOT NULL DEFAULT 0 CHECK (iterations >= 0),
  lead_direction_id  UUID REFERENCES directions(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_external_id_format
    CHECK (external_id ~ '^SIG-\d{4}-\d{2}-\d{2}-\d{3}$')
);

CREATE TABLE signal_attributes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       UUID NOT NULL UNIQUE REFERENCES signals(id) ON DELETE CASCADE,
  speed_planned   INTERVAL,
  speed_actual    INTERVAL,
  format_ok       BOOLEAN NOT NULL DEFAULT true,
  etiquette_ok    BOOLEAN NOT NULL DEFAULT true,
  returns_count   INT NOT NULL DEFAULT 0
);

CREATE TABLE responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  response        signal_response_enum NOT NULL,
  justification   TEXT,
  data            JSONB,
  consequences    TEXT,
  needs           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  moderator_id        UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  status              connection_status_enum NOT NULL DEFAULT 'started',
  positions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  cause               TEXT,
  result              connection_result_enum,
  protocol            JSONB,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  diagnostic_deadline TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_connection_result
    CHECK (status = 'finished' OR result IS NULL)
);

CREATE TABLE arbitrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            arbitration_type_enum NOT NULL,
  connection_id   UUID REFERENCES connections(id) ON DELETE SET NULL,
  signal_id       UUID REFERENCES signals(id) ON DELETE SET NULL,
  parties         JSONB NOT NULL DEFAULT '[]'::jsonb,
  question        TEXT NOT NULL,
  decision        TEXT,
  status          arbitration_status_enum NOT NULL DEFAULT 'submitted',
  deadline        TIMESTAMPTZ NOT NULL,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE universal_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id            UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  type                 universal_run_type_enum NOT NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ,
  status               run_status_enum NOT NULL DEFAULT 'started',
  total_directions     INT NOT NULL,
  responded_directions INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_signals_external_id   ON signals(external_id);
CREATE INDEX idx_signals_status_priority ON signals(status, priority, created_at DESC);
CREATE INDEX idx_signals_initiator     ON signals(initiator_id);
CREATE INDEX idx_signals_lead          ON signals(lead_direction_id) WHERE lead_direction_id IS NOT NULL;
CREATE INDEX idx_signals_iterations    ON signals(iterations) WHERE iterations >= 3;
CREATE INDEX idx_responses_signal      ON responses(signal_id);
CREATE INDEX idx_responses_direction   ON responses(direction_id, created_at DESC);
CREATE INDEX idx_connections_signal    ON connections(signal_id);
CREATE INDEX idx_connections_status    ON connections(status, diagnostic_deadline);
CREATE INDEX idx_arbitrations_status   ON arbitrations(status, deadline);
CREATE INDEX idx_arbitrations_signal   ON arbitrations(signal_id) WHERE signal_id IS NOT NULL;
CREATE INDEX idx_runs_signal           ON universal_runs(signal_id);
CREATE INDEX idx_runs_status           ON universal_runs(status, started_at);

-- ============================================================================
-- D.1.14.01 — Flows (партиционированная flow_transactions)
-- ============================================================================

CREATE TABLE flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  type            flow_type_enum NOT NULL,
  balance         NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_flows_participant_type UNIQUE (participant_id, type)
);

CREATE TABLE flow_transactions (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL,
  type            flow_type_enum NOT NULL,
  amount          NUMERIC(20,4) NOT NULL,
  reason          TEXT NOT NULL,
  source          VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Начальные партиции (январь–март 2026)
CREATE TABLE flow_transactions_2026_10 PARTITION OF flow_transactions
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE flow_transactions_2026_11 PARTITION OF flow_transactions
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE flow_transactions_2026_12 PARTITION OF flow_transactions
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE flow_transactions_2027_01 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE flow_transactions_2027_02 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE flow_transactions_2027_03 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE flow_transactions_2027_04 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE flow_transactions_2027_05 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE flow_transactions_2027_06 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE flow_transactions_2027_07 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE flow_transactions_2027_08 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE flow_transactions_2027_09 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE flow_transactions_2027_10 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE flow_transactions_2027_11 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE flow_transactions_2027_12 PARTITION OF flow_transactions
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE flow_transactions_default PARTITION OF flow_transactions DEFAULT;

CREATE TABLE capsules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
  balance         NUMERIC(20,4) NOT NULL DEFAULT 0
    CHECK (balance >= 0 AND balance <= 180),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deferred_flow (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_volume    NUMERIC(20,4) NOT NULL DEFAULT 0,
  distributed     NUMERIC(20,4) NOT NULL DEFAULT 0,
  available       NUMERIC(20,4) GENERATED ALWAYS AS (total_volume - distributed) STORED,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE freedom_reserve (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_volume    NUMERIC(20,4) NOT NULL DEFAULT 0,
  accessible      BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE planetary_reserve (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_volume    NUMERIC(20,4) NOT NULL DEFAULT 0,
  distributed     NUMERIC(20,4) NOT NULL DEFAULT 0,
  available       NUMERIC(20,4) GENERATED ALWAYS AS (total_volume - distributed) STORED,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE flow_returns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
  percent           NUMERIC(6,2) NOT NULL CHECK (percent IN (30, 60)),
  next_return_at    TIMESTAMPTZ NOT NULL,
  status            flow_return_status_enum NOT NULL DEFAULT 'active',
  paused_at         TIMESTAMPTZ,
  paused_reason     VARCHAR(128)
);

CREATE INDEX idx_flows_participant       ON flows(participant_id);
CREATE INDEX idx_flow_tx_participant     ON flow_transactions(participant_id, created_at DESC);
CREATE INDEX idx_flow_tx_type            ON flow_transactions(type, created_at DESC);
CREATE INDEX idx_flow_returns_next       ON flow_returns(next_return_at) WHERE status = 'active';

-- ============================================================================
-- D.1.15.01 — Goods
-- ============================================================================

CREATE TABLE goods (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  type                  good_type_enum NOT NULL,
  status                good_status_enum NOT NULL DEFAULT 'draft',
  producer_direction_id UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  components            JSONB NOT NULL DEFAULT '[]'::jsonb,
  author_ids            JSONB NOT NULL DEFAULT '[]'::jsonb,
  connector_id          UUID REFERENCES participants(id),
  tester_id             UUID REFERENCES participants(id),
  approver_id           UUID REFERENCES participants(id),
  version               INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  description           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE good_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  good_id     UUID NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  changes     JSONB NOT NULL,
  author_id   UUID NOT NULL REFERENCES participants(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE good_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  good_id         UUID NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  modifier_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          good_request_status_enum NOT NULL DEFAULT 'pending',
  experimental    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE project_resources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  resource        JSONB NOT NULL,
  council_sign    UUID REFERENCES participants(id),
  balance_sign    UUID REFERENCES participants(id),
  verifier_sign   UUID REFERENCES participants(id),
  status          project_resource_status_enum NOT NULL DEFAULT 'pending',
  external_mark   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at       TIMESTAMPTZ,
  CONSTRAINT chk_project_resource_external
    CHECK (external_mark = false OR council_sign IS NOT NULL)
);

CREATE INDEX idx_goods_status              ON goods(status, type);
CREATE INDEX idx_goods_producer            ON goods(producer_direction_id, status);
CREATE INDEX idx_good_history_good         ON good_history(good_id, version DESC);
CREATE INDEX idx_good_requests_participant ON good_requests(participant_id, status);
CREATE INDEX idx_project_resources_plan    ON project_resources(plan_id);
CREATE INDEX idx_project_resources_pending ON project_resources(status) WHERE status = 'pending';

-- ============================================================================
-- D.1.16.01 — Standards
-- ============================================================================

CREATE TABLE standards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        VARCHAR(64) NOT NULL,
  norm            NUMERIC(20,4) NOT NULL CHECK (norm > 0),
  version         INT NOT NULL DEFAULT 1,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     UUID REFERENCES participants(id),
  deprecated_at   TIMESTAMPTZ,
  CONSTRAINT uniq_standards_category_version UNIQUE (category, version)
);

CREATE TABLE modifiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(128) NOT NULL,
  condition       JSONB NOT NULL,
  coefficient     NUMERIC(6,4) NOT NULL CHECK (coefficient BETWEEN -1 AND 10),
  status          modifier_status_enum NOT NULL DEFAULT 'pending',
  requested_by    UUID REFERENCES participants(id),
  approved_by     UUID REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  reason_rejected TEXT,
  CONSTRAINT chk_modifier_condition_object CHECK (jsonb_typeof(condition) = 'object')
);

CREATE INDEX idx_standards_category    ON standards(category, published_at DESC) WHERE deprecated_at IS NULL;
CREATE INDEX idx_modifiers_status      ON modifiers(status);
CREATE INDEX idx_modifiers_requested_by ON modifiers(requested_by) WHERE requested_by IS NOT NULL;

-- ============================================================================
-- D.1.17.01 — Regimes
-- ============================================================================

CREATE TABLE regimes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            regime_type_enum NOT NULL,
  direction_id    UUID REFERENCES directions(id) ON DELETE SET NULL,
  activated_by    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at  TIMESTAMPTZ,
  status          regime_status_enum NOT NULL DEFAULT 'active',
  conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_schedule  INTERVAL,
  max_duration    INTERVAL,
  reason          TEXT
);

CREATE UNIQUE INDEX uniq_active_regime_type
  ON regimes(type)
  WHERE status = 'active'
    AND type NOT IN ('red_circuit', 'quantum_acceleration');

CREATE TABLE regime_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regime_id   UUID NOT NULL REFERENCES regimes(id) ON DELETE CASCADE,
  action      VARCHAR(128) NOT NULL,
  actor_id    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crisis_mobilizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regime_id         UUID NOT NULL REFERENCES regimes(id) ON DELETE CASCADE,
  required_count    INT NOT NULL,
  confirmed_count   INT NOT NULL DEFAULT 0,
  refused_count     INT NOT NULL DEFAULT 0,
  threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (threshold_percent BETWEEN 0 AND 100),
  status            mobilization_status_enum NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  CONSTRAINT chk_mobilization_counts
    CHECK (confirmed_count >= 0 AND refused_count >= 0
           AND confirmed_count + refused_count <= required_count)
);

CREATE TABLE crisis_refusals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobilization_id UUID NOT NULL REFERENCES crisis_mobilizations(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_regimes_active         ON regimes(type) WHERE status = 'active';
CREATE INDEX idx_regimes_type           ON regimes(type, activated_at DESC);
CREATE INDEX idx_regime_actions_regime  ON regime_actions(regime_id, created_at DESC);
CREATE INDEX idx_mobilizations_active   ON crisis_mobilizations(regime_id) WHERE status = 'active';
CREATE INDEX idx_refusals_mobilization  ON crisis_refusals(mobilization_id);

-- ============================================================================
-- D.1.18.01 — Balance
-- ============================================================================

CREATE TABLE balance_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID REFERENCES directions(id) ON DELETE SET NULL,
  period          TSTZRANGE NOT NULL,
  metrics         JSONB NOT NULL,
  anomalies       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meta_flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  speed           INTERVAL,
  format_ok       BOOLEAN NOT NULL DEFAULT true,
  etiquette_ok    BOOLEAN NOT NULL DEFAULT true,
  priority_ok     BOOLEAN NOT NULL DEFAULT true,
  returns_count   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anomalies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            anomaly_type_enum NOT NULL,
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  severity        INT NOT NULL CHECK (severity BETWEEN 1 AND 10),
  status          anomaly_status_enum NOT NULL DEFAULT 'new',
  meta_request_id UUID,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE competence_risks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  status          competence_risk_status_enum NOT NULL DEFAULT 'active',
  reason          TEXT NOT NULL,
  verified_by     UUID REFERENCES participants(id),
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ
);

CREATE TABLE normative_speeds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  priority        priority_enum NOT NULL,
  deadline_ms     BIGINT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_normative_speed_priority_version UNIQUE (priority, version)
);

CREATE TABLE guardian_indices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            guardian_index_type_enum NOT NULL,
  value           NUMERIC(6,4) NOT NULL CHECK (value BETWEEN 0 AND 1),
  direction_id    UUID REFERENCES directions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- planetary_pulse — создаётся ПОСЛЕ D.1.26.01 (FK на communities)
-- см. ниже в разделе D.1.26.01

CREATE INDEX idx_balance_metrics_direction ON balance_metrics(direction_id, period);
CREATE INDEX idx_balance_metrics_period    ON balance_metrics USING GIST(period);
CREATE INDEX idx_meta_flows_signal         ON meta_flows(signal_id);
CREATE INDEX idx_anomalies_status          ON anomalies(status, severity DESC);
CREATE INDEX idx_anomalies_direction       ON anomalies(direction_id, created_at DESC);
CREATE INDEX idx_competence_risks_active   ON competence_risks(direction_id) WHERE status = 'active';
CREATE INDEX idx_normative_speeds_priority ON normative_speeds(priority, version DESC);
CREATE INDEX idx_guardian_indices_type     ON guardian_indices(type, created_at DESC);

-- ============================================================================
-- D.1.19.01 — Verification
-- ============================================================================

CREATE TABLE audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            audit_type_enum NOT NULL,
  subject         VARCHAR(128) NOT NULL,
  subject_id      UUID,
  initiator_id    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  status          audit_status_enum NOT NULL DEFAULT 'open',
  result          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE audit_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  finding         TEXT NOT NULL,
  severity        INT NOT NULL CHECK (severity BETWEEN 1 AND 10),
  recommendation  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verification_rechecks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  otc_decision_id UUID NOT NULL REFERENCES otc_decisions(id) ON DELETE CASCADE,
  verifier_id     UUID NOT NULL REFERENCES participants(id),
  result          recheck_result_enum NOT NULL,
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE code_audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system          code_system_enum NOT NULL,
  version         VARCHAR(64) NOT NULL,
  findings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  conducted_by    UUID NOT NULL REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE integrity_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system          VARCHAR(128) NOT NULL,
  source_node     VARCHAR(128) NOT NULL,
  action          integrity_action_enum NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  handled_at      TIMESTAMPTZ,
  resolution      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audits_status             ON audits(status, type);
CREATE INDEX idx_audits_subject            ON audits(subject, subject_id);
CREATE INDEX idx_audits_initiator          ON audits(initiator_id);
CREATE INDEX idx_audit_findings_audit      ON audit_findings(audit_id);
CREATE INDEX idx_rechecks_decision         ON verification_rechecks(otc_decision_id);
CREATE INDEX idx_rechecks_verifier         ON verification_rechecks(verifier_id, created_at DESC);
CREATE INDEX idx_code_audits_system        ON code_audits(system, created_at DESC);
CREATE INDEX idx_integrity_alerts_unhandled ON integrity_alerts(created_at) WHERE handled_at IS NULL;
CREATE INDEX idx_integrity_alerts_system   ON integrity_alerts(system, created_at DESC);

-- ============================================================================
-- D.1.20.01 — Archive
-- ============================================================================

CREATE TABLE archive_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            archive_doc_type_enum NOT NULL,
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
  subject         VARCHAR(255) NOT NULL,
  content         JSONB NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  signed_by       UUID REFERENCES participants(id),
  signature       TEXT,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE decision_chains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id        UUID NOT NULL,
  step            INT NOT NULL CHECK (step >= 1),
  type            chain_step_type_enum NOT NULL,
  ref_id          UUID NOT NULL,
  description     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_chain_step UNIQUE (chain_id, step)
);

CREATE TABLE id_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  external_id     VARCHAR(32) NOT NULL,
  community_code  VARCHAR(2) CHECK (community_code IS NULL OR community_code ~ '^[А-Я]{2}$'),
  internal_id     VARCHAR(32),
  global_id       VARCHAR(64),
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ
);

CREATE TABLE cross_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_a_id   UUID NOT NULL REFERENCES archive_documents(id) ON DELETE CASCADE,
  document_b_id   UUID NOT NULL REFERENCES archive_documents(id) ON DELETE CASCADE,
  discrepancies   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_archive_documents_type       ON archive_documents(type, archived_at DESC);
CREATE INDEX idx_archive_documents_direction  ON archive_documents(direction_id, archived_at DESC);
CREATE INDEX idx_archive_documents_signed     ON archive_documents(signed_by) WHERE signed_by IS NOT NULL;
CREATE INDEX idx_archive_documents_subject_fts ON archive_documents
  USING GIN(to_tsvector('russian', subject));
CREATE INDEX idx_chains_chain_id              ON decision_chains(chain_id, step);
CREATE INDEX idx_id_registry_participant      ON id_registry(participant_id);
CREATE INDEX idx_id_registry_external         ON id_registry(external_id);
CREATE INDEX idx_id_registry_global           ON id_registry(global_id) WHERE global_id IS NOT NULL;
CREATE INDEX idx_cross_checks_a               ON cross_checks(document_a_id);
CREATE INDEX idx_cross_checks_b               ON cross_checks(document_b_id);

-- ============================================================================
-- D.1.21.01 — Justice + Jury
-- ============================================================================

CREATE TABLE complaints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            complaint_type_enum NOT NULL,
  applicant_id    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  anonymous       BOOLEAN NOT NULL DEFAULT false,
  description     TEXT NOT NULL,
  status          complaint_status_enum NOT NULL DEFAULT 'filed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

CREATE TABLE investigations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id        UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  investigator_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_id           UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  status              investigation_status_enum NOT NULL DEFAULT 'open',
  deadline            TIMESTAMPTZ NOT NULL,
  result              TEXT,
  victim_rights       JSONB NOT NULL DEFAULT '{}'::jsonb,
  audited_by          UUID REFERENCES participants(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ
);

CREATE TABLE isolation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL,
  conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  imposed_by      UUID NOT NULL REFERENCES participants(id),
  lifted_at       TIMESTAMPTZ,
  lifted_by       UUID REFERENCES participants(id),
  lift_reason     TEXT,
  CONSTRAINT chk_isolation_dates CHECK (valid_to > valid_from)
);

CREATE TABLE resocialization (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  program         JSONB NOT NULL,
  mentors         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          resocialization_status_enum NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE sanctions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  type            sanction_type_enum NOT NULL,
  basis           TEXT NOT NULL,
  decided_by      UUID NOT NULL REFERENCES participants(id),
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          sanction_status_enum NOT NULL DEFAULT 'imposed',
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE jury_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            jury_session_type_enum NOT NULL,
  subject_id      UUID NOT NULL,
  participants    JSONB NOT NULL,
  moderator_id    UUID NOT NULL REFERENCES participants(id),
  votes           JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  CONSTRAINT chk_jury_participants
    CHECK (jsonb_typeof(participants) = 'array'
           AND jsonb_array_length(participants) IN (12, 24))
);

CREATE TABLE appeals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jury_session_id UUID REFERENCES jury_sessions(id) ON DELETE SET NULL,
  council_type    VARCHAR(64) NOT NULL,
  subject_id      UUID NOT NULL,
  result          TEXT,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outside_trust_network (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_at       TIMESTAMPTZ NOT NULL,
  status          outside_trust_status_enum NOT NULL DEFAULT 'active',
  lifted_at       TIMESTAMPTZ
);

CREATE INDEX idx_complaints_status           ON complaints(status, created_at DESC);
CREATE INDEX idx_complaints_applicant        ON complaints(applicant_id);
CREATE INDEX idx_investigations_status       ON investigations(status, deadline);
CREATE INDEX idx_investigations_target       ON investigations(target_id);
CREATE INDEX idx_isolation_target            ON isolation(target_id) WHERE lifted_at IS NULL;
CREATE INDEX idx_isolation_expires           ON isolation(valid_to) WHERE lifted_at IS NULL;
CREATE INDEX idx_resocialization_target      ON resocialization(target_id, status);
CREATE INDEX idx_sanctions_target            ON sanctions(target_id, status);
CREATE INDEX idx_jury_sessions_status        ON jury_sessions(decided_at) WHERE decided_at IS NULL;
CREATE INDEX idx_appeals_subject             ON appeals(subject_id);
CREATE INDEX idx_outside_trust_active        ON outside_trust_network(participant_id) WHERE status = 'active';

-- ============================================================================
-- D.1.22.01 — Psy
-- ============================================================================

CREATE TABLE psy_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  psychologist_id UUID NOT NULL REFERENCES participants(id),
  type            psy_session_type_enum NOT NULL,
  notes           TEXT,
  status          psy_session_status_enum NOT NULL DEFAULT 'scheduled',
  scheduled_at    TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE psy_observers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ
);

CREATE UNIQUE INDEX uniq_psy_observer_direction
  ON psy_observers(direction_id) WHERE valid_to IS NULL;

CREATE TABLE psy_crises (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status          psy_crisis_status_enum NOT NULL DEFAULT 'open',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

CREATE TABLE psy_discharges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  days            INT NOT NULL CHECK (days >= 3),
  status          psy_discharge_status_enum NOT NULL DEFAULT 'scheduled',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE mood_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  metric          VARCHAR(64) NOT NULL,
  value           NUMERIC(6,4) NOT NULL CHECK (value BETWEEN 0 AND 1),
  period          TSTZRANGE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wellbeing (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  score           INT NOT NULL CHECK (score BETWEEN 1 AND 10),
  trend           trend_enum NOT NULL DEFAULT 'stable',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hygiene (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  measure         TEXT NOT NULL,
  status          hygiene_status_enum NOT NULL DEFAULT 'proposed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ
);

CREATE INDEX idx_psy_sessions_participant  ON psy_sessions(participant_id, scheduled_at DESC);
CREATE INDEX idx_psy_sessions_psychologist ON psy_sessions(psychologist_id, status);
CREATE INDEX idx_psy_crises_open           ON psy_crises(status) WHERE status <> 'closed';
CREATE INDEX idx_psy_discharges_active     ON psy_discharges(status) WHERE status <> 'completed';
CREATE INDEX idx_mood_metrics_direction    ON mood_metrics(direction_id, period);
CREATE INDEX idx_wellbeing_participant     ON wellbeing(participant_id, created_at DESC);
CREATE INDEX idx_hygiene_status            ON hygiene(direction_id, status);

-- ============================================================================
-- D.1.23.01 — Gateway (ИЗОЛИРОВАННАЯ БД — не в core!)
-- ВНИМАНИЕ: этот блок выполняется в отдельной БД charter_gateway.
-- В dev/staging можно оставить в одном инстансе, но в prod — вынести.
-- ============================================================================

CREATE TABLE gateway_council (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL,
  term_number     INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_council_dates CHECK (valid_to > valid_from)
);

CREATE TABLE external_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              gateway_tx_type_enum NOT NULL,
  description       TEXT NOT NULL,
  amount_external   NUMERIC(20,4),
  resource_type     VARCHAR(128),
  approved_by       UUID,
  audited_by        UUID,
  classified_until  TIMESTAMPTZ,
  status            gateway_tx_status_enum NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE external_assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  external_asset_type_enum NOT NULL,
  value                 NUMERIC(20,4) NOT NULL,
  status                external_asset_status_enum NOT NULL DEFAULT 'accepted',
  source_participant_id UUID,
  verified_by           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at          TIMESTAMPTZ
);

CREATE TABLE guarantor (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL UNIQUE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL,
  diagnosis       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          guarantor_status_enum NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_guarantor_dates CHECK (valid_to > valid_from)
);

CREATE TABLE external_witnesses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL,
  status          witness_status_enum NOT NULL DEFAULT 'active',
  since           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE external_defense (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            external_defense_type_enum NOT NULL,
  status          defense_status_enum NOT NULL DEFAULT 'inactive',
  commander_id    UUID,
  rotation_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gateway_council_valid_to  ON gateway_council(valid_to);
CREATE INDEX idx_external_tx_status        ON external_transactions(status, created_at DESC);
CREATE INDEX idx_external_tx_classified    ON external_transactions(classified_until) WHERE classified_until IS NOT NULL;
CREATE INDEX idx_external_assets_status    ON external_assets(status, created_at DESC);
CREATE INDEX idx_witnesses_status          ON external_witnesses(status) WHERE status = 'active';
CREATE INDEX idx_external_defense_type     ON external_defense(type, status);

-- ============================================================================
-- D.1.24.01 — Quanta
-- ============================================================================

CREATE TABLE quanta (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level                 INT NOT NULL CHECK (level BETWEEN 1 AND 6),
  type                  VARCHAR(64) NOT NULL,
  source_cell_id        UUID NOT NULL REFERENCES cells(id) ON DELETE RESTRICT,
  description           TEXT NOT NULL,
  area_of_applicability JSONB NOT NULL DEFAULT '{}'::jsonb,
  limitations           JSONB NOT NULL DEFAULT '{}'::jsonb,
  success_criteria      JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_criteria         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                quantum_status_enum NOT NULL DEFAULT 'detected',
  mandatory             BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quantum_criteria CHECK (
    status = 'detected' OR
    (area_of_applicability <> '{}'::jsonb
     AND success_criteria <> '{}'::jsonb
     AND stop_criteria <> '{}'::jsonb)
  )
);

CREATE TABLE quantum_tests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quantum_id      UUID NOT NULL REFERENCES quanta(id) ON DELETE CASCADE,
  cell_id         UUID NOT NULL REFERENCES cells(id) ON DELETE RESTRICT,
  result          quantum_test_result_enum NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quantum_catalog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quantum_id      UUID NOT NULL REFERENCES quanta(id) ON DELETE CASCADE,
  community_id    UUID NOT NULL,  -- FK на communities ниже
  applied         BOOLEAN NOT NULL DEFAULT false,
  applied_at      TIMESTAMPTZ,
  CONSTRAINT uniq_quantum_catalog UNIQUE (quantum_id, community_id)
);

CREATE INDEX idx_quanta_status        ON quanta(status, level);
CREATE INDEX idx_quanta_mandatory     ON quanta(mandatory) WHERE mandatory = true;
CREATE INDEX idx_quanta_source_cell   ON quanta(source_cell_id);
CREATE INDEX idx_quantum_tests_quantum ON quantum_tests(quantum_id, created_at DESC);
CREATE INDEX idx_quantum_catalog_community ON quantum_catalog(community_id, applied);

-- ============================================================================
-- D.1.25.01 — Constructor
-- ============================================================================

CREATE TABLE panels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  role_id         UUID REFERENCES roles(id) ON DELETE SET NULL,
  direction_id    UUID REFERENCES directions(id) ON DELETE SET NULL,
  context         panel_context_enum NOT NULL DEFAULT 'normal',
  version         INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  active          BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID NOT NULL REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE widgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(64) NOT NULL,
  entity          VARCHAR(64) NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_rights  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      UUID NOT NULL REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE panel_widgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id        UUID NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  widget_id       UUID NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  position        JSONB NOT NULL DEFAULT '{}'::jsonb,
  size            JSONB NOT NULL DEFAULT '{}'::jsonb,
  overrides       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rights_matrix (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id         UUID REFERENCES roles(id) ON DELETE CASCADE,
  resource        VARCHAR(64) NOT NULL,
  action          right_action_enum NOT NULL,
  scope           right_scope_enum NOT NULL,
  condition       JSONB,
  version         INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_rights_entry UNIQUE (role_id, resource, action, scope, version)
);

CREATE TABLE panel_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id        UUID NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  snapshot        JSONB NOT NULL,
  created_by      UUID NOT NULL REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_panel_version UNIQUE (panel_id, version)
);

CREATE INDEX idx_panels_role_context ON panels(role_id, context, active) WHERE active = true;
CREATE INDEX idx_panels_direction    ON panels(direction_id) WHERE direction_id IS NOT NULL;
CREATE INDEX idx_panel_widgets_panel ON panel_widgets(panel_id);
CREATE INDEX idx_widgets_type_entity ON widgets(type, entity);
CREATE INDEX idx_rights_matrix_lookup ON rights_matrix(role_id, resource, action, scope, version);
CREATE INDEX idx_panel_versions_panel ON panel_versions(panel_id, version DESC);

-- ============================================================================
-- D.1.26.01 — Planetary
-- ============================================================================

CREATE TABLE communities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                CHAR(2) NOT NULL UNIQUE CHECK (code ~ '^[А-Я]{2}$'),
  name                VARCHAR(255) NOT NULL,
  status              community_status_enum NOT NULL DEFAULT 'incubation',
  level               INT NOT NULL CHECK (level BETWEEN 0 AND 11),
  mother_community_id UUID REFERENCES communities(id) ON DELETE SET NULL,
  protocol_version    VARCHAR(16) NOT NULL DEFAULT '5.0',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE protocol_council (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  community_id    UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,
  type            council_member_type_enum NOT NULL
);

CREATE TABLE flow_bridges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_a     UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  community_b     UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  coefficient     NUMERIC(10,6) NOT NULL,
  status          bridge_status_enum NOT NULL DEFAULT 'active',
  established_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at    TIMESTAMPTZ,
  CONSTRAINT uniq_bridge_pair UNIQUE (community_a, community_b),
  CONSTRAINT chk_bridge_different CHECK (community_a <> community_b)
);

CREATE TABLE planetary_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period          VARCHAR(32) NOT NULL,
  plan            JSONB NOT NULL,
  approved_by     UUID REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global_referendums (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            referendum_type_enum NOT NULL,
  threshold       NUMERIC(5,2) NOT NULL CHECK (threshold BETWEEN 0 AND 100),
  result          JSONB,
  status          referendum_status_enum NOT NULL DEFAULT 'initiated',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ
);

CREATE TABLE expansion_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frozen          BOOLEAN NOT NULL DEFAULT false,
  reason          TEXT,
  frozen_at       TIMESTAMPTZ,
  unfrozen_at     TIMESTAMPTZ
);

-- Теперь закрываем FK из D.1.18.01 (planetary_pulse) и D.1.24.01 (quantum_catalog)

CREATE TABLE planetary_pulse (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id      UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  base_goods_level  NUMERIC(5,2),
  direction_load    JSONB NOT NULL DEFAULT '{}'::jsonb,
  top_signals       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE quantum_catalog
  ADD CONSTRAINT fk_quantum_catalog_community
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

CREATE INDEX idx_communities_status    ON communities(status);
CREATE INDEX idx_communities_mother    ON communities(mother_community_id) WHERE mother_community_id IS NOT NULL;
CREATE INDEX idx_protocol_council_member ON protocol_council(member_id) WHERE valid_to IS NULL;
CREATE INDEX idx_bridges_status        ON flow_bridges(status) WHERE status = 'active';
CREATE INDEX idx_planetary_plans_period ON planetary_plans(period, created_at DESC);
CREATE INDEX idx_referendums_status    ON global_referendums(status, type);
CREATE INDEX idx_expansion_status_frozen ON expansion_status(frozen) WHERE frozen = true;
CREATE INDEX idx_pulse_community       ON planetary_pulse(community_id, created_at DESC);

-- ============================================================================
-- D.1.27.01 — Convergence
-- ============================================================================

CREATE TABLE convergence_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_name      VARCHAR(255) NOT NULL,
  stage           INT NOT NULL CHECK (stage BETWEEN 0 AND 5),
  status          convergence_status_enum NOT NULL DEFAULT 'draft',
  coordinator_id  UUID REFERENCES participants(id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  CONSTRAINT chk_convergence_status_stage CHECK (
    (status = 'draft'      AND stage = 0) OR
    (status = 'declared'   AND stage >= 0) OR
    (status = 'in_progress' AND stage >= 1) OR
    (status IN ('completed','failed') AND stage >= 0)
  )
);

CREATE TABLE convergence_council (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES convergence_plans(id) ON DELETE CASCADE,
  members     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE debt_conversions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES convergence_plans(id) ON DELETE CASCADE,
  type        debt_type_enum NOT NULL,
  amount      NUMERIC(20,4) NOT NULL,
  action      debt_action_enum NOT NULL,
  coefficient NUMERIC(10,6),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asset_conversions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                 UUID NOT NULL REFERENCES convergence_plans(id) ON DELETE CASCADE,
  asset_type              VARCHAR(64) NOT NULL,
  value                   NUMERIC(20,4) NOT NULL,
  destination_direction_id UUID NOT NULL REFERENCES directions(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE weapon_conversions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES convergence_plans(id) ON DELETE CASCADE,
  weapon_type   VARCHAR(64) NOT NULL,
  action        weapon_action_enum NOT NULL,
  verified_by   UUID REFERENCES participants(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cultural_centers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES convergence_plans(id) ON DELETE CASCADE,
  location    GEOGRAPHY(POINT, 4326) NOT NULL,
  status      cultural_center_status_enum NOT NULL DEFAULT 'planned',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at   TIMESTAMPTZ,
  closed_at   TIMESTAMPTZ
);

CREATE INDEX idx_convergence_plans_status ON convergence_plans(status, stage);
CREATE INDEX idx_debt_conversions_plan    ON debt_conversions(plan_id);
CREATE INDEX idx_asset_conversions_plan   ON asset_conversions(plan_id);
CREATE INDEX idx_weapon_conversions_plan  ON weapon_conversions(plan_id);
CREATE INDEX idx_cultural_centers_plan    ON cultural_centers(plan_id, status);
CREATE INDEX idx_cultural_centers_geo     ON cultural_centers USING GIST(location);

-- ============================================================================
-- D.1.28.01 — Semantic
-- ============================================================================

CREATE TABLE semantic_drift (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term              VARCHAR(255) NOT NULL,
  original_meaning  TEXT NOT NULL,
  detected_meaning  TEXT NOT NULL,
  severity          INT NOT NULL CHECK (severity BETWEEN 1 AND 10),
  detected_by       UUID NOT NULL REFERENCES participants(id),
  status            drift_status_enum NOT NULL DEFAULT 'new',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

CREATE TABLE semantic_alarms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drift_id        UUID REFERENCES semantic_drift(id) ON DELETE SET NULL,
  priority        INT NOT NULL DEFAULT 10 CHECK (priority BETWEEN 1 AND 10),
  raised_by       UUID NOT NULL REFERENCES participants(id),
  status          alarm_status_enum NOT NULL DEFAULT 'raised',
  escalated_to    alarm_escalation_enum,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES participants(id),
  escalated_at    TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE vetoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            veto_type_enum NOT NULL,
  decision_ref    UUID NOT NULL,
  reason          TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL,
  status          veto_status_enum NOT NULL DEFAULT 'active',
  lifted_at       TIMESTAMPTZ,
  lift_reason     TEXT,
  CONSTRAINT chk_veto_dates CHECK (valid_to > valid_from)
);

CREATE TABLE dictionary_terms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term        VARCHAR(255) NOT NULL UNIQUE,
  definition  TEXT NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE translation_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original        TEXT NOT NULL,
  translated      TEXT NOT NULL,
  language        VARCHAR(16) NOT NULL,
  ok              BOOLEAN NOT NULL,
  drift           JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendation  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE red_button_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  context         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE systemic_violence_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  cases_count     INT NOT NULL CHECK (cases_count > 0),
  year            INT NOT NULL,
  audit_launched  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drift_status            ON semantic_drift(status, severity DESC);
CREATE INDEX idx_drift_term              ON semantic_drift(term);
CREATE INDEX idx_alarms_status           ON semantic_alarms(status, created_at DESC);
CREATE INDEX idx_alarms_unack            ON semantic_alarms(created_at) WHERE acknowledged_at IS NULL;
CREATE INDEX idx_vetoes_active           ON vetoes(status, valid_to) WHERE status = 'active';
CREATE INDEX idx_vetoes_decision         ON vetoes(decision_ref);
CREATE INDEX idx_dictionary_term         ON dictionary_terms(term);
CREATE INDEX idx_translation_checks_lang ON translation_checks(language, created_at DESC);
CREATE INDEX idx_red_button_recent       ON red_button_events(created_at DESC);
CREATE INDEX idx_violence_signals_direction ON systemic_violence_signals(direction_id, year DESC);

-- ============================================================================
-- D.1.29.01 — Experiments
-- ============================================================================

CREATE TABLE experimental_protocols (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     VARCHAR(32) NOT NULL UNIQUE
    CHECK (external_id ~ '^EXP-\d+-\d{4}$'),
  goal            TEXT NOT NULL,
  term_days       INT NOT NULL CHECK (term_days > 0 AND term_days <= 1825),
  participants    JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria        JSONB NOT NULL,
  status          experiment_status_enum NOT NULL DEFAULT 'filed',
  approved_by     UUID REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE experiment_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES experimental_protocols(id) ON DELETE CASCADE,
  successes   JSONB NOT NULL DEFAULT '[]'::jsonb,
  failures    JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats       JSONB NOT NULL DEFAULT '{}'::jsonb,
  published   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dissident_projects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id         UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  description          TEXT NOT NULL,
  petition_count       INT NOT NULL DEFAULT 0 CHECK (petition_count >= 0),
  required_percent     NUMERIC(5,2) NOT NULL DEFAULT 1,
  resource_source      dissident_resource_enum NOT NULL DEFAULT 'deferred_flow',
  status               dissident_status_enum NOT NULL DEFAULT 'filed',
  report_interval_days INT NOT NULL DEFAULT 60 CHECK (report_interval_days > 0),
  last_report_at       TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_experiments_status     ON experimental_protocols(status, created_at DESC);
CREATE INDEX idx_experiments_external_id ON experimental_protocols(external_id);
CREATE INDEX idx_results_protocol       ON experiment_results(protocol_id);
CREATE INDEX idx_dissident_status       ON dissident_projects(status, created_at DESC);
CREATE INDEX idx_dissident_initiator    ON dissident_projects(initiator_id);
CREATE INDEX idx_dissident_suspended    ON dissident_projects(last_report_at) WHERE status = 'active';

-- ============================================================================
-- D.1.30.01 — Learning
-- ============================================================================

CREATE TABLE courses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  modules         JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_days   INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status          enrollment_status_enum NOT NULL DEFAULT 'enrolled',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  CONSTRAINT uniq_enrollment UNIQUE (course_id, participant_id)
);

CREATE TABLE digital_mentor_state (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_type         VARCHAR(16) NOT NULL DEFAULT 'ai',
  active_mentees      INT NOT NULL DEFAULT 0 CHECK (active_mentees <= 50),
  algorithm_version   VARCHAR(32) NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ptt_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal            TEXT NOT NULL,
  duration_days   INT NOT NULL CHECK (duration_days > 0 AND duration_days <= 90),
  status          ptt_status_enum NOT NULL DEFAULT 'started',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE cognitive_routes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  direction_id        UUID NOT NULL REFERENCES directions(id),
  mentor_id           UUID NOT NULL REFERENCES participants(id),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              route_status_enum NOT NULL DEFAULT 'active',
  certificate_issued  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE refresh_courses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id        UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  direction_1           UUID NOT NULL REFERENCES directions(id),
  direction_2           UUID NOT NULL REFERENCES directions(id),
  module_basic_defense  BOOLEAN NOT NULL DEFAULT false,
  module_respect        BOOLEAN NOT NULL DEFAULT false,
  passed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE module_passes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  module          VARCHAR(64) NOT NULL,
  passed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE integrator_mentors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  direction_id    UUID NOT NULL REFERENCES directions(id),
  mentees         JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_mentees     INT NOT NULL DEFAULT 3 CHECK (max_mentees <= 3),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mentees_limit CHECK (jsonb_array_length(mentees) <= 3)
);

CREATE INDEX idx_courses_duration           ON courses(duration_days);
CREATE INDEX idx_enrollments_participant     ON enrollments(participant_id, status);
CREATE INDEX idx_enrollments_course          ON enrollments(course_id);
CREATE INDEX idx_ptt_status                  ON ptt_projects(status);
CREATE INDEX idx_routes_participant          ON cognitive_routes(participant_id, status);
CREATE INDEX idx_routes_direction            ON cognitive_routes(direction_id, status);
CREATE INDEX idx_refresh_participant         ON refresh_courses(participant_id);
CREATE INDEX idx_module_passes_participant   ON module_passes(participant_id, module);
CREATE INDEX idx_integrators_direction       ON integrator_mentors(direction_id);

-- ============================================================================
-- D.1.31.01 — Automation
-- ============================================================================

CREATE TABLE automation_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type               VARCHAR(64) NOT NULL,
  content            JSONB NOT NULL,
  ai_recommendation  ai_recommendation_enum NOT NULL,
  deadline           TIMESTAMPTZ NOT NULL,
  status             decision_status_enum NOT NULL DEFAULT 'pending',
  rejection_reason   TEXT,
  decided_by         UUID REFERENCES participants(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at         TIMESTAMPTZ,
  CONSTRAINT chk_rejection_reason
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE TABLE automation_sections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  operator_id     UUID REFERENCES participants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at     TIMESTAMPTZ,
  disable_reason  TEXT,
  CONSTRAINT uniq_section_direction UNIQUE (direction_id)
);

CREATE TABLE operator_audits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  approval_rate    NUMERIC(5,4) NOT NULL CHECK (approval_rate BETWEEN 0 AND 1),
  error_count      INT NOT NULL,
  status           operator_audit_status_enum NOT NULL DEFAULT 'ok',
  recommendations  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decisions_status        ON automation_decisions(status, deadline);
CREATE INDEX idx_decisions_operator      ON automation_decisions(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX idx_decisions_rejected      ON automation_decisions(status) WHERE status = 'rejected';
CREATE INDEX idx_sections_operator       ON automation_sections(operator_id) WHERE operator_id IS NOT NULL;
CREATE INDEX idx_sections_enabled        ON automation_sections(enabled) WHERE enabled = true;
CREATE INDEX idx_operator_audits_operator ON operator_audits(operator_id, created_at DESC);

-- ============================================================================
-- D.1.32.01 — Aggregator
-- ============================================================================

CREATE TABLE aggregator_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme         VARCHAR(255) NOT NULL,
  source_id     UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  priority      priority_enum NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cluster_id    UUID
);

CREATE TABLE aggregator_clusters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_ids          JSONB NOT NULL,
  pattern             TEXT NOT NULL,
  relevance           NUMERIC(5,4) NOT NULL CHECK (relevance BETWEEN 0 AND 1),
  status              cluster_status_enum NOT NULL DEFAULT 'new',
  target_direction_id UUID REFERENCES directions(id),
  validated_by        UUID REFERENCES participants(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at        TIMESTAMPTZ,
  routed_at           TIMESTAMPTZ,
  CONSTRAINT chk_signal_ids_check
    CHECK (jsonb_typeof(signal_ids) = 'array'
           AND jsonb_array_length(signal_ids) >= 2),
  CONSTRAINT chk_validated_by
    CHECK (status <> 'validated' OR validated_by IS NOT NULL)
);

CREATE TABLE aggregator_daily_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  accepted       INT NOT NULL DEFAULT 0,
  clustered      INT NOT NULL DEFAULT 0,
  validated      INT NOT NULL DEFAULT 0,
  routed         INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agg_stats_day UNIQUE (aggregator_id, date)
);

CREATE INDEX idx_agg_signals_unclustered ON aggregator_signals(received_at) WHERE cluster_id IS NULL;
CREATE INDEX idx_agg_signals_source      ON aggregator_signals(source_id);
CREATE INDEX idx_agg_clusters_status     ON aggregator_clusters(status, created_at DESC);
CREATE INDEX idx_agg_clusters_target     ON aggregator_clusters(target_direction_id) WHERE target_direction_id IS NOT NULL;
CREATE INDEX idx_agg_stats_aggregator    ON aggregator_daily_stats(aggregator_id, date DESC);

-- ============================================================================
-- D.1.33.01 — Connectivity
-- ============================================================================

CREATE TABLE connectivity_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  current_direction_id UUID REFERENCES directions(id),
  target_direction_id UUID REFERENCES directions(id),
  priority            priority_enum NOT NULL,
  deadline            TIMESTAMPTZ NOT NULL,
  status              conn_status_enum NOT NULL DEFAULT 'queued',
  iterations          INT NOT NULL DEFAULT 0 CHECK (iterations >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  routed_at           TIMESTAMPTZ,
  escalated_at        TIMESTAMPTZ,
  CONSTRAINT chk_conn_deadline CHECK (deadline > created_at)
);

CREATE TABLE prefilter_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  format_ok       BOOLEAN NOT NULL,
  etiquette_ok    BOOLEAN NOT NULL,
  violations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE liaisons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id    UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  liaison_id      UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,
  mandate_id      UUID REFERENCES mandates(id) ON DELETE SET NULL
);

CREATE INDEX idx_conn_queue             ON connectivity_items(status, priority, deadline) WHERE status = 'queued';
CREATE INDEX idx_conn_overdue           ON connectivity_items(deadline) WHERE status IN ('queued','routed');
CREATE INDEX idx_conn_signal            ON connectivity_items(signal_id);
CREATE INDEX idx_conn_target            ON connectivity_items(target_direction_id) WHERE target_direction_id IS NOT NULL;
CREATE INDEX idx_conn_iterations        ON connectivity_items(iterations) WHERE iterations >= 3;
CREATE INDEX idx_prefilter_signal       ON prefilter_results(signal_id);
CREATE INDEX idx_liaisons_active        ON liaisons(direction_id) WHERE valid_to IS NULL;
CREATE INDEX idx_liaisons_participant   ON liaisons(liaison_id, valid_to) WHERE valid_to IS NULL;

-- ============================================================================
-- D.1.34.01 — Admin
-- ============================================================================

CREATE TABLE admin_dashboard_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participants_total INT NOT NULL,
  directions_total   INT NOT NULL,
  active_mandates    INT NOT NULL,
  open_signals       INT NOT NULL,
  active_regimes     INT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bootstrap_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         bootstrap_type_enum NOT NULL,
  payload      JSONB NOT NULL,
  executed_by  UUID NOT NULL REFERENCES participants(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seed_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name  VARCHAR(128) NOT NULL,
  seeded         BOOLEAN NOT NULL DEFAULT true,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  seeded_by      UUID NOT NULL REFERENCES participants(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboard_created    ON admin_dashboard_snapshots(created_at DESC);
CREATE INDEX idx_bootstrap_type       ON bootstrap_events(type, created_at DESC);
CREATE INDEX idx_seed_history_template ON seed_history(template_name, created_at DESC);
CREATE INDEX idx_seed_history_executed_by ON seed_history(seeded_by);

-- ============================================================================
-- D.1.99.01 — Audit (партиционированные таблицы)
-- ============================================================================

CREATE TABLE audit_log (
  id            UUID NOT NULL DEFAULT gen_random_uuid(),
  actor_id      UUID,
  actor_type    actor_type_enum NOT NULL,
  action        VARCHAR(64) NOT NULL,
  entity_type   VARCHAR(64) NOT NULL,
  entity_id     UUID NOT NULL,
  old_value     JSONB,
  new_value     JSONB,
  context       JSONB,
  ip            INET,
  reason        TEXT,
  request_id    VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT chk_audit_actor
    CHECK (actor_id IS NOT NULL OR actor_type = 'system')
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_log_2026_10 PARTITION OF audit_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027_01 PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_log_2027_02 PARTITION OF audit_log
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE audit_log_2027_03 PARTITION OF audit_log
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE audit_log_2027_04 PARTITION OF audit_log
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE audit_log_2027_05 PARTITION OF audit_log
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE audit_log_2027_06 PARTITION OF audit_log
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE audit_log_2027_07 PARTITION OF audit_log
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE audit_log_2027_08 PARTITION OF audit_log
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE audit_log_2027_09 PARTITION OF audit_log
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE audit_log_2027_10 PARTITION OF audit_log
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE audit_log_2027_11 PARTITION OF audit_log
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE audit_log_2027_12 PARTITION OF audit_log
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

CREATE TABLE access_log (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  participant_id  UUID,
  resource        VARCHAR(64) NOT NULL,
  resource_id     UUID,
  action          right_action_enum NOT NULL,
  granted         BOOLEAN NOT NULL,
  reason          TEXT,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE access_log_2026_10 PARTITION OF access_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE access_log_2026_11 PARTITION OF access_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE access_log_2026_12 PARTITION OF access_log
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE access_log_2027_01 PARTITION OF access_log
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE access_log_2027_02 PARTITION OF access_log
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE access_log_2027_03 PARTITION OF access_log
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE access_log_2027_04 PARTITION OF access_log
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE access_log_2027_05 PARTITION OF access_log
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE access_log_2027_06 PARTITION OF access_log
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE access_log_2027_07 PARTITION OF access_log
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE access_log_2027_08 PARTITION OF access_log
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE access_log_2027_09 PARTITION OF access_log
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE access_log_2027_10 PARTITION OF access_log
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE access_log_2027_11 PARTITION OF access_log
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE access_log_2027_12 PARTITION OF access_log
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE access_log_default PARTITION OF access_log DEFAULT;

CREATE TABLE system_events (
  id          UUID NOT NULL DEFAULT gen_random_uuid(),
  type        VARCHAR(64) NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE system_events_2026_10 PARTITION OF system_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE system_events_2026_11 PARTITION OF system_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE system_events_2026_12 PARTITION OF system_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE system_events_2027_01 PARTITION OF system_events
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE system_events_2027_02 PARTITION OF system_events
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE system_events_2027_03 PARTITION OF system_events
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE system_events_2027_04 PARTITION OF system_events
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE system_events_2027_05 PARTITION OF system_events
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE system_events_2027_06 PARTITION OF system_events
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE system_events_2027_07 PARTITION OF system_events
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE system_events_2027_08 PARTITION OF system_events
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE system_events_2027_09 PARTITION OF system_events
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE system_events_2027_10 PARTITION OF system_events
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE system_events_2027_11 PARTITION OF system_events
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE system_events_2027_12 PARTITION OF system_events
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE system_events_default PARTITION OF system_events DEFAULT;

CREATE TABLE idempotency_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(128) NOT NULL UNIQUE,
  response    JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor      ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_entity     ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_action     ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_created    ON audit_log(created_at DESC);
CREATE INDEX idx_audit_request    ON audit_log(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_access_participant ON access_log(participant_id, created_at DESC) WHERE participant_id IS NOT NULL;
CREATE INDEX idx_access_resource  ON access_log(resource, resource_id);
CREATE INDEX idx_access_denied    ON access_log(granted) WHERE granted = false;
CREATE INDEX idx_system_events_type ON system_events(type, created_at DESC);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

-- ============================================================================
-- COMMIT
-- ============================================================================

COMMIT;

-- ============================================================================
-- Пост-проверки (выполнить вручную):
--   SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';
--   SELECT COUNT(*) FROM pg_type WHERE typtype = 'e';
-- Ожидается: ~135 таблиц (с партициями), ~100 enum.
-- ============================================================================