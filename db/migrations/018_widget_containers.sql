-- 018_widget_containers.sql
-- D.2.01.18 — Иерархия виджетов Конструктора.
--
-- Добавляет parent_id в panel_widgets: null = корень панели,
-- uuid = внутри контейнера-родителя.
--
-- Тип виджета 'container' (entity='layout') — специальный, рендерится
-- PanelCanvas рекурсивно, внутри него свой RGL.
--
-- Идемпотентна.

BEGIN;

-- 1. Колонка parent_id с самоссылкой и каскадным удалением
ALTER TABLE panel_widgets
  ADD COLUMN IF NOT EXISTS parent_id uuid NULL
  REFERENCES panel_widgets(id) ON DELETE CASCADE;

-- 2. Индекс для быстрого поиска детей
CREATE INDEX IF NOT EXISTS idx_panel_widgets_parent
  ON panel_widgets(parent_id);

-- 3. Seed виджета-контейнера (одна запись в библиотеке widgets)
INSERT INTO widgets (type, entity, config, default_rights, created_by)
SELECT
  'container',
  'layout',
  '{"title":"Контейнер"}'::jsonb,
  '{}'::jsonb,
  (SELECT id FROM participants
    WHERE deleted_at IS NULL
    ORDER BY entered_at ASC LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM widgets WHERE type = 'container' AND entity = 'layout'
)
  AND EXISTS (SELECT 1 FROM participants WHERE deleted_at IS NULL);

DO $$
DECLARE
  v_widgets INT;
  v_container INT;
BEGIN
  SELECT count(*) INTO v_widgets FROM widgets;
  SELECT count(*) INTO v_container FROM widgets WHERE type = 'container';
  RAISE NOTICE 'widgets total=%, container=%', v_widgets, v_container;
END $$;

COMMIT;