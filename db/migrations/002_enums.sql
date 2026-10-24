-- ─────────────────────────────────────────────
-- D.2.01.02 — ENUM types
-- Единый источник всех enum-типов.
-- Синхронизировано с C.0.01.04 (Types).
-- Идемпотентно: повторный прогон не сломает.
-- ─────────────────────────────────────────────

-- ─── Участники ─────────────────────────────────
DO $$ BEGIN CREATE TYPE participant_status_enum AS ENUM (
  'compatible', 'conditionally_compatible', 'associated', 'full',
  'paused', 'outside_trust_network', 'master', 'integrator', 'pioneer', 'excluded'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE risk_enum AS ENUM (
  'compatible', 'conditionally_compatible', 'incompatible'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE registration_status_enum AS ENUM (
  'new', 'interview_scheduled', 'decided', 'accepted',
  'conditionally_accepted', 'rejected'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE interview_verdict_enum AS ENUM (
  'compatible', 'conditionally_compatible', 'incompatible'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Направления, роли, ячейки ────────────────
DO $$ BEGIN CREATE TYPE direction_type_enum AS ENUM (
  'permanent', 'temporary'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE direction_status_enum AS ENUM (
  'active', 'empty', 'delegated', 'blocked', 'abolished'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE role_type_enum AS ENUM (
  'permanent', 'temporary', 'regime'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE role_assignment_status_enum AS ENUM (
  'active', 'finished', 'revoked'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE council_type_enum AS ENUM (
  'direction', 'gateway', 'protocol', 'convergence', 'appellate'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE council_status_enum AS ENUM (
  'active', 'dissolved'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE council_member_status_enum AS ENUM (
  'active', 'finished'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE cell_role_enum AS ENUM (
  'member', 'coordinator', 'otc', 'keeper', 'liaison',
  'verifier', 'balancer', 'psy'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Мандаты ───────────────────────────────────
DO $$ BEGIN CREATE TYPE mandate_status_enum AS ENUM (
  'active', 'expired', 'revoked'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE delegation_status_enum AS ENUM (
  'active', 'revoked', 'expired'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE rotation_status_enum AS ENUM (
  'scheduled', 'executed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Планы и задачи ────────────────────────────
DO $$ BEGIN CREATE TYPE plan_type_enum AS ENUM (
  'standard', 'crisis', 'excess', 'dissident'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE plan_status_enum AS ENUM (
  'draft', 'run', 'approved', 'in_progress', 'completed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE plan_task_role_enum AS ENUM (
  'executor', 'consultant', 'controller'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE daily_plan_status_enum AS ENUM (
  'draft', 'approved', 'in_progress', 'completed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE priority_enum AS ENUM (
  'critical', 'high', 'standard', 'background'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE task_status_enum AS ENUM (
  'created', 'assigned', 'in_progress', 'submitted', 'accepted', 'returned'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Отчёты и ОТК ──────────────────────────────
DO $$ BEGIN CREATE TYPE report_type_enum AS ENUM (
  'photo', 'video', 'text'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE otc_verdict_enum AS ENUM (
  'accepted', 'returned', 'crisis_protocol'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE appeal_status_enum AS ENUM (
  'filed', 'reviewed', 'resolved'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Сигналы, Коннект, Арбитраж, Прогоны ───────
DO $$ BEGIN CREATE TYPE signal_type_enum AS ENUM (
  'need', 'problem', 'idea', 'failure'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE signal_status_enum AS ENUM (
  'new', 'run', 'connect', 'plan', 'completed', 'rejected'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE signal_response_enum AS ENUM (
  'support', 'object', 'clarify', 'amend', 'no_influence'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE connection_status_enum AS ENUM (
  'started', 'diagnostics', 'finished'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE connection_result_enum AS ENUM (
  'resolved', 'divergent', 'variant_found', 'incompatible', 'undetermined'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE arbitration_type_enum AS ENUM (
  'procedural', 'ownership'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE arbitration_status_enum AS ENUM (
  'submitted', 'in_progress', 'decided', 'escalated_to_jury'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE universal_run_type_enum AS ENUM (
  'sequential', 'parallel', 'crisis'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE run_status_enum AS ENUM (
  'started', 'collecting', 'aggregated', 'finished'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Потоки ────────────────────────────────────
DO $$ BEGIN CREATE TYPE flow_type_enum AS ENUM (
  'main', 'reflective', 'council', 'mentoring', 'creation', 'cross_direction'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE flow_return_status_enum AS ENUM (
  'active', 'paused'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Блага и стандарты ─────────────────────────
DO $$ BEGIN CREATE TYPE good_type_enum AS ENUM (
  'material', 'nonmaterial'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE good_status_enum AS ENUM (
  'draft', 'test', 'active', 'obsolete', 'liquidated'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE good_request_status_enum AS ENUM (
  'pending', 'approved', 'rejected', 'delivered', 'experimental'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE project_resource_status_enum AS ENUM (
  'pending', 'signed', 'issued', 'returned'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE modifier_status_enum AS ENUM (
  'pending', 'active', 'rejected'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Режимы ────────────────────────────────────
DO $$ BEGIN CREATE TYPE regime_type_enum AS ENUM (
  'red_circuit', 'steel_bell', 'ptt', 'info_blockade',
  'quantum_acceleration', 'global_red_circuit'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE regime_status_enum AS ENUM (
  'active', 'finished', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE mobilization_status_enum AS ENUM (
  'active', 'completed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Балансировка ──────────────────────────────
DO $$ BEGIN CREATE TYPE anomaly_type_enum AS ENUM (
  'speed', 'format', 'etiquette', 'priority', 'iteration'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE anomaly_status_enum AS ENUM (
  'new', 'analyzed', 'resolved'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE competence_risk_status_enum AS ENUM (
  'active', 'removed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE guardian_index_type_enum AS ENUM (
  'defense_maturity', 'excess_capacity', 'import_dependency'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Верификация ───────────────────────────────
DO $$ BEGIN CREATE TYPE audit_type_enum AS ENUM (
  'planned', 'unplanned', 'procedural', 'request'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE audit_status_enum AS ENUM (
  'open', 'in_progress', 'finished'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE recheck_result_enum AS ENUM (
  'match', 'mismatch'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE code_system_enum AS ENUM (
  'prefix_filter', 'balance', 'digital_mentor', 'other'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE integrity_action_enum AS ENUM (
  'digital_attack', 'modification_attempt'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Архив ─────────────────────────────────────
DO $$ BEGIN CREATE TYPE archive_doc_type_enum AS ENUM (
  'protocol', 'decision', 'act', 'report', 'journal'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE chain_step_type_enum AS ENUM (
  'problem', 'request', 'response', 'decision',
  'realization', 'result', 'correction'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Правозащита ───────────────────────────────
DO $$ BEGIN CREATE TYPE complaint_type_enum AS ENUM (
  'violence', 'threat', 'coercion', 'harassment'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE complaint_status_enum AS ENUM (
  'filed', 'investigation', 'closed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE investigation_status_enum AS ENUM (
  'open', 'in_progress', 'closed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE resocialization_status_enum AS ENUM (
  'active', 'completed', 'failed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE sanction_type_enum AS ENUM (
  'restorative_talk', 'temporary_isolation', 'resocialization',
  'exclusion', 'not_imputable'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE sanction_status_enum AS ENUM (
  'imposed', 'served', 'appealed', 'revoked'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Жюри ──────────────────────────────────────
DO $$ BEGIN CREATE TYPE jury_session_type_enum AS ENUM (
  'normal_12', 'extended_24'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE veto_type_enum AS ENUM (
  'semantic_guardian', 'jury'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE veto_status_enum AS ENUM (
  'active', 'lifted', 'expired'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE outside_trust_status_enum AS ENUM (
  'active', 'reviewed', 'lifted'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Психоэкология ─────────────────────────────
DO $$ BEGIN CREATE TYPE psy_session_type_enum AS ENUM (
  'onboarding', 'crisis', 'discharge', 'resonance'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE psy_session_status_enum AS ENUM (
  'scheduled', 'in_progress', 'completed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE psy_crisis_status_enum AS ENUM (
  'open', 'in_progress', 'closed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE psy_discharge_status_enum AS ENUM (
  'scheduled', 'in_progress', 'completed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE trend_enum AS ENUM (
  'up', 'stable', 'down'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE hygiene_status_enum AS ENUM (
  'proposed', 'applied', 'rejected'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Шлюз ──────────────────────────────────────
DO $$ BEGIN CREATE TYPE gateway_tx_type_enum AS ENUM (
  'purchase', 'sale', 'diplomacy', 'migration'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE gateway_tx_status_enum AS ENUM (
  'pending', 'approved', 'completed', 'rejected'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE external_asset_type_enum AS ENUM (
  'real_estate', 'business', 'finance'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE external_asset_status_enum AS ENUM (
  'accepted', 'converting', 'converted'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE guarantor_status_enum AS ENUM (
  'active', 'expired', 'removed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE witness_status_enum AS ENUM (
  'active', 'inactive'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE external_defense_type_enum AS ENUM (
  'external', 'internal', 'global'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE defense_status_enum AS ENUM (
  'active', 'inactive'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Кванты ────────────────────────────────────
DO $$ BEGIN CREATE TYPE quantum_status_enum AS ENUM (
  'detected', 'audit', 'testing', 'scaling', 'active', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE quantum_test_result_enum AS ENUM (
  'success', 'failure'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Конструктор ───────────────────────────────
DO $$ BEGIN CREATE TYPE panel_context_enum AS ENUM (
  'normal', 'crisis', 'steel_bell'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE right_action_enum AS ENUM (
  'V', 'C', 'E', 'D', 'A', 'Dg', 'R', 'Vo', 'Act', 'Ar', 'S', 'F'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE right_scope_enum AS ENUM (
  'self', 'dir', 'all', 'agg', 'raw', 'arch'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Планетарный уровень ───────────────────────
DO $$ BEGIN CREATE TYPE community_status_enum AS ENUM (
  'incubation', 'active', 'node', 'center'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE council_member_type_enum AS ENUM (
  'delegate', 'expert', 'guardian'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE bridge_status_enum AS ENUM (
  'active', 'suspended'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE referendum_type_enum AS ENUM (
  'convergence', 'gateway_dissolve', 'core'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE referendum_status_enum AS ENUM (
  'initiated', 'voting', 'decided'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Конвергенция ──────────────────────────────
DO $$ BEGIN CREATE TYPE convergence_status_enum AS ENUM (
  'draft', 'declared', 'in_progress', 'completed', 'failed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE debt_type_enum AS ENUM (
  'external', 'internal'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE debt_action_enum AS ENUM (
  'annul', 'convert'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE weapon_action_enum AS ENUM (
  'utilize', 'reserve', 'energy'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE cultural_center_status_enum AS ENUM (
  'planned', 'open', 'closed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Семантика ─────────────────────────────────
DO $$ BEGIN CREATE TYPE drift_status_enum AS ENUM (
  'new', 'analyzed', 'resolved'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE alarm_status_enum AS ENUM (
  'raised', 'acknowledged', 'escalated', 'resolved'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE alarm_escalation_enum AS ENUM (
  'council', 'forum', 'referendum'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Эксперименты ──────────────────────────────
DO $$ BEGIN CREATE TYPE experiment_status_enum AS ENUM (
  'filed', 'approved', 'active', 'completed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE dissident_resource_enum AS ENUM (
  'deferred_flow', 'freedom_reserve'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE dissident_status_enum AS ENUM (
  'filed', 'active', 'suspended', 'reviewed', 'closed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Обучение ──────────────────────────────────
DO $$ BEGIN CREATE TYPE enrollment_status_enum AS ENUM (
  'enrolled', 'in_progress', 'completed', 'dropped'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE ptt_status_enum AS ENUM (
  'started', 'compression', 'materialization', 'reintegration',
  'completed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE route_status_enum AS ENUM (
  'active', 'completed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Автоматизация ─────────────────────────────
DO $$ BEGIN CREATE TYPE ai_recommendation_enum AS ENUM (
  'approve', 'reject'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE decision_status_enum AS ENUM (
  'pending', 'approved', 'rejected', 'deferred'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE operator_audit_status_enum AS ENUM (
  'ok', 'audit_required', 'removed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Агрегатор ─────────────────────────────────
DO $$ BEGIN CREATE TYPE cluster_status_enum AS ENUM (
  'new', 'validated', 'rejected', 'routed'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Коннективность ────────────────────────────
DO $$ BEGIN CREATE TYPE conn_status_enum AS ENUM (
  'queued', 'routed', 'overdue', 'escalated'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Админ ─────────────────────────────────────
DO $$ BEGIN CREATE TYPE bootstrap_type_enum AS ENUM (
  'initial', 'reseed', 'migration'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Аудит ─────────────────────────────────────
DO $$ BEGIN CREATE TYPE actor_type_enum AS ENUM (
  'participant', 'ai', 'system'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─────────────────────────────────────────────
-- Проверка: список созданных ENUM
-- ─────────────────────────────────────────────
DO $$
DECLARE
    enum_count INT;
BEGIN
    SELECT COUNT(*) INTO enum_count
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e' AND n.nspname = 'public';

    RAISE NOTICE 'Создано ENUM-типов в public: %', enum_count;
END $$;