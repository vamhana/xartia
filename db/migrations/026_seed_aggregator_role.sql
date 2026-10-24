-- 026_seed_aggregator_role.sql
--
-- Засевает роль AGGREGATOR во все активные направления.
-- В 007_seeds.sql роли AGGREGATOR не было.
--
-- Хартия I.6.17: агрегатор — специалист Когнитивной Логистики,
-- мандат 2 года (730 дней), не более 2 сроков, cooldown 730.
-- Не принимает решений — только фильтрует и группирует.
--
-- Идемпотентна: повторный прогон — no-op.

BEGIN;

INSERT INTO roles
  (direction_id, name, type, rights,
   max_term_days, max_terms, cooldown_days,
   conflicts_with, active)
SELECT
  d.id,
  'AGGREGATOR',
  'temporary',
  '{}'::jsonb,
  730,                                            -- 2 года (C.0.01.01)
  2,
  730,
  '[]'::jsonb,                                    -- конфликтов нет
  true
  FROM directions d
 WHERE d.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM roles r
      WHERE r.direction_id = d.id AND r.name = 'AGGREGATOR'
   );

COMMIT;

-- Проверка:
--   SELECT r.name, d.number, r.type, r.max_term_days, r.max_terms
--     FROM roles r JOIN directions d ON d.id = r.direction_id
--    WHERE r.name = 'AGGREGATOR' ORDER BY d.number;
-- Ожидается: 17 строк, type=temporary, 730/2.