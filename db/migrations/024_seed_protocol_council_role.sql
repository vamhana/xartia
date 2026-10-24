-- 024_seed_protocol_council_role.sql
--
-- Засевает роль PROTOCOL_COUNCIL во все активные направления.
-- В 007_seeds.sql роли PROTOCOL_COUNCIL не было (как и OPERATOR до 022).
--
-- Хартия V.6, V.7: Совет Протоколов управляет webhooks и планетарным
-- уровнем. Сроки: 1095 дней, без ограничения на число сроков
-- (см. C.0.01.01 ROLE_MAX_TERMS).
--
-- Идемпотентна: повторный прогон — no-op.

BEGIN;

INSERT INTO roles
  (direction_id, name, type, rights,
   max_term_days, max_terms, cooldown_days,
   conflicts_with, active)
SELECT
  d.id,
  'PROTOCOL_COUNCIL',
  'temporary',                                       -- ← см. результат диагностики
  '{}'::jsonb,
  1095,                                            -- 3 года (C.0.01.01)
  0,                                               -- 0 = без ограничения (см. code)
  NULL,                                            -- cooldown не предусмотрен
  '[]'::jsonb,                                     -- конфликтов нет (C.0.01.01)
  true
  FROM directions d
 WHERE d.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM roles r
      WHERE r.direction_id = d.id AND r.name = 'PROTOCOL_COUNCIL'
   );

COMMIT;

-- Проверка:
--   SELECT r.name, d.number, d.name FROM roles r
--     JOIN directions d ON d.id = r.direction_id
--    WHERE r.name = 'PROTOCOL_COUNCIL' ORDER BY d.number;
-- Ожидается: 14 строк.