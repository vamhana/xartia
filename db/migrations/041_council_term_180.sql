-- 041 — Совет: срок мандата 180 дней и авто-ротация по истечении.
--
-- Было 730 дней — для функции «самый опытный из равных» это слишком долго:
-- совет превращается в должность. 180 дней и автоматическое переизбрание
-- держат функцию сменяемой.
--
-- Что делает:
--   1. опускает max_term_days роли COUNCIL_MEMBER до 180 (для существующих
--      направлений и для будущих seed'ов);
--   2. подрезает уже выданные мандаты до «valid_from + 180 дней», чтобы
--      действующие советы не жили по старому сроку.

UPDATE roles
   SET max_term_days = 180
 WHERE name = 'COUNCIL_MEMBER';

UPDATE participant_roles pr
   SET valid_to = pr.valid_from + interval '180 days'
  FROM roles r
 WHERE pr.role_id = r.id
   AND r.name = 'COUNCIL_MEMBER'
   AND pr.status = 'active'
   AND pr.valid_to IS NOT NULL
   AND pr.valid_to > pr.valid_from + interval '180 days';
