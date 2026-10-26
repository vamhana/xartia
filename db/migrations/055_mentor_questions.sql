-- 055 — Очередь вопросов наставнику.
--
-- Вопрос — не сообщение в чате, а запись с SLA: кто спросил, кто отвечает,
-- сколько ждём, когда эскалировали. Ответ становится знанием.

CREATE TABLE IF NOT EXISTS mentor_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  mentor_id         UUID REFERENCES participants(id) ON DELETE SET NULL,
  cell_id           UUID REFERENCES cells(id) ON DELETE SET NULL,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  channel_id        VARCHAR(64),
  question          TEXT NOT NULL,
  answer            TEXT,
  status            VARCHAR(16) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'answered', 'escalated', 'closed')),
  sla_hours         SMALLINT NOT NULL DEFAULT 4,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  answered_at       TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mentor_questions_status
  ON mentor_questions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_mentor_questions_mentor
  ON mentor_questions(mentor_id, status) WHERE mentor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mentor_questions_cell
  ON mentor_questions(cell_id) WHERE cell_id IS NOT NULL;
