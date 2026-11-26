-- ============================================================================
-- 074 — Калибровка: снимок атома при создании anchor и сессии
--       (Фаза 1, этап 5; §4.10 плана xartia-core-implementation).
--
-- Зачем. Anchor и калибровочную сессию можно создавать по неутверждённому
-- атому (материал подготовки). Чтобы такой материал не превратился молча в
-- production-основание, когда атом позже утвердят, при создании фиксируется
-- снимок: версия атома, статус атома и статус критериев НА МОМЕНТ создания.
-- Признак pilot вычисляется из снимка, а не из текущего состояния атома.
--
-- Старые записи: колонки остаются NULL ("неизвестно"). Задним числом снимок
-- не восстанавливается (это была бы выдумка): pilot = null, и такой материал
-- никогда не считается production.
--
-- Неизменяемость. Колонки снимка нельзя менять после вставки (в т.ч.
-- NULL -> значение), иначе их можно было бы "дозаполнить" утверждённым статусом
-- и обойти смысл снимка. Осознанная правка требует отключения триггера.
--
-- Транзакцию открывает раннер (scripts/migrate.ts). Идемпотентна.
-- ============================================================================

ALTER TABLE anchor_examples
  ADD COLUMN IF NOT EXISTS atom_version    VARCHAR(16),
  ADD COLUMN IF NOT EXISTS atom_status     TEXT,
  ADD COLUMN IF NOT EXISTS criteria_status TEXT;

ALTER TABLE calibration_sessions
  ADD COLUMN IF NOT EXISTS atom_version    VARCHAR(16),
  ADD COLUMN IF NOT EXISTS atom_status     TEXT,
  ADD COLUMN IF NOT EXISTS criteria_status TEXT;

COMMENT ON COLUMN anchor_examples.atom_version IS
  'Версия атома на момент создания anchor (снимок, неизменяем). NULL = неизвестно (до миграции 074).';
COMMENT ON COLUMN anchor_examples.atom_status IS
  'Статус атома на момент создания anchor (снимок, неизменяем).';
COMMENT ON COLUMN anchor_examples.criteria_status IS
  'Статус assessment_criteria атома на момент создания anchor (снимок, неизменяем).';
COMMENT ON COLUMN calibration_sessions.atom_version IS
  'Версия атома на момент создания сессии (снимок, неизменяем). NULL = неизвестно (до миграции 074).';
COMMENT ON COLUMN calibration_sessions.atom_status IS
  'Статус атома на момент создания сессии (снимок, неизменяем).';
COMMENT ON COLUMN calibration_sessions.criteria_status IS
  'Статус assessment_criteria атома на момент создания сессии (снимок, неизменяем).';

CREATE OR REPLACE FUNCTION calibration_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.atom_version    IS DISTINCT FROM OLD.atom_version
     OR NEW.atom_status     IS DISTINCT FROM OLD.atom_status
     OR NEW.criteria_status IS DISTINCT FROM OLD.criteria_status THEN
    RAISE EXCEPTION 'calibration snapshot columns are immutable (table %)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_anchor_examples_snapshot_immutable ON anchor_examples;
CREATE TRIGGER trg_anchor_examples_snapshot_immutable
  BEFORE UPDATE ON anchor_examples
  FOR EACH ROW EXECUTE FUNCTION calibration_snapshot_immutable();

DROP TRIGGER IF EXISTS trg_calibration_sessions_snapshot_immutable ON calibration_sessions;
CREATE TRIGGER trg_calibration_sessions_snapshot_immutable
  BEFORE UPDATE ON calibration_sessions
  FOR EACH ROW EXECUTE FUNCTION calibration_snapshot_immutable();
