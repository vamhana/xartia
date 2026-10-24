-- 039 — Совет направления: выборы, ротация, дисквалификация.
--
-- Хартия: в Совет входит самый опытный участник направления (по числу
-- полученных Потоков), с обязательной ротацией и возможностью дисквалификации.
-- Если такого в системе нет — ответственность ложится на Архитектора.
--
-- Таблицы фиксируют историю: кто и когда избран, с каким счётом, до какого
-- срока, и кого дисквалифицировали (с причиной). Роль COUNCIL_MEMBER при этом
-- остаётся обычной ролью с мандатом (S.0.01.03) — таблицы лишь объясняют,
-- почему она у человека.

CREATE TABLE IF NOT EXISTS council_elections (
  id            UUID PRIMARY KEY,
  direction_id  UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  score         INTEGER NOT NULL,
  elected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  term_ends_at  TIMESTAMPTZ,
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_council_elections_dir
  ON council_elections(direction_id, elected_at DESC);

CREATE TABLE IF NOT EXISTS council_disqualifications (
  id             UUID PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  direction_id   UUID NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  reason         TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, direction_id)
);
