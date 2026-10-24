// C.0.01.04 — Общие типы и интерфейсы
// Единый словарь состояний. Никаких enum — только строковые литералы.

export type UUID = string;
export type ISODateTime = string;

// Приоритеты (I.1.4.1)
export type Priority = 'critical' | 'high' | 'standard' | 'background';

// Сигналы (II.1)
export type SignalStatus = 'new' | 'run' | 'connect' | 'plan' | 'completed' | 'rejected';
export type SignalType = 'need' | 'problem' | 'idea' | 'failure';
export type SignalResponseType = 'support' | 'object' | 'clarify' | 'amend' | 'no_influence';

// Задачи (II.5)
export type TaskStatus = 'created' | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'returned';

// Планы (II.4)
export type PlanStatus = 'draft' | 'run' | 'approved' | 'in_progress' | 'completed' | 'cancelled';
export type PlanType = 'standard' | 'crisis' | 'excess' | 'dissident';

// Блага (I.1.5)
export type GoodStatus = 'draft' | 'test' | 'active' | 'obsolete' | 'liquidated';
export type GoodType = 'material' | 'nonmaterial';

// Направления (I.4)
export type DirectionType = 'permanent' | 'temporary';
export type DirectionStatus = 'active' | 'empty' | 'delegated' | 'blocked' | 'abolished';

// Участники (I.1.4)
export type ParticipantStatus =
  | 'compatible'
  | 'conditionally_compatible'
  | 'associated'
  | 'full'
  | 'paused'
  | 'outside_trust_network'
  | 'master'
  | 'integrator'
  | 'pioneer'
  | 'excluded';

// Статус заявки на регистрацию (D.1.01.01)
export type RegistrationStatus =
  | 'new'
  | 'interview_scheduled'
  | 'decided'
  | 'accepted'
  | 'conditionally_accepted'
  | 'rejected';

// Вердикт интервью (D.1.01.01)
export type InterviewVerdict =
  | 'compatible'
  | 'conditionally_compatible'
  | 'incompatible';

export type RiskLevel = 'compatible' | 'conditionally_compatible' | 'incompatible';

// Потоки (I.1.6)
export type FlowType =
  | 'main'
  | 'reflective'
  | 'council'
  | 'mentoring'
  | 'creation'
  | 'cross_direction';

// Мандаты (I.1.7)
export type MandateStatus = 'active' | 'expired' | 'revoked';
export type DelegationStatus = 'active' | 'revoked' | 'expired';
export type RotationStatus = 'scheduled' | 'executed' | 'cancelled';

// Кванты (IV.3)
export type QuantumStatus = 'detected' | 'audit' | 'testing' | 'scaling' | 'active' | 'cancelled';

// Общины (V.6)
export type CommunityStatus = 'incubation' | 'active' | 'node' | 'center';

// Режимы (VI.1, VI.2)
export type RegimeType =
  | 'red_circuit'
  | 'steel_bell'
  | 'ptt'
  | 'info_blockade'
  | 'quantum_acceleration'
  | 'global_red_circuit';
export type RegimeStatus = 'active' | 'finished' | 'cancelled';

// Санкции (VII.2)
export type SanctionType =
  | 'restorative_talk'
  | 'temporary_isolation'
  | 'resocialization'
  | 'exclusion'
  | 'not_imputable';
export type SanctionStatus = 'imposed' | 'served' | 'appealed' | 'revoked';

// Жалобы (VII.2)
export type ComplaintType = 'violence' | 'threat' | 'coercion' | 'harassment';
export type ComplaintStatus = 'filed' | 'investigation' | 'closed';

// Жюри (III.3)
export type JurySessionType = 'normal_12' | 'extended_24';
export type VetoType = 'semantic_guardian' | 'jury';
export type VetoStatus = 'active' | 'lifted' | 'expired';

// Психоэкология (I.4.12)
export type PsySessionType = 'onboarding' | 'crisis' | 'discharge' | 'resonance';
export type PsySessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

// Коннект (II.3)
export type ConnectionStatus = 'started' | 'diagnostics' | 'finished';
export type ConnectionResult =
  | 'resolved'
  | 'divergent'
  | 'variant_found'
  | 'incompatible'
  | 'undetermined';

// Арбитраж (II.3.7)
export type ArbitrationType = 'procedural' | 'ownership';
export type ArbitrationStatus = 'submitted' | 'in_progress' | 'decided' | 'escalated_to_jury';

// Всеобщий прогон (II.2)
export type UniversalRunType = 'sequential' | 'parallel' | 'crisis';
export type RunStatus = 'started' | 'collecting' | 'aggregated' | 'finished';

// Права (I.1.10)
export type RightAction = 'V' | 'C' | 'E' | 'D' | 'A' | 'Dg' | 'R' | 'Vo' | 'Act' | 'Ar' | 'S' | 'F';
export type RightScope = 'self' | 'dir' | 'all' | 'agg' | 'raw' | 'arch';

// Пагинация — универсальная обёртка для всех списочных ответов
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    per_page: number;
    total: number;
  };
  audit_id: string;
}

// Универсальный ответ API
export interface ApiResponse<T> {
  data: T;
  audit_id: string;
}