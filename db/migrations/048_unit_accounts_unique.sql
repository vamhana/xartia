-- 048 — unit_accounts: обычные UNIQUE-индексы вместо частичных.
--
-- ON CONFLICT (participant_id) не может вывести частичный индекс без WHERE,
-- поэтому делаем обычные UNIQUE (NULL-значения в Postgres не конфликтуют).

DROP INDEX IF EXISTS uq_unit_accounts_participant;
DROP INDEX IF EXISTS uq_unit_accounts_external;

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_accounts_participant
  ON unit_accounts(participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_accounts_external
  ON unit_accounts(external_ref);
