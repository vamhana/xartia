-- ============================================================================
-- 004_views.sql — D.3.01.01 … D.3.01.14
-- ============================================================================

BEGIN;

-- D.3.01.01 — Паспорт участника
CREATE OR REPLACE VIEW v_participant_passport AS
SELECT
  p.id,
  p.external_id,
  p.name,
  p.pseudonym,
  p.status,
  p.profile_risk,
  p.entered_at,
  p.geo_enabled,
  d.number   AS direction_number,
  d.name     AS direction_name,
  pr.name    AS profession_name,
  m.external_id AS mentor_external_id,
  c.number   AS cell_number,
  c.level    AS cell_level,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'role', r.name,
        'direction', rd.number,
        'valid_from', par.valid_from,
        'valid_to', par.valid_to))
     FROM participant_roles par
     JOIN roles r ON r.id = par.role_id
     LEFT JOIN directions rd ON rd.id = par.direction_id
     WHERE par.participant_id = p.id
       AND par.status = 'active'),
    '[]'::jsonb
  ) AS roles,
  (SELECT MAX(created_at) FROM participant_history ph
   WHERE ph.participant_id = p.id) AS last_change_at
FROM participants p
LEFT JOIN directions d ON d.id = p.direction_id
LEFT JOIN professions pr ON pr.id = p.profession_id
LEFT JOIN participants m ON m.id = p.mentor_id
LEFT JOIN cells c ON c.id = p.cell_id
WHERE p.deleted_at IS NULL;

-- D.3.01.02 — Нагрузка на направления
CREATE OR REPLACE VIEW v_direction_load AS
SELECT
  d.id                                AS direction_id,
  d.number,
  d.name,
  (SELECT COUNT(*) FROM participants p
   WHERE p.direction_id = d.id AND p.deleted_at IS NULL) AS participants_count,
  (SELECT COUNT(*) FROM tasks t
   WHERE t.direction_id = d.id
     AND t.status IN ('created','assigned','in_progress','submitted')) AS active_tasks,
  (SELECT COUNT(*) FROM tasks t
   WHERE t.direction_id = d.id
     AND t.status NOT IN ('accepted','returned')
     AND t.deadline < now())          AS overdue_tasks,
  (SELECT COUNT(*) FROM signals s
   WHERE s.lead_direction_id = d.id
     AND s.status NOT IN ('completed','rejected')) AS open_signals,
  (SELECT COUNT(*) FROM signals s
   WHERE s.lead_direction_id = d.id
     AND s.iterations >= 3)           AS escalated_signals
FROM directions d
WHERE d.status = 'active';

-- D.3.01.03 — Активные мандаты
CREATE OR REPLACE VIEW v_active_mandates AS
SELECT
  m.id,
  m.function,
  d.number   AS direction_number,
  d.name     AS direction_name,
  h.id       AS holder_id,
  h.external_id AS holder_external_id,
  h.name     AS holder_name,
  m.granted_at,
  m.expires_at,
  EXTRACT(DAY FROM m.expires_at - now())::INT AS days_left,
  m.status
FROM mandates m
LEFT JOIN directions d ON d.id = m.direction_id
JOIN participants h ON h.id = m.holder_id
WHERE m.status = 'active'
  AND m.expires_at > now();

-- D.3.01.04 — Предстоящие ротации
CREATE OR REPLACE VIEW v_rotations_due AS
SELECT
  m.id           AS mandate_id,
  m.function,
  d.number       AS direction_number,
  h.external_id  AS holder_external_id,
  h.name         AS holder_name,
  m.expires_at,
  EXTRACT(HOUR FROM m.expires_at - now())::INT AS hours_left
FROM mandates m
LEFT JOIN directions d ON d.id = m.direction_id
JOIN participants h ON h.id = m.holder_id
WHERE m.status = 'active'
  AND m.expires_at BETWEEN now() AND now() + INTERVAL '30 days'
ORDER BY m.expires_at ASC;

-- D.3.01.05 — Открытые сигналы
CREATE OR REPLACE VIEW v_open_signals AS
SELECT
  s.id,
  s.external_id,
  s.type,
  s.priority,
  s.status,
  s.iterations,
  d.number       AS lead_direction_number,
  s.created_at,
  EXTRACT(HOUR FROM now() - s.created_at)::INT AS hours_since_created,
  s.desired_deadline,
  (s.desired_deadline IS NOT NULL AND s.desired_deadline < now()) AS is_overdue,
  sa.format_ok,
  sa.etiquette_ok,
  sa.returns_count
FROM signals s
LEFT JOIN directions d ON d.id = s.lead_direction_id
LEFT JOIN signal_attributes sa ON sa.signal_id = s.id
WHERE s.status NOT IN ('completed','rejected');

-- D.3.01.06 — Аномалии Балансировки
CREATE OR REPLACE VIEW v_balance_anomalies AS
SELECT
  a.id,
  a.type,
  d.number       AS direction_number,
  d.name         AS direction_name,
  a.severity,
  a.status,
  a.details,
  EXTRACT(DAY FROM now() - a.created_at)::INT AS days_open,
  a.meta_request_id,
  a.created_at
FROM anomalies a
JOIN directions d ON d.id = a.direction_id
WHERE a.status <> 'resolved'
  AND a.severity >= 5
ORDER BY a.severity DESC, a.created_at ASC;

-- D.3.01.07 — Очередь ОТК
CREATE OR REPLACE VIEW v_otc_backlog AS
SELECT
  r.id            AS report_id,
  t.id            AS task_id,
  t.external_id   AS task_external_id,
  d.number        AS direction_number,
  t.priority,
  r.type          AS report_type,
  r.created_at    AS submitted_at,
  EXTRACT(HOUR FROM now() - r.created_at)::INT AS hours_waiting,
  r.participant_id AS author_id
FROM reports r
JOIN tasks t ON t.id = r.task_id
JOIN directions d ON d.id = t.direction_id
WHERE t.status = 'submitted'
ORDER BY t.priority DESC, r.created_at ASC;

-- D.3.01.08 — Планетарный пульс
CREATE OR REPLACE VIEW v_planetary_pulse AS
SELECT
  c.id            AS community_id,
  c.code,
  c.name,
  c.status,
  pp.base_goods_level,
  pp.direction_load,
  pp.top_signals,
  EXTRACT(SECOND FROM now() - pp.created_at)::INT AS pulse_age_seconds
FROM communities c
LEFT JOIN LATERAL (
  SELECT * FROM planetary_pulse pp
  WHERE pp.community_id = c.id
  ORDER BY pp.created_at DESC
  LIMIT 1
) pp ON true;

-- D.3.01.09 — Вне сети доверия
CREATE OR REPLACE VIEW v_trust_network_excluded AS
SELECT
  o.participant_id,
  p.external_id,
  p.name,
  o.reason,
  o.valid_from,
  o.review_at,
  EXTRACT(DAY FROM o.review_at - now())::INT AS days_until_review,
  o.status
FROM outside_trust_network o
JOIN participants p ON p.id = o.participant_id
WHERE o.status = 'active';

-- D.3.01.10 — Активные режимы
CREATE OR REPLACE VIEW v_regime_active AS
SELECT
  r.id,
  r.type,
  d.number       AS direction_number,
  r.activated_at,
  EXTRACT(HOUR FROM now() - r.activated_at)::INT AS hours_active,
  r.max_duration,
  CASE
    WHEN r.max_duration IS NULL THEN NULL
    ELSE EXTRACT(HOUR FROM (r.activated_at + r.max_duration) - now())::INT
  END AS hours_left,
  r.audit_schedule,
  CASE
    WHEN r.audit_schedule IS NULL THEN NULL
    ELSE r.activated_at + r.audit_schedule
  END AS next_audit_at,
  r.reason
FROM regimes r
LEFT JOIN directions d ON d.id = r.direction_id
WHERE r.status = 'active';

-- D.3.01.11 — Балансы Потоков
CREATE OR REPLACE VIEW v_flow_balance AS
SELECT
  p.id AS participant_id,
  p.external_id,
  COALESCE((SELECT balance FROM flows WHERE participant_id = p.id AND type = 'main'), 0)           AS main,
  COALESCE((SELECT balance FROM flows WHERE participant_id = p.id AND type = 'reflective'), 0)     AS reflective,
  COALESCE((SELECT balance FROM flows WHERE participant_id = p.id AND type = 'council'), 0)        AS council,
  COALESCE((SELECT balance FROM flows WHERE participant_id = p.id AND type = 'mentoring'), 0)      AS mentoring,
  COALESCE((SELECT balance FROM flows WHERE participant_id = p.id AND type = 'creation'), 0)       AS creation,
  COALESCE((SELECT balance FROM flows WHERE participant_id = p.id AND type = 'cross_direction'), 0) AS cross_direction,
  COALESCE((SELECT balance FROM capsules WHERE participant_id = p.id), 0)                          AS capsule,
  (SELECT SUM(balance) FROM flows WHERE participant_id = p.id)                                     AS total,
  (SELECT MAX(created_at) FROM flow_transactions WHERE participant_id = p.id)                      AS last_transaction_at
FROM participants p
WHERE p.deleted_at IS NULL;

-- D.3.01.12 — Активные члены Советов
CREATE OR REPLACE VIEW v_council_members_active AS
SELECT
  cm.council_id,
  c.type         AS council_type,
  d.number       AS direction_number,
  d.name         AS direction_name,
  p.id           AS member_id,
  p.external_id  AS member_external_id,
  p.name         AS member_name,
  cm.valid_from,
  cm.valid_to,
  cm.term_number,
  CASE
    WHEN cm.valid_to IS NULL THEN NULL
    ELSE EXTRACT(DAY FROM cm.valid_to - now())::INT
  END AS days_left
FROM council_members cm
JOIN councils c ON c.id = cm.council_id
LEFT JOIN directions d ON d.id = c.direction_id
JOIN participants p ON p.id = cm.participant_id
WHERE cm.status = 'active'
  AND (cm.valid_to IS NULL OR cm.valid_to > now());

-- D.3.01.13 — Цепочки решений
CREATE OR REPLACE VIEW v_decision_chains AS
SELECT
  dc.chain_id,
  jsonb_agg(
    jsonb_build_object(
      'step', dc.step,
      'type', dc.type,
      'ref_id', dc.ref_id,
      'description', dc.description,
      'created_at', dc.created_at
    ) ORDER BY dc.step
  ) AS steps,
  (COUNT(DISTINCT dc.type) = 7) AS complete,
  MIN(dc.created_at) AS first_step_at,
  MAX(dc.created_at) AS last_step_at,
  EXTRACT(HOUR FROM MAX(dc.created_at) - MIN(dc.created_at))::INT AS duration_hours
FROM decision_chains dc
GROUP BY dc.chain_id;

-- D.3.01.14 — Карта общин
CREATE OR REPLACE VIEW v_community_map AS
SELECT
  c.id,
  c.code,
  c.name,
  c.status,
  c.level,
  c.mother_community_id,
  (SELECT COUNT(*) FROM communities c2 WHERE c2.mother_community_id = c.id) AS children_count,
  (SELECT COUNT(*) FROM flow_bridges b
   WHERE (b.community_a = c.id OR b.community_b = c.id)
     AND b.status = 'active') AS bridge_count,
  CASE
    WHEN (SELECT COUNT(*) FROM communities) BETWEEN 2 AND 10 THEN 'direct'
    WHEN (SELECT COUNT(*) FROM communities) BETWEEN 11 AND 50 THEN 'regional'
    WHEN (SELECT COUNT(*) FROM communities) BETWEEN 51 AND 500 THEN 'continental'
    WHEN (SELECT COUNT(*) FROM communities) > 500 THEN 'planetary'
    ELSE 'direct'
  END AS coordination_level
FROM communities c;

COMMIT;