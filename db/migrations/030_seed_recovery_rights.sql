-- 030_seed_recovery_rights.sql
-- D.2.01.30 — Seed rights_matrix: recovery_request:A для COUNCIL_MEMBER.
-- FIRST_ARCHITECT покрыт wildcard '*' из D.2.01.15 (не дублируется).
-- Идемпотентна: ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING.
-- Зависит от: D.2.01.02 (enums), D.2.01.03 (roles), D.2.01.15 (rights_matrix).

BEGIN;

INSERT INTO rights_matrix (role_id, resource, action, scope, version)
SELECT r.id,
       'recovery_request',
       'A'::right_action_enum,
       'all'::right_scope_enum,
       1
  FROM roles r
 WHERE r.name = 'COUNCIL_MEMBER'
ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING;

COMMIT;