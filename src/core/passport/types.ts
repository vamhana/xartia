// C.1.01.01 — Типы домена «Профессиональный паспорт» (Фаза 1).
// См. docs/паспорт.md v0.3.4, docs/passport-implementation.md.
//
// Здесь только типы. Логика — в catalog.ts / assessment.ts /
// projection.ts / visibility.ts. API-контракты — в controller.ts.
//
// ВАЖНО: не путать с PassportFull (src/core/participants/service.ts).
// PassportFull — это профиль участника (старый /me/passport). Это ДРУГОЙ домен.

import type { UUID, ISODateTime } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Скалярные перечисления (совпадают с CHECK в 058)
// ─────────────────────────────────────────────────────────────────────

export type AtomStatus =
  | 'candidate'
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'deprecated';

export type AtomCluster =
  | 'requirements_and_computational_thinking'
  | 'software_development'
  | 'data_and_databases'
  | 'server_interfaces_and_api'
  | 'testing_and_quality'
  | 'software_security'
  | 'infrastructure_and_operations';

export type Dimension = 'U' | 'X' | 'D' | 'P' | 'E';

export const DIMENSIONS: readonly Dimension[] = ['U', 'X', 'D', 'P', 'E'] as const;

export type RelationType =
  | 'part_of'
  | 'requires'
  | 'prerequisite_for'
  | 'alternative_to'
  | 'shared_foundation'
  | 'applied_in'
  | 'related_to';

export type PersonAtomStatus =
  | 'not_assessed'
  | 'declared'
  | 'confirmed'
  | 'disputed'
  | 'under_review'
  | 'not_applicable'
  | 'calibration_pending';

export type EvidenceType =
  | 'declaration'
  | 'training'
  | 'portfolio'
  | 'practical_task'
  | 'exam'
  | 'specialist_conclusion'
  | 'independent_review'
  | 'real_activity'
  | 'regular_practice';

export type EvidenceStatus =
  | 'submitted'
  | 'accepted'
  | 'disputed'
  | 'rejected'
  | 'invalidated'
  | 'withdrawn'
  | 'superseded';

// NB: not_assessed здесь НЕТ — отсутствие оценки живёт в person_atom_states.
export type AssessmentStatus =
  | 'provisional'
  | 'calibration_pending'
  | 'active'
  | 'under_review'
  | 'rejected'
  | 'superseded'
  | 'invalidated';

export type VisibilityScope = 'public' | 'mentor' | 'assessor' | 'task' | 'team';

export type VisibilityLevel = 'private' | 'summary' | 'levels' | 'full';

/**
 * Явный грант доступа к чужому паспорту (миграция 059).
 * Реализует §18.2: «доступ предоставляется только на заявленную цель
 * и в минимально необходимом объёме… может быть ограничен по сроку
 * и отозван».
 *
 *   mentor   — обычная проверка идёт через participants.mentor_id;
 *              грант — для случая, когда subject хочет дать доступ
 *              кому-то, кто не назначен mentor_id (Фаза 3 расширит
 *              на per-atom mentor из teaching_relations).
 *   assessor — viewer имеет роль assessor и subject разрешил;
 *              грант — для случая, когда role-проверки достаточно,
 *              но явного согласия через visibility нет.
 *   task     — обязателен task_id; проверяется tasks.assigned_to.
 */
export type GrantScope = 'mentor' | 'assessor' | 'task';

export interface ScopeGrantRow {
  id: UUID;
  subject_id: UUID;
  viewer_id: UUID;
  scope: GrantScope;
  task_id: UUID | null;
  reason: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_by: UUID;
  created_at: Date;
}

export interface ScopeGrant {
  id: UUID;
  subjectId: UUID;
  viewerId: UUID;
  scope: GrantScope;
  taskId: UUID | null;
  reason: string | null;
  expiresAt: ISODateTime | null;
  revokedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export type HistoryEventType =
  | 'claim_declared'
  | 'evidence_submitted'
  | 'evidence_accepted'
  | 'evidence_rejected'
  | 'assessment_created'
  | 'assessment_activated'
  | 'assessment_under_review'
  | 'appeal_filed'
  | 'appeal_resolved'
  | 'visibility_changed'
  | 'path_created'
  | 'path_completed'
  | 'path_abandoned'
  | 'task_profile_created'
  | 'task_profile_updated'
  | 'teaching_relation_created'
  | 'teaching_relation_revoked'
  | 'permit_issued'
  | 'permit_revoked'
  | 'mentor_question_asked'
  | 'mentor_question_answered'
  | 'team_assessed';

export type DevelopmentPathStatus = 'active' | 'completed' | 'abandoned';

export type ContentChangeRate =
  | 'permanent'
  | 'slow'
  | 'medium'
  | 'fast'
  | 'very_fast';

// ─────────────────────────────────────────────────────────────────────
// Формы JSONB-полей (не валидируются в БД, валидируются в коде)
// ─────────────────────────────────────────────────────────────────────

export interface DimensionApplicabilityEntry {
  applicable: boolean;
  name?: string;
  /** Обязательно, если applicable=false (см. паспорт 3.2, 5.1). */
  reason?: string;
}

export type DimensionApplicability = Partial<
  Record<Dimension, DimensionApplicabilityEntry>
>;

export interface FreshnessPolicy {
  content_change_rate: ContentChangeRate;
  /**
   * Правило/срок переподтверждения практики.
   * В Фазе 1: строка 'to_calibrate' либо ISO-8601 duration, либо имя правила.
   */
  practice_review_policy: string;
}

export interface AssessmentCriteria {
  /** 'draft' — черновые критерии (для 0011–0054); 'approved' — калиброванные. */
  status: 'draft' | 'in_review' | 'approved';
  /** Текстовые критерии по каждому применимому измерению. */
  U?: string;
  X?: string;
  D?: string;
  P?: string;
  E?: string;
}

export interface EvidenceContext {
  domain?: string;            // 'backend' | 'qa' | 'devops' | ...
  scale?: string;             // 'personal' | 'team' | 'critical' | ...
  autonomy?: string;          // 'solo' | 'pair' | 'supervised'
  constraints?: string[];
  [key: string]: unknown;
}

export interface RequirementAtom {
  atom_id: string;
  min: Partial<Record<Dimension, number>>;  // 0..9
}

export interface ProfileRequirements {
  atoms: RequirementAtom[];
  aggregates?: {
    width_min?: number;
    depth_min?: number;
  };
  alternatives?: string[];   // atom_id[]
  context?: EvidenceContext;
  /** 'pending' — гипотеза; 'done' — откалибровано. */
  calibration: 'pending' | 'done';
}

// ─────────────────────────────────────────────────────────────────────
// Строки БД (то, что возвращает pg)
// ─────────────────────────────────────────────────────────────────────

export interface CompetencyAtomRow {
  atom_id: string;
  cluster: AtomCluster;
  name: string;
  definition: string;
  boundary_includes: string[];
  boundary_excludes: string[];
  context: string | null;
  input: string | null;
  outcome: string | null;
  assessment_criteria: AssessmentCriteria;
  assessment_methods: string[];
  dimension_applicability: DimensionApplicability;
  freshness_policy: FreshnessPolicy;
  translations: Record<string, unknown>;
  status: AtomStatus;
  version: string;
  created_at: Date;
  updated_at: Date;
}

export interface CompetencyRelationRow {
  id: UUID;
  from_atom_id: string;
  to_atom_id: string;
  relation_type: RelationType;
  note: string | null;
  created_at: Date;
}

export interface ProfessionProfileRow {
  id: UUID;
  slug: string;
  name: string;
  version: string;
  requirements: ProfileRequirements;
  status: AtomStatus;
  created_at: Date;
  updated_at: Date;
}

export interface PersonAtomStateRow {
  participant_id: UUID;
  atom_id: string;
  dimension: Dimension;
  level: number | null;         // 0..9 или NULL (нет оценки)
  status: PersonAtomStatus;
  updated_at: Date;
}

export interface PassportEvidenceRow {
  id: UUID;
  participant_id: UUID;
  atom_id: string;
  dimension: Dimension;
  evidence_type: EvidenceType;
  description: string;
  artifact_url: string | null;
  context: EvidenceContext;
  status: EvidenceStatus;
  created_by: UUID;
  created_at: Date;
  reused_from_evidence_id: UUID | null;
  supersedes_evidence_id: UUID | null;
}

export interface PassportAssessmentRow {
  id: UUID;
  participant_id: UUID;
  atom_id: string;
  dimension: Dimension;
  level: number | null;
  method: string;
  assessor_id: UUID;
  context: EvidenceContext;
  status: AssessmentStatus;
  created_at: Date;
  criteria_version: string | null;
}

export interface PassportHistoryEventRow {
  id: UUID;
  participant_id: UUID;
  atom_id: string | null;
  event_type: HistoryEventType;
  payload: Record<string, unknown>;
  actor_id: UUID | null;
  created_at: Date;
}

export interface PassportVisibilityRow {
  participant_id: UUID;
  scope: VisibilityScope;
  visibility: VisibilityLevel;
  consent: boolean;
  updated_at: Date;
}

export interface PassportAccessLogRow {
  id: UUID;
  participant_id: UUID;
  viewer_id: UUID | null;
  scope: string;
  reason: string | null;
  created_at: Date;
}

export interface DevelopmentPathRow {
  id: UUID;
  participant_id: UUID;
  goal: string;
  target_profile_id: UUID | null;
  missing_atoms: Array<{
    atom_id: string;
    missing_dimensions: Dimension[];
    /** Заполняется при createPath для атомов с relation_type='alternative_to'. */
    alternative_atom_ids?: string[];
  }>;
  status: DevelopmentPathStatus;
  created_at: Date;
  updated_at: Date;
}

// ─────────────────────────────────────────────────────────────────────
// API DTO (то, что уходит на фронт; camelCase)
// ─────────────────────────────────────────────────────────────────────

export interface DimensionState {
  dimension: Dimension;
  /** null = нет оценки. 0 = измеренная нулевая способность. */
  level: number | null;
  status: PersonAtomStatus;
  updatedAt: ISODateTime;
}

export interface AtomSummary {
  atomId: string;
  cluster: AtomCluster;
  name: string;
  status: AtomStatus;
  version: string;
}

export interface AtomRelation {
  fromAtomId: string;
  toAtomId: string;
  relationType: RelationType;
  note: string | null;
}

export interface EvidenceItem {
  id: UUID;
  atomId: string;
  dimension: Dimension;
  evidenceType: EvidenceType;
  description: string;
  artifactUrl: string | null;
  context: EvidenceContext;
  status: EvidenceStatus;
  createdAt: ISODateTime;
  reusedFromEvidenceId: UUID | null;
}

export interface AssessmentItem {
  id: UUID;
  atomId: string;
  dimension: Dimension;
  level: number | null;
  method: string;
  assessorId: UUID;
  context: EvidenceContext;
  status: AssessmentStatus;
  createdAt: ISODateTime;
  /**
  * Действующая (true) или историческая (false).
  * false — superseded / invalidated / rejected: показывается серым в UI,
  * но не скрывается (паспорт §18.1 требует сохранять историю замены).
  */
  isCurrent: boolean;
  /** Снимок competency_atoms.version на момент оценки. NULL — до миграции 065. */
  criteriaVersion: string | null;
}

/**
 * Активный assessment, у которого истёк practice_review_policy (§7.5).
 * Уровень не понижается; UI помечает «устарело».
 */
export interface StaleAssessment {
  atomId: string;
  dimension: Dimension;
  assessorId: UUID;
  assessedAt: ISODateTime;
  staleSince: ISODateTime;
  policy: string;
}

export interface HistoryItem {
  id: UUID;
  atomId: string | null;
  eventType: HistoryEventType;
  payload: Record<string, unknown>;
  actorId: UUID | null;
  createdAt: ISODateTime;
}

/** Карточка атома в масштабе 3 (см. паспорт 8.3). */
export interface AtomCard {
  atom: CompetencyAtomRow;
  relations: AtomRelation[];
  /** Только те измерения, что применимы; для остальных applicable=false. */
  dimensions: DimensionState[];
  /** Доказательства, доступные текущему зрителю (фильтр по visibility). */
  evidence: EvidenceItem[];
  /** Активные/под-ревью оценки; rejected/superseded не отдаём в карточке. */
  assessments: AssessmentItem[];
  /** История последних N событий по атому. */
  history: HistoryItem[];
}

/** Строка каталога (масштаб 2). */
export interface CatalogItem {
  atomId: string;
  cluster: AtomCluster;
  name: string;
  definition: string;
  status: AtomStatus;
  version: string;
}

export interface CatalogQuery {
  query?: string;       // по name/atom_id (ILIKE)
  cluster?: AtomCluster;
  status?: AtomStatus;
  /** Фильтр по направлению Хартии (number, 1..17). */
  direction?: number;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Обзор (масштаб 1)
// ─────────────────────────────────────────────────────────────────────

/** Агрегаты ширины/глубины по кластеру. */
export interface ClusterAggregate {
  cluster: AtomCluster;
  /** Число атомов с level >= 4 по ВСЕМ применимым измерениям. */
  width: number;
  /** Число атомов с depth_execution (P>=7). */
  depthExecution: number;
  /** Число атомов с depth_understanding (U,X,D,E >= 7, где применимы). */
  depthUnderstanding: number;
  /** Число атомов, где И depth_execution, И depth_understanding. */
  depthFull: number;
  /** Разбивка по статусам (для табличного режима UI). */
  counts: CountsByStatus;
}

export interface CountsByStatus {
  notAssessed: number;
  declared: number;
  confirmed: number;
  inProgress: number;          // provisional
  calibrationPending: number;
  underReview: number;
  disputed: number;
  notApplicable: number;
}

export interface PassportOverview {
  participantId: UUID;
  visibility: VisibilityLevel;
  /** Сводные агрегаты по всему паспорту. */
  width: number;
  depthExecution: number;
  depthUnderstanding: number;
  depthFull: number;
  /** Разбивка по кластерам. */
  byCluster: ClusterAggregate[];
  /** Разбивка по статусам (глобально). */
  counts: CountsByStatus;
  /**
   * Количество атомов, у которых assessment.status='calibration_pending'
   * (см. план §3 A1). Не входит в width/depth.
   */
  calibrationPendingAtoms: number;
  /** Активные цели / фантомные маршруты. */
  goals: DevelopmentPathItem[];
  /**
   * Активные assessments, у которых истёк practice_review_policy (§7.5).
   * Уровень не понижается, но UI помечает «устарело».
   * Всегда массив (пустой, если нет).
   */
  staleAssessments: StaleAssessment[];
  updatedAt: ISODateTime;
}

export interface DevelopmentPathItem {
  id: UUID;
  goal: string;
  targetProfileId: UUID | null;
  targetProfileSlug: string | null;
  missingAtoms: Array<{
    atomId: string;
    atomName: string;
    missingDimensions: Dimension[];
    alternativeAtomIds: string[];
  }>;
  status: DevelopmentPathStatus;
  createdAt: ISODateTime;
}

// ─────────────────────────────────────────────────────────────────────
// Видимость
// ─────────────────────────────────────────────────────────────────────

export interface VisibilityState {
  scope: VisibilityScope;
  visibility: VisibilityLevel;
  consent: boolean;
  updatedAt: ISODateTime;
}

export interface VisibilityPatch {
  scope: VisibilityScope;
  visibility: VisibilityLevel;
  consent: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Входные тела запросов
// ─────────────────────────────────────────────────────────────────────

export interface CreateEvidenceInput {
  atomId: string;
  dimension: Dimension;
  evidenceType: EvidenceType;
  description: string;
  artifactUrl?: string | null;
  context?: EvidenceContext;
}

export interface CreateAssessmentInput {
  participantId: UUID;       // subject
  atomId: string;
  dimension: Dimension;
  level: number;             // 0..9, обязательное (assessment всегда с уровнем)
  method: string;
  context?: EvidenceContext;
  /** Явные evidence, подтверждающие assessment. В Фазе 2 — опционально. */
  evidenceIds?: UUID[];
}

export interface CreateGrantInput {
  viewerId: UUID;
  scope: GrantScope;
  taskId?: UUID;
  expiresAt?: ISODateTime;
  reason?: string;
}

export interface CreateAppealInput {
  assessmentId: UUID;
  reason: string;
}

export interface CreatePathInput {
  goal: string;
  targetProfileSlug?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3a — TaskProfile, TeachingRelation, AtomDirection (060)
// ─────────────────────────────────────────────────────────────────────

// TaskProfile (§11.1)

export type TaskProfileRole =
  | 'executor'
  | 'designer'
  | 'consultant'
  | 'assessor';

export type TaskProfileStatus = 'draft' | 'active' | 'deprecated';

export interface RequiredAtom {
  atom_id: string;
  min: Partial<Record<Dimension, number>>;   // 0..9
  role: TaskProfileRole;
}

export interface TaskProfileRow {
  id: UUID;
  task_id: UUID;
  required_atoms: RequiredAtom[];
  permit_ids: string[];
  acceptance_criteria: Record<string, unknown> | null;
  evidence_form: Record<string, unknown> | null;
  security_constraints: Record<string, unknown> | null;
  version: number;
  status: TaskProfileStatus;
  created_by: UUID;
  created_at: Date;
  updated_at: Date;
}

export interface TaskProfile {
  id: UUID;
  taskId: UUID;
  requiredAtoms: RequiredAtom[];
  permitIds: string[];
  acceptanceCriteria: Record<string, unknown> | null;
  evidenceForm: Record<string, unknown> | null;
  securityConstraints: Record<string, unknown> | null;
  version: number;
  status: TaskProfileStatus;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// TeachingRelation (§12)

export type TeachingRelationStatus = 'active' | 'revoked' | 'expired';

export interface TeachingRelationRow {
  id: UUID;
  mentor_id: UUID;
  mentee_id: UUID;
  atom_id: string;
  dimensions: Dimension[];
  status: TeachingRelationStatus;
  valid_from: Date;
  valid_to: Date | null;
  reason: string | null;
  created_by: UUID;
  created_at: Date;
}

export interface TeachingRelation {
  id: UUID;
  mentorId: UUID;
  menteeId: UUID;
  atomId: string;
  dimensions: Dimension[];
  status: TeachingRelationStatus;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
  reason: string | null;
  createdBy: UUID;
  createdAt: ISODateTime;
}

// Readiness (§12.2)

export type ReadinessState = 'ready' | 'not_ready' | 'unknown';

export interface ReadinessSignal {
  dimension: Dimension;
  level: number | null;
  required: number;
  ok: boolean;
}

export interface ReadinessResult {
  mentorId: UUID;
  atomId: string;
  state: ReadinessState;
  /** 0..1 — доля выполненных условий. Для UI-сортировки. */
  score: number;
  /** Только применимые измерения. */
  signals: ReadinessSignal[];
  /** Причина 'not_ready' или 'unknown'. */
  reason?: string;
}

// AtomDirectionMap (§14)

export type AtomDirectionRole = 'home' | 'main' | 'related';

export interface AtomDirectionRow {
  id: UUID;
  atom_id: string;
  direction_id: UUID;
  role: AtomDirectionRole;
  note: string | null;
  created_at: Date;
}

export interface AtomDirection {
  directionId: UUID;
  directionNumber: number;
  directionName: string;
  role: AtomDirectionRole;
  note: string | null;
}

export interface AtomDirections {
  home: AtomDirection | null;
  main: AtomDirection | null;
  related: AtomDirection[];
}

// Direction ref (для GET /passport/directions)

export interface DirectionRef {
  id: UUID;
  number: number;
  name: string;
  type: 'permanent' | 'temporary';
  status: string;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3a — Matching (§11.2)
// ─────────────────────────────────────────────────────────────────────

export type MatchStatus = 'match' | 'partial' | 'no_match';

export interface MatchGap {
  /**
   * null — permit-gap (не привязан к атому). Строка — atom-gap.
   * В 3a всегда строка; в 3b добавляется null для permit'ов.
   */
  atomId: string | null;
  /** Для permit-gap: какой permit не покрыт. */
  permitId?: string;
  role: TaskProfileRole;
  missingDimensions: Dimension[];
  /** Критичный gap: не покрыто измерение, критичное для роли. */
  critical: boolean;
  reason: 'missing_dimensions' | 'missing_permit';
  /**
   * При наличии 'missing_permit':
   * 'absent' (нет записи), 'expired' (истёк), 'revoked' (отозван).
   */
  permitStatus?: 'absent' | 'expired' | 'revoked';
}

export interface TaskMatching {
  taskId: UUID;
  participantId: UUID;
  status: MatchStatus;
  gaps: MatchGap[];
  checkedCount: number;
  /** 0..1 — доля покрытых required_atoms (для UI-сортировки). */
  coverage: number;
}

export interface TaskCandidate {
  participantId: UUID;
  participantExternalId: string;
  participantName: string;
  /** Сколько required_atoms покрыто полностью. */
  matches: number;
  /** Сколько required_atoms имеют gap (любой, включая критичный). */
  gaps: number;
  status: MatchStatus;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3b — Permit (§10.3)
// ─────────────────────────────────────────────────────────────────────

export type PermitStatus = 'active' | 'revoked' | 'expired';

export interface PermitRow {
  permit_id: string;
  name: string;
  issued_by: string;
  scope: string | null;
  valid_until: Date | null;
  verification_method: string;
  status: PermitStatus;
  created_by: UUID;
  created_at: Date;
  updated_at: Date;
}

export interface Permit {
  permitId: string;
  name: string;
  issuedBy: string;
  scope: string | null;
  validUntil: ISODateTime | null;
  verificationMethod: string;
  status: PermitStatus;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ParticipantPermitRow {
  id: UUID;
  participant_id: UUID;
  permit_id: string;
  issued_at: Date;
  valid_until: Date | null;
  verification_data: Record<string, unknown>;
  status: PermitStatus;
  issued_by: UUID;
  revoked_at: Date | null;
  revoked_by: UUID | null;
  revoke_reason: string | null;
  created_at: Date;
}

export interface ParticipantPermit {
  id: UUID;
  participantId: UUID;
  permitId: string;
  issuedAt: ISODateTime;
  validUntil: ISODateTime | null;
  verificationData: Record<string, unknown>;
  status: PermitStatus;
  issuedBy: UUID;
  revokedAt: ISODateTime | null;
  revokedBy: UUID | null;
  revokeReason: string | null;
  createdAt: ISODateTime;
  /** Эффективная дата истечения: min(participant_permits.valid_until, permits.valid_until). */
  effectiveValidUntil: ISODateTime | null;
  /** Вычисляется при чтении: true, если effectiveValidUntil < now(). */
  isExpired: boolean;
}

export interface CreatePermitInput {
  permitId: string;
  name: string;
  issuedBy: string;
  scope?: string | null;
  validUntil?: string | null;
  verificationMethod: string;
}

export interface IssuePermitInput {
  participantId: UUID;
  permitId: string;
  validUntil?: string | null;
  verificationData?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3b — mentor_questions (A28, A40, A41)
// ─────────────────────────────────────────────────────────────────────

export type MentorQuestionStatus = 'open' | 'answered' | 'escalated' | 'closed';

export interface MentorQuestionRow {
  id: UUID;
  participant_id: UUID;
  mentor_id: UUID | null;
  atom_id: string | null;
  cell_id: UUID | null;
  task_id: UUID | null;
  channel_id: string | null;
  question: string;
  answer: string | null;
  status: MentorQuestionStatus;
  sla_hours: number;
  created_at: Date;
  updated_at: Date;
  first_response_at: Date | null;
  answered_at: Date | null;
  escalated_at: Date | null;
}

export interface MentorQuestion {
  id: UUID;
  participantId: UUID;
  mentorId: UUID | null;
  atomId: string | null;
  question: string;
  answer: string | null;
  status: MentorQuestionStatus;
  slaHours: number;
  createdAt: ISODateTime;
  answeredAt: ISODateTime | null;
  firstResponseAt: ISODateTime | null;
}

export interface CreateMentorQuestionInput {
  question: string;
  atomId?: string;
  mentorId?: UUID;
  taskId?: UUID;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3c — TeamCapability (§11.4)
// ─────────────────────────────────────────────────────────────────────

export type TeamCapabilityStatus =
  | 'draft'
  | 'active'
  | 'assessed'
  | 'deprecated';

export interface TeamCapabilityRow {
  id: UUID;
  name: string;
  expected_result: string;
  participants: UUID[];
  criteria: Record<string, Record<string, unknown>>;
  assessor_id: UUID | null;
  status: TeamCapabilityStatus;
  created_by: UUID;
  created_at: Date;
  updated_at: Date;
}

export interface TeamCapability {
  id: UUID;
  name: string;
  expectedResult: string;
  participants: UUID[];
  criteria: Record<string, Record<string, unknown>>;
  assessorId: UUID | null;
  status: TeamCapabilityStatus;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TeamCapabilityAssessmentRow {
  id: UUID;
  team_id: UUID;
  level: number;
  criteria_scores: Record<string, number>;
  context: Record<string, unknown>;
  assessor_id: UUID;
  assessed_at: Date;
}

export interface TeamCapabilityAssessment {
  id: UUID;
  teamId: UUID;
  level: number;
  criteriaScores: Record<string, number>;
  context: Record<string, unknown>;
  assessorId: UUID;
  assessedAt: ISODateTime;
}

export interface CreateTeamInput {
  name: string;
  expectedResult: string;
  participants: UUID[];
  criteria?: Record<string, Record<string, unknown>>;
}

export interface AssessTeamInput {
  teamId: UUID;
  level: number;                       // 0..9
  criteriaScores: Record<string, number>; // ключи ⊆ criteria, значения 0..9
  context?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3d — Калибровка 0–9 (инфраструктура, §6.5)
// ─────────────────────────────────────────────────────────────────────

export type CalibrationSessionStatus = 'draft' | 'open' | 'closed';

export interface AnchorExampleRow {
  id: UUID;
  atom_id: string;
  dimension: Dimension;
  level: number;
  title: string;
  description: string | null;
  content: Record<string, unknown>;
  version: number;
  created_by: UUID;
  created_at: Date;
}

export interface AnchorExample {
  id: UUID;
  atomId: string;
  dimension: Dimension;
  level: number;
  title: string;
  description: string | null;
  content: Record<string, unknown>;
  version: number;
  createdBy: UUID;
  createdAt: ISODateTime;
}

export interface CalibrationSessionRow {
  id: UUID;
  atom_id: string;
  dimension: Dimension;
  status: CalibrationSessionStatus;
  created_by: UUID;
  deadline: Date | null;
  created_at: Date;
  closed_at: Date | null;
}

export interface CalibrationSession {
  id: UUID;
  atomId: string;
  dimension: Dimension;
  status: CalibrationSessionStatus;
  createdBy: UUID;
  deadline: ISODateTime | null;
  createdAt: ISODateTime;
  closedAt: ISODateTime | null;
}

export interface CalibrationAssignmentRow {
  id: UUID;
  session_id: UUID;
  anchor_example_id: UUID;
  assessor_id: UUID;
  level: number | null;
  note: string | null;
  created_at: Date;
  scored_at: Date | null;
}

export interface CalibrationAssignment {
  id: UUID;
  sessionId: UUID;
  anchorExampleId: UUID;
  assessorId: UUID;
  level: number | null;
  note: string | null;
  createdAt: ISODateTime;
  scoredAt: ISODateTime | null;
}

export interface CreateAnchorInput {
  atomId: string;
  dimension: Dimension;
  level: number;
  title: string;
  description?: string | null;
  content?: Record<string, unknown>;
}

export interface CreateSessionInput {
  atomId: string;
  dimension: Dimension;
  deadline?: string | null;
}

export interface CreateAssignmentInput {
  sessionId: UUID;
  anchorExampleId: UUID;
  assessorId: UUID;
}

// Report DTO (не таблица)
export interface CalibrationWorkReport {
  anchorExampleId: UUID;
  title: string;
  expectedLevel: number;
  scores: Array<{
    assignmentId: UUID;
    assessorId: UUID;
    level: number | null;
    note: string | null;
    scoredAt: ISODateTime | null;
  }>;
  /** max − min среди непустых level. null, если оценок < 2. */
  maxDiff: number | null;
  /** ≥ 2 → нужен третий оценщик (§6.5 п.3). */
  needsThird: boolean;
}

export interface CalibrationReport {
  session: CalibrationSession;
  works: CalibrationWorkReport[];
  summary: {
    worksCount: number;
    scoredCount: number;
    unscoredCount: number;
    flaggedCount: number;
    overdue: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Утилиты (используются projection.ts / visibility.ts)
// ─────────────────────────────────────────────────────────────────────

/** Уровень по измерению. null = нет оценки (≠ 0). */
export function isValidLevel(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9;
}

/** Применимо ли измерение к атому (см. dimension_applicability). */
export function isDimensionApplicable(
  a: DimensionApplicability,
  d: Dimension,
): boolean {
  const entry = a[d];
  return entry?.applicable === true;
}

/**
 * Ширина атома (паспорт 6.6): level>=4 по всем применимым измерениям
 * и assessment.status === 'confirmed'. Применимость берётся из карточки атома.
 *
 * NB: допускаем not_applicable-измерения — они не участвуют. Если
 * применимых измерений нет вовсе — атом не засчитывается (нечего покрывать).
 */
export function atomCountsForWidth(
  states: PersonAtomStateRow[],
  applicability: DimensionApplicability,
): boolean {
  const applicable = DIMENSIONS.filter((d) => isDimensionApplicable(applicability, d));
  if (applicable.length === 0) {return false;}
  for (const d of applicable) {
    const s = states.find((x) => x.dimension === d);
    if (!s || s.status !== 'confirmed' || s.level === null || s.level < 4) {return false;}
  }
  return true;
}

/** depth_execution: P >= 7 и P applicable. */
export function atomCountsForDepthExecution(
  states: PersonAtomStateRow[],
  applicability: DimensionApplicability,
): boolean {
  if (!isDimensionApplicable(applicability, 'P')) {return false;}
  const s = states.find((x) => x.dimension === 'P');
  return !!s && s.status === 'confirmed' && s.level !== null && s.level >= 7;
}

/** depth_understanding: U,X,D,E >= 7 (только применимые). */
export function atomCountsForDepthUnderstanding(
  states: PersonAtomStateRow[],
  applicability: DimensionApplicability,
): boolean {
  const required: Dimension[] = ['U', 'X', 'D', 'E'];
  const applicable = required.filter((d) => isDimensionApplicable(applicability, d));
  if (applicable.length === 0) {return false;}
  for (const d of applicable) {
    const s = states.find((x) => x.dimension === d);
    if (!s || s.status !== 'confirmed' || s.level === null || s.level < 7) {return false;}
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Фаза 3d — Граф паспорта (§8.4)
// ─────────────────────────────────────────────────────────────────────

export interface GraphNodeDimension {
  dimension: Dimension;
  level: number | null;
  status: PersonAtomStatus;
}

export interface GraphNode {
  atomId: string;
  name: string;
  cluster: AtomCluster;
  dimensions: GraphNodeDimension[];
  directions: AtomDirections;
  isWidth: boolean;
  isDepthExecution: boolean;
  isDepthUnderstanding: boolean;
  isDepthFull: boolean;
}

export interface GraphEdge {
  fromAtomId: string;
  toAtomId: string;
  relationType: RelationType;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    totalNodes: number;
    totalEdges: number;
    filter: {
      cluster: string | null;
      direction: number | null;
      status: 'all' | 'assessed' | 'not_assessed';
    };
  };
}

// ─────────────────────────────────────────────────────────────────────
// Каталог v0.4 — workflow предложений (§16.1)
// ─────────────────────────────────────────────────────────────────────

export type CatalogProposalType =
  | 'new_atom'
  | 'update_atom'
  | 'deprecate_atom';

export type CatalogProposalStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'merged';

export interface CatalogProposalRow {
  id: UUID;
  proposal_type: CatalogProposalType;
  atom_id: string | null;
  payload: Record<string, unknown>;
  status: CatalogProposalStatus;
  reason: string | null;
  review_note: string | null;
  created_by: UUID;
  reviewed_by: UUID | null;
  merged_by: UUID | null;
  created_at: Date;
  updated_at: Date;
  merged_at: Date | null;
}

export interface CatalogProposal {
  id: UUID;
  proposalType: CatalogProposalType;
  atomId: string | null;
  payload: Record<string, unknown>;
  status: CatalogProposalStatus;
  reason: string | null;
  reviewNote: string | null;
  createdBy: UUID;
  reviewedBy: UUID | null;
  mergedBy: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  mergedAt: ISODateTime | null;
}