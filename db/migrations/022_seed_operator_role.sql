-- 022_seed_operator_role.sql
--
-- Засевает роль OPERATOR во все активные направления.
-- В 007_seeds.sql роль OPERATOR отсутствовала — добавляем отдельной
-- миграцией (см. TROUBLESHOOTING.md: «не редактировать 003/007 на проде»).
--
-- Хартия I.6.15.2: оператор — мандат 6 мес., не более 2 сроков,
-- cooldown 180 дней. Роль временная, не «профессия».
--
-- Идемпотентна: повторный прогон — no-op.

BEGIN;

INSERT INTO roles
  (direction_id, name, type, rights,
   max_term_days, max_terms, cooldown_days,
   conflicts_with, active)
SELECT
  d.id,
  'OPERATOR',
  'permanent',                                      -- ← уточнить по факту (см. Шаг 1)
  '{}'::jsonb,
  180,                                            -- I.6.15.2: 6 мес.
  2,                                              -- не более 2 сроков
  180,                                            -- cooldown = сроку
  '["COUNCIL_MEMBER","OTC","BALANCER","KEEPER","MASTER","LIAISON"]'::jsonb,
  true
  FROM directions d
 WHERE d.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM roles r
      WHERE r.direction_id = d.id
        AND r.name = 'OPERATOR'
   );

COMMIT;

-- Проверка:
--   SELECT r.name, d.number, d.name FROM roles r
--     JOIN directions d ON d.id = r.direction_id
--    WHERE r.name = 'OPERATOR' ORDER BY d.number;
-- Ожидаем 14+ строк (по числу активных направлений).