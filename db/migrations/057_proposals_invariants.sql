-- 057 — Предложения, возражения, решения и реестр инвариантов.
--
-- Мета-механизм: сообщество может предложить изменить любую функцию ядра
-- (включая сами правила обсуждения), зафиксировать разногласия, принять
-- решение с обоснованием и провести его через код с анализом влияния.

CREATE TABLE IF NOT EXISTS invariants (
  id            VARCHAR(64) PRIMARY KEY,
  statement     TEXT NOT NULL,
  module        TEXT NOT NULL,
  test_path     TEXT NOT NULL,
  since_version VARCHAR(32) NOT NULL DEFAULT 'v0.1',
  status        VARCHAR(16) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'retired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           VARCHAR(16) NOT NULL
                   CHECK (type IN ('module', 'rule', 'meta', 'charter')),
  title          VARCHAR(255) NOT NULL,
  problem        TEXT NOT NULL,
  proposal       TEXT NOT NULL,
  alternatives   TEXT,
  status         VARCHAR(16) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'discussion', 'agreed', 'rejected',
                                     'withdrawn', 'implementing', 'accepted', 'reverted')),
  author_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  discussion_url TEXT,
  deadline       TIMESTAMPTZ,
  pr_url         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS proposal_objections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind        VARCHAR(16) NOT NULL
                CHECK (kind IN ('factual', 'conceptual', 'compatibility')),
  text        TEXT NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'addressed', 'rejected')),
  resolution  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposal_objections_proposal
  ON proposal_objections(proposal_id, status);

CREATE TABLE IF NOT EXISTS proposal_decisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  decided_by  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  method      VARCHAR(32) NOT NULL DEFAULT 'council'
                CHECK (method IN ('council', 'architect', 'consent', 'vote')),
  outcome     VARCHAR(16) NOT NULL
                CHECK (outcome IN ('accepted', 'rejected', 'deferred')),
  rationale   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_impacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  invariant_id  VARCHAR(64) NOT NULL REFERENCES invariants(id) ON DELETE RESTRICT,
  change_kind   VARCHAR(16) NOT NULL DEFAULT 'additive'
                  CHECK (change_kind IN ('additive', 'breaking', 'deprecation')),
  migration_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, invariant_id)
);

CREATE TABLE IF NOT EXISTS proposal_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  from_status VARCHAR(16),
  to_status   VARCHAR(16) NOT NULL,
  actor_id    UUID REFERENCES participants(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Стартовый реестр инвариантов: то, что уже проверяется тестами.
INSERT INTO invariants (id, statement, module, test_path) VALUES
  ('flow_confirmed_work', 'Поток начисляется за принятый результат, а не за активность', 'src/core/flows', 'scripts/test-tasks.ts'),
  ('flow_not_money', 'Поток не даёт доступа к казне и не является валютой', 'src/core/flows,src/core/treasury', 'scripts/test-invariants.ts'),
  ('otk_independent', 'ОТК не проверяет свою работу', 'src/core/tasks,src/core/otc', 'scripts/test-tasks.ts'),
  ('otk_criteria', 'Приёмка требует подтверждения обязательных критериев', 'src/core/otc', 'scripts/test-tasks.ts'),
  ('task_artifact', 'Задачу нельзя сдать без отчёта с артефактом', 'src/core/tasks', 'scripts/test-tasks.ts'),
  ('treasury_floor', 'Пол 1.00 не пробивается ни одной операцией', 'src/core/treasury', 'scripts/test-treasury.ts'),
  ('treasury_threshold', 'Трата исполняется только 3 подписями из 5', 'src/core/treasury', 'scripts/test-treasury.ts'),
  ('mandate_expiry', 'Истёкший мандат перестаёт давать полномочия', 'src/core/mandates', 'scripts/test-invariants.ts'),
  ('cell_readiness', 'Ячейка без плана, координатора и ОТК не готова', 'src/core/cells', 'scripts/test-capacity-cells.ts'),
  ('gateway_separation', 'Создание, одобрение и аудит сделки — разные полномочия', 'src/core/gateway', 'scripts/test-gateway-contour.ts'),
  ('audit_traceable', 'Любое решение восстановимо: кто, когда, на каком основании', 'src/core/audit', 'scripts/test-audit-log.ts'),
  ('charter_code_map', 'У каждого принципа Хартии есть модуль и тест', 'docs', 'scripts/test-proposals.ts')
ON CONFLICT (id) DO NOTHING;
