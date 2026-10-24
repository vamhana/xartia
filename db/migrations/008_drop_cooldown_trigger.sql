-- 008_drop_cooldown_trigger.sql
-- Убираем триггер trg_cooldown_on_mandate_end — он создаёт cooldown
-- с неправильным сроком (по фактическим датам, а не по политике роли).
-- Cooldown теперь создаётся только в сервисе mandates.service.

BEGIN;

DROP TRIGGER IF EXISTS trg_cooldown_on_mandate_end ON mandates;
DROP FUNCTION IF EXISTS fn_create_cooldown() CASCADE;

-- Удалить старые «неправильные» cooldown от триггера (у которых reason без префикса rotation:)
DELETE FROM cooldowns WHERE reason NOT LIKE 'rotation:%';

COMMIT;