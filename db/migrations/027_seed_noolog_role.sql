-- 027_seed_noolog_role.sql
--
-- Засевает роль NOOLOG во все активные направления.
-- В 007_seeds.sql роли NOOLOG не было (только COUNCIL_MEMBER, OTC,
-- LIAISON, VERIFIER, BALANCER, KEEPER, PSY, OBLIVION).
--
-- Хартия I.3.3.2: Ноолог — постоянная профессия, без срока
-- (как KEEPER / PSY / OBLIVION). Документирует кванты в каталоге.
-- NOOLOG используется в C.0.01.06 FALLBACK_PERMISSIONS
-- (direction, signal, regime, connection).
--
-- Идемпотентна: повторный прогон — no-op.

BEGIN;

INSERT INTO roles
  (direction_id, name, type, rights,
   max_term_days, max_terms, cooldown_days,
   conflicts_with, active)
SELECT
  d.id,
  'NOOLOG',
  'permanent',
  '{}'::jsonb,
  NULL,
  NULL,
  NULL,
  '[]'::jsonb,
  true
  FROM directions d
 WHERE d.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM roles r
      WHERE r.direction_id = d.id AND r.name = 'NOOLOG'
   );

COMMIT;

-- Проверка:
--   SELECT r.name, d.number, r.type, r.max_term_days
--     FROM roles r JOIN directions d ON d.id = r.direction_id
--    WHERE r.name = 'NOOLOG' ORDER BY d.number;
-- Ожидается: 17 строк, type=permanent, max_term_days=NULL.