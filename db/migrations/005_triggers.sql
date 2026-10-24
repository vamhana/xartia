-- ============================================================================
-- 005_triggers.sql — D.4.01.01 … D.4.01.09
-- ============================================================================

BEGIN;

-- D.4.01.06 — Универсальный updated_at
CREATE OR REPLACE FUNCTION fn_update_timestamp() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_participants_updated_at
  BEFORE UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_signals_updated_at
  BEFORE UPDATE ON signals
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_goods_updated_at
  BEFORE UPDATE ON goods
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_quanta_updated_at
  BEFORE UPDATE ON quanta
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_panels_updated_at
  BEFORE UPDATE ON panels
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_flows_updated_at
  BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_capsules_updated_at
  BEFORE UPDATE ON capsules
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- D.4.01.01 — Ротация мандатов (вызывается cron, не триггер)
CREATE OR REPLACE FUNCTION fn_rotate_expired_mandates() RETURNS INT AS $$
DECLARE
  rotated_count INT := 0;
  m RECORD;
BEGIN
  FOR m IN
    SELECT id, holder_id, direction_id, function
    FROM mandates
    WHERE status = 'active' AND expires_at <= now()
  LOOP
    UPDATE mandates
      SET status = 'expired'
      WHERE id = m.id;

    INSERT INTO rotations (mandate_id, scheduled_at, executed_at, status)
      VALUES (m.id, m.expires_at, now(), 'executed');

    -- Cooldown = срок мандата (I.4.1.8) — берём из разницы granted/expires
    INSERT INTO cooldowns (participant_id, reason, valid_from, valid_to)
      SELECT m.holder_id,
             'rotation:' || m.function,
             now(),
             now() + (expires_at - granted_at)
      FROM mandates WHERE id = m.id;

    rotated_count := rotated_count + 1;
  END LOOP;

  RETURN rotated_count;
END;
$$ LANGUAGE plpgsql;

-- D.4.01.02 — Cooldown при revoked (триггер)
CREATE OR REPLACE FUNCTION fn_create_cooldown() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('expired','revoked') AND OLD.status = 'active' THEN
    INSERT INTO cooldowns (participant_id, reason, valid_from, valid_to)
      VALUES (
        NEW.holder_id,
        COALESCE(NEW.function, 'mandate'),
        now(),
        now() + (NEW.expires_at - NEW.granted_at)
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cooldown_on_mandate_end
  AFTER UPDATE OF status ON mandates
  FOR EACH ROW EXECUTE FUNCTION fn_create_cooldown();

-- D.4.01.07 — Пересчёт members_count в cells
CREATE OR REPLACE FUNCTION fn_update_cell_count() RETURNS TRIGGER AS $$
DECLARE
  target_cell UUID;
BEGIN
  target_cell := COALESCE(NEW.cell_id, OLD.cell_id);
  UPDATE cells
    SET members_count = (
      SELECT COUNT(*) FROM cell_members
      WHERE cell_id = target_cell AND valid_to IS NULL
    )
    WHERE id = target_cell;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cell_count
  AFTER INSERT OR UPDATE OR DELETE ON cell_members
  FOR EACH ROW EXECUTE FUNCTION fn_update_cell_count();

-- D.4.01.08 — Обновление баланса Потоков
CREATE OR REPLACE FUNCTION fn_update_flow_balance() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO flows (participant_id, type, balance, updated_at)
    VALUES (NEW.participant_id, NEW.type, NEW.amount, now())
    ON CONFLICT (participant_id, type)
    DO UPDATE SET
      balance = flows.balance + NEW.amount,
      updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_flow_balance
  AFTER INSERT ON flow_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_update_flow_balance();

-- D.4.01.03 — Защита audit_log от UPDATE / DELETE
CREATE OR REPLACE FUNCTION fn_prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();

CREATE TRIGGER trg_prevent_audit_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();

-- D.4.01.09 — Валидация external_id (двойная защита после CHECK)
CREATE OR REPLACE FUNCTION fn_validate_external_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.external_id IS NOT NULL AND length(trim(NEW.external_id)) = 0 THEN
    RAISE EXCEPTION 'external_id cannot be empty';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_external_id_participants
  BEFORE INSERT OR UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION fn_validate_external_id();

CREATE TRIGGER trg_validate_external_id_tasks
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION fn_validate_external_id();

CREATE TRIGGER trg_validate_external_id_signals
  BEFORE INSERT OR UPDATE ON signals
  FOR EACH ROW EXECUTE FUNCTION fn_validate_external_id();

COMMIT;