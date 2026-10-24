-- D.2.01.15 — Seed rights_matrix для базовых ролей.
--
-- Заполняет rights_matrix из hardcoded PERMISSIONS в C.0.01.06.
-- Использует JOIN на roles, чтобы автоматически применить ко всем
-- 14 направлениям (8 ролей × 14 = 112 записей на роль).
--
-- Идемпотентна (ON CONFLICT DO NOTHING).
-- Fallback на hardcoded остаётся в C.0.01.06 — для ролей, которых нет в БД.

BEGIN;

-- ─── FIRST_ARCHITECT (wildcard '*') ──────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, '*', a.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('V'),('C'),('E'),('D'),('A'),('Dg'),('R'),('Vo'),('Act'),('Ar'),('S'),('F')
) AS a(action)
WHERE r.name = 'FIRST_ARCHITECT'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── COUNCIL_MEMBER ──────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('participant','V'), ('participant','E'),
  ('direction','V'), ('direction','E'),
  ('cell','V'), ('cell','C'), ('cell','E'), ('cell','D'),
  ('task','V'), ('task','C'), ('task','E'), ('task','A'),
  ('signal','V'), ('signal','C'), ('signal','E'),
  ('connection','V'), ('connection','C'), ('connection','E'),
  ('arbitration','V'), ('arbitration','C'), ('arbitration','E'),
  ('plan','V'), ('plan','C'), ('plan','E'), ('plan','A'),
  ('flow','V'), ('flow','C'),
  ('good','V'), ('good','C'), ('good','E'), ('good','A'),
  ('report','V'), ('report','A'),
  ('regime','V'), ('regime','Act'),
  ('mandate','V'), ('mandate','C'), ('mandate','D'), ('mandate','R')
) AS rm(resource, action)
WHERE r.name = 'COUNCIL_MEMBER'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── OTC ─────────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('participant','V'),
  ('task','V'), ('task','A'),
  ('report','V'), ('report','A'), ('report','E'),
  ('flow','V'), ('flow','C'),
  ('direction','V'),
  ('otc','V'), ('otc','C')
) AS rm(resource, action)
WHERE r.name = 'OTC'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── VERIFIER ────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('audit','V'), ('audit','C'), ('audit','E'), ('audit','A'), ('audit','S'),
  ('participant','V'),
  ('task','V'), ('task','A'),
  ('report','V'),
  ('archive','V'),
  ('gateway','V'), ('gateway','A'),
  ('regime','V'), ('regime','A'),
  ('jury','V'), ('jury','C'),
  ('flow','V'), ('flow','C')
) AS rm(resource, action)
WHERE r.name = 'VERIFIER'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── KEEPER ──────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('archive','V'), ('archive','C'), ('archive','E'), ('archive','S'), ('archive','Ar'),
  ('plan','V'), ('plan','S'),
  ('signal','V'),
  ('participant','V')
) AS rm(resource, action)
WHERE r.name = 'KEEPER'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── LIAISON ─────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('signal','V'), ('signal','C'), ('signal','E'),
  ('connectivity','V'), ('connectivity','C'), ('connectivity','E'),
  ('task','V'),
  ('participant','V')
) AS rm(resource, action)
WHERE r.name = 'LIAISON'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── BALANCER ────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('balance','V'), ('balance','C'), ('balance','E'), ('balance','A'), ('balance','D'),
  ('direction','V'),
  ('signal','V'),
  ('participant','V'),
  ('regime','V'), ('regime','Act')
) AS rm(resource, action)
WHERE r.name = 'BALANCER'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── PSY ─────────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('psy_session','V'),
  ('psy_session','C'),
  ('psy_session','E'),
  ('psy_session','Act'),
  ('participant','V')
) AS rm(resource, action)
WHERE r.name = 'PSY'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── OBLIVION ────────────────────────────────────────────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('good','V'), ('good','D')
) AS rm(resource, action)
WHERE r.name = 'OBLIVION'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── ASSOCIATED (если создана bootstrap-participant) ─────────────

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id, rm.resource, rm.action::right_action_enum, 'all'::right_scope_enum, 1
FROM roles r
CROSS JOIN (VALUES
  ('participant','V'),
  ('direction','V'),
  ('task','V'),
  ('signal','V'), ('signal','C'),
  ('flow','V'),
  ('good','V'),
  ('report','V'), ('report','C'),
  ('connection','V'),
  ('arbitration','V'),
  ('regime','V')
) AS rm(resource, action)
WHERE r.name = 'ASSOCIATED'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

-- ─── Проверка ────────────────────────────────────────────────────

DO $$
DECLARE
  cnt INTEGER;
  rcnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt FROM rights_matrix;
  SELECT COUNT(DISTINCT role_id) INTO rcnt FROM rights_matrix;
  RAISE NOTICE 'rights_matrix seeded: % rows across % roles', cnt, rcnt;
END $$;

COMMIT;