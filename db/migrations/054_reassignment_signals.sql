-- 054 — Сигналы перестановки (L0–L3).
--
-- «Не справляются» — это не разговор, а сигнал с уровнем, причиной и
-- историей: кто поднял, кто решил, чем закончилось.

CREATE TABLE IF NOT EXISTS reassignment_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level        SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 3),
  cell_id      UUID REFERENCES cells(id) ON DELETE SET NULL,
  task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'escalated', 'resolved', 'rejected')),
  raised_by    UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  resolved_by  UUID REFERENCES participants(id) ON DELETE SET NULL,
  resolution   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reassignment_signals_status
  ON reassignment_signals(status, level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reassignment_signals_cell
  ON reassignment_signals(cell_id) WHERE cell_id IS NOT NULL;
