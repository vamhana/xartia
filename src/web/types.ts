// |F.4.99.23|Frontend|Types|TypeScript|src/web/types.ts

export type UUID = string;
export type ISODateTime = string;

export interface Participant {
  id: UUID;
  externalId: string;
  name: string;
  pseudonym: string | null;
  directionId: UUID;
  status: string;
  isFirstArchitect: boolean;
}

export interface DirectionBrief {
  id: UUID;
  number: number;
  name: string;
}

export interface ProfessionBrief {
  id: UUID;
  name: string;
}

export interface RoleAssignmentBrief {
  name: string;
  directionId: UUID | null;
  validTo: ISODateTime | null;
}

export interface PassportFull {
  id: UUID;
  externalId: string;
  name: string;
  pseudonym: string | null;
  phone: string;
  messengers: Record<string, string>;
  directionId: UUID;
  subdirection: string | null;
  professionId: UUID | null;
  status: string;
  profileRisk: string;
  mentorId: UUID | null;
  cellId: UUID | null;
  geolocation: { lat: number; lon: number } | null;
  geoEnabled: boolean;
  enteredAt: ISODateTime;
  welcomePackGiven: boolean;
  isFirstArchitect: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  direction: DirectionBrief | null;
  profession: ProfessionBrief | null;
  roles: RoleAssignmentBrief[];
  mentorExternalId: string | null;
}

export interface Task {
  id: UUID;
  externalId: string;
  planId: UUID | null;
  directionId: UUID;
  description: string;
  requiredCompetencies: string[];
  location: { lat: number; lon: number } | null;
  priority: 'critical' | 'high' | 'standard' | 'background';
  status: 'created' | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'returned';
  assignedTo: UUID | null;
  assignedBy: UUID | null;
  deadline: ISODateTime | null;
  parentTaskId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  // Relations (C.0.07.02)
  planTitle: string | null;
  planExpectedResult: string | null;
  assignerName: string | null;
  assignerExternalId: string | null;
  inDailyPlan: boolean;
  // Возврат из ОТК
  returnReason: string | null;
  returnedAt: ISODateTime | null;
}

export interface DailyPlanTaskItem {
  id: UUID;
  externalId: string;
  description: string;
  priority: 'critical' | 'high' | 'standard' | 'background';
  status: 'created' | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'returned';
  assignedTo: UUID | null;
  deadline: ISODateTime | null;
  position: number;
}

export interface DailyPlan {
  id: UUID;
  directionId: UUID;
  date: string;
  status: 'draft' | 'approved' | 'in_progress' | 'completed';
  approvedBy: UUID | null;
  createdAt: ISODateTime;
  tasks: DailyPlanTaskItem[];
}


// -------- Signals --------

export type SignalPriority = 'critical' | 'high' | 'standard' | 'background';
export type SignalType = 'need' | 'problem' | 'idea' | 'failure';
export type SignalStatus = 'new' | 'run' | 'connect' | 'plan' | 'completed' | 'rejected';
export type SignalResponseType = 'support' | 'object' | 'clarify' | 'amend' | 'no_influence';

export interface Signal {
  id: UUID;
  externalId: string;
  initiatorId: UUID;
  type: SignalType;
  description: string;
  justification: string;
  directions: UUID[];
  desiredDeadline: ISODateTime | null;
  priority: SignalPriority;
  status: SignalStatus;
  iterations: number;
  leadDirectionId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** План, выросший из сигнала (если уже создан), с прогрессом по задачам. */
  plan?: SignalPlanSummary | null;
}

export interface SignalPlanSummary {
  id: UUID;
  externalId: string;
  title: string;
  status: string;
  curatorId: UUID | null;
  progress: { total: number; done: number; inWork: number } | null;
}

export interface SignalResponse {
  id: UUID;
  signalId: UUID;
  directionId: UUID;
  response: SignalResponseType;
  justification: string;
  data: Record<string, unknown> | null;
  consequences: string | null;
  needs: string | null;
  createdAt: ISODateTime;
}

// -------- Psy --------

export type PsySessionType = 'onboarding' | 'crisis' | 'discharge' | 'resonance';
export type PsySessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface PsySession {
  id: UUID;
  participantId: UUID;
  psychologistId: UUID;
  type: PsySessionType;
  notes: string | null;
  status: PsySessionStatus;
  scheduledAt: ISODateTime;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface PsyObserver {
  id: UUID;
  participantId: UUID;
  directionId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface PsyCrisis {
  id: UUID;
  participantId: UUID;
  status: 'open' | 'in_progress' | 'closed';
  notes: string | null;
  createdAt: ISODateTime;
  closedAt: ISODateTime | null;
}

export interface PsyDischarge {
  id: UUID;
  participantId: UUID;
  days: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  createdAt: ISODateTime;
  completedAt: ISODateTime | null;
}

 export interface MoodMetric {
   id: UUID;
   directionId: UUID;
   metric: string;
   value: number;
   period: string;
   hasData: boolean;
   createdAt: ISODateTime;
 }

export interface Wellbeing {
  id: UUID;
  participantId: UUID;
  score: number;
  trend: 'up' | 'stable' | 'down';
  createdAt: ISODateTime;
}

export interface Hygiene {
  id: UUID;
  directionId: UUID;
  measure: string;
  status: 'proposed' | 'applied';
  createdAt: ISODateTime;
  appliedAt: ISODateTime | null;
}

// -------- Automation --------

export type AiRecommendation = 'approve' | 'reject';

export type AutomationDecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deferred';

export type OperatorAuditStatus = 'ok' | 'audit_required' | 'removed';

export interface AutomationDecision {
  id: UUID;
  type: string;
  content: Record<string, unknown>;
  aiRecommendation: AiRecommendation;
  deadline: ISODateTime;
  status: AutomationDecisionStatus;
  rejectionReason: string | null;
  decidedBy: UUID | null;
  decidedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface AutomationSection {
  id: UUID;
  directionId: UUID;
  enabled: boolean;
  operatorId: UUID | null;
  disabledAt: ISODateTime | null;
  disableReason: string | null;
  createdAt: ISODateTime;
}

export interface OperatorAudit {
  id: UUID;
  operatorId: UUID;
  approvalRate: number;
  errorCount: number;
  status: OperatorAuditStatus;
  recommendations: string[];
  createdAt: ISODateTime;
}

// -------- Quanta --------

export type QuantumStatus =
  | 'detected' | 'audit' | 'testing' | 'scaling' | 'active' | 'cancelled';

export type QuantumTestResult = 'success' | 'failure';

export interface Quantum {
  id: UUID;
  level: number;
  type: string;
  sourceCellId: UUID;
  description: string;
  areaOfApplicability: Record<string, unknown>;
  limitations: Record<string, unknown>;
  successCriteria: Record<string, unknown>;
  stopCriteria: Record<string, unknown>;
  status: QuantumStatus;
  mandatory: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface QuantumTest {
  id: UUID;
  quantumId: UUID;
  cellId: UUID;
  result: QuantumTestResult;
  notes: string | null;
  createdAt: ISODateTime;
}

export interface QuantumCatalogEntry {
  quantumId: UUID;
  communityId: UUID;
  applied: boolean;
  appliedAt: ISODateTime | null;
}

export interface QuantumDetectCandidate {
  cellId: UUID;
  advantage: number;
}

// -------- Convergence --------

export type ConvergenceStatus =
  | 'draft'
  | 'declared'
  | 'in_progress'
  | 'completed'
  | 'failed';

export type DebtType = 'external' | 'internal';
export type DebtAction = 'annul' | 'convert';
export type WeaponAction = 'utilize' | 'reserve' | 'energy';
export type CulturalCenterStatus = 'planned' | 'open' | 'closed';

export interface ConvergencePlan {
  id: UUID;
  stateName: string;
  stage: number; // 0..5
  status: ConvergenceStatus;
  coordinatorId: UUID | null;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface ConvergenceCouncil {
  id: UUID;
  planId: UUID;
  members: Array<Record<string, unknown>>;
}

export interface DebtConversion {
  id: UUID;
  planId: UUID;
  type: DebtType;
  amount: number;
  action: DebtAction;
  coefficient: number | null;
  createdAt: ISODateTime;
}

export interface AssetConversion {
  id: UUID;
  planId: UUID;
  assetType: string;
  value: number;
  destinationDirectionId: UUID;
  createdAt: ISODateTime;
}

export interface WeaponConversion {
  id: UUID;
  planId: UUID;
  weaponType: string;
  action: WeaponAction;
  verifiedBy: UUID | null;
  createdAt: ISODateTime;
}

export interface CulturalCenter {
  id: UUID;
  planId: UUID;
  location: { lat: number; lon: number };
  status: CulturalCenterStatus;
  createdAt: ISODateTime;
}

// -------- Experiments --------

export type ExperimentStatus =
  | 'filed'
  | 'approved'
  | 'active'
  | 'completed'
  | 'cancelled';

export type DissidentResourceSource = 'deferred_flow' | 'freedom_reserve';

export type DissidentStatus =
  | 'filed'
  | 'active'
  | 'suspended'
  | 'reviewed'
  | 'closed';

export interface Experiment {
  id: UUID;
  externalId: string;
  goal: string;
  termDays: number;
  participants: UUID[];
  criteria: Record<string, unknown>;
  status: ExperimentStatus;
  approvedBy: UUID | null;
  createdAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface ExperimentResults {
  id: UUID;
  protocolId: UUID;
  successes: string[];
  failures: string[];
  stats: Record<string, unknown>;
  published: boolean;
  createdAt: ISODateTime;
}

export interface DissidentProject {
  id: UUID;
  initiatorId: UUID;
  description: string;
  petitionCount: number;
  requiredPercent: number;
  resourceSource: DissidentResourceSource;
  status: DissidentStatus;
  reportIntervalDays: number;
  lastReportAt: ISODateTime | null;
  closedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface ApproveExperimentResult {
  experiment: Experiment;
  progress: {
    responded: number;
    total: number;
    percent: number;
    approvalRunId: UUID | null;
  };
}

// -------- Search (A.1.95.01 / F.4.99.16) --------

export type SearchType = 'participant' | 'signal' | 'good' | 'archive' | 'task';

export interface SearchResult {
  type: SearchType;
  id: UUID;
  title: string;
  snippet: string; // может содержать <mark>...</mark>
  url: string;
  relevance: number;
}

export interface SearchOptions {
  types?: SearchType[];
  directionId?: UUID;
  page?: number;
  perPage?: number;
}

/**
 * ParticipantStatus — дублируем union из backend C.0.01.04,
 * чтобы фронт мог типизировать ответ /search/participants.
 * Используется только в ParticipantBrief (Search), не в Participant (общий).
 */
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

export interface ParticipantBrief {
  id: UUID;
  name: string;
  externalId: string;
  directionId: UUID;
  directionName: string | null;
  status: ParticipantStatus;
}

// ─── Passport (профессиональный) ─────────────────────────────────────
// Старый PassportFull выше — не меняется.
// Новые типы соответствуют src/core/passport/types.ts (DTO camelCase).

export type PassportDimension = 'U' | 'X' | 'D' | 'P' | 'E';

export type PassportAtomStatus =
  | 'candidate' | 'draft' | 'in_review' | 'approved' | 'deprecated';

export type PassportPersonStatus =
  | 'not_assessed' | 'declared' | 'confirmed' | 'disputed'
  | 'under_review' | 'not_applicable' | 'calibration_pending';

export type PassportVisibilityLevel = 'private' | 'summary' | 'levels' | 'full';
export type PassportVisibilityScope = 'public' | 'mentor' | 'assessor' | 'task';

export interface PassportDimensionState {
  dimension: PassportDimension;
  level: number | null;
  status: PassportPersonStatus;
  updatedAt: ISODateTime;
}

export interface PassportCounts {
  notAssessed: number;
  declared: number;
  confirmed: number;
  inProgress: number;
  calibrationPending: number;
  underReview: number;
  disputed: number;
  notApplicable: number;
}

export interface PassportClusterAggregate {
  cluster: string;
  width: number;
  depthExecution: number;
  depthUnderstanding: number;
  depthFull: number;
  counts: PassportCounts;
}

export interface PassportGoal {
  id: UUID;
  goal: string;
  targetProfileId: UUID | null;
  targetProfileSlug: string | null;
  missingAtoms: Array<{
    atomId: string;
    atomName: string;
    missingDimensions: PassportDimension[];
    alternativeAtomIds: string[];
  }>;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: ISODateTime;
}

export interface PassportOverview {
  participantId: UUID;
  visibility: PassportVisibilityLevel;
  width: number;
  depthExecution: number;
  depthUnderstanding: number;
  depthFull: number;
  byCluster: PassportClusterAggregate[];
  counts: PassportCounts;
  calibrationPendingAtoms: number;
  goals: PassportGoal[];
  staleAssessments: PassportStaleAssessment[];
  updatedAt: ISODateTime;
  audit_id?: string;
}

export interface PassportCatalogItem {
  atomId: string;
  cluster: string;
  name: string;
  definition: string;
  status: PassportAtomStatus;
  version: string;
}

export interface PassportRelationItem {
  fromAtomId: string;
  toAtomId: string;
  relationType: string;
  note: string | null;
}

export interface PassportStaleAssessment {
  atomId: string;
  dimension: PassportDimension;
  assessorId: UUID;
  assessedAt: ISODateTime;
  staleSince: ISODateTime;
  policy: string;
}

export interface PassportEvidenceItem {
  id: UUID;
  atomId: string;
  dimension: PassportDimension;
  evidenceType: string;
  description: string;
  artifactUrl: string | null;
  context: Record<string, unknown>;
  status: string;
  createdAt: ISODateTime;
  /** Источник при reuse (A18); null для обычных. */
  reusedFromEvidenceId?: UUID | null;
}

export interface PassportAssessmentItem {
  id: UUID;
  atomId: string;
  dimension: PassportDimension;
  level: number | null;
  method: string;
  assessorId: UUID;
  context: Record<string, unknown>;
  status: string;
  createdAt: ISODateTime;
  isCurrent: boolean;
  criteriaVersion: string | null;
}

export interface PassportHistoryItem {
  id: UUID;
  atomId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  actorId: UUID | null;
  createdAt: ISODateTime;
}

export interface PassportAtomCard {
  atom: {
    atom_id: string;
    cluster: string;
    name: string;
    definition: string;
    boundary_includes: string[];
    boundary_excludes: string[];
    assessment_criteria: Record<string, string>;
    assessment_methods: string[];
    dimension_applicability: Partial<Record<PassportDimension, { applicable: boolean; name?: string }>>;
    status: PassportAtomStatus;
    version: string;
  };
  relations: PassportRelationItem[];
  dimensions: PassportDimensionState[];
  evidence: PassportEvidenceItem[];
  assessments: PassportAssessmentItem[];
  history: PassportHistoryItem[];
  directions: PassportAtomDirections;
}

export interface PassportVisibilityState {
  scope: PassportVisibilityScope;
  visibility: PassportVisibilityLevel;
  consent: boolean;
  updatedAt: ISODateTime;
}

export interface PassportAccessLogItem {
  id: UUID;
  viewerId: UUID | null;
  scope: string;
  reason: string | null;
  createdAt: ISODateTime;
}

// ─── Направления Хартии (§14, Фаза 3a) ──────────────────────────────

export interface PassportDirectionRef {
  id: UUID;
  number: number;
  name: string;
  type: 'permanent' | 'temporary';
  status: string;
}

export type PassportAtomDirectionRole = 'home' | 'main' | 'related';

export interface PassportAtomDirection {
  directionId: UUID;
  directionNumber: number;
  directionName: string;
  role: PassportAtomDirectionRole;
  note: string | null;
}

export interface PassportAtomDirections {
  home: PassportAtomDirection | null;
  main: PassportAtomDirection | null;
  related: PassportAtomDirection[];
}

// ─── TaskProfile (Фаза 3a, §11.1) ────────────────────────────────────

export type PassportTaskProfileRole =
  | 'executor'
  | 'designer'
  | 'consultant'
  | 'assessor';

export type PassportTaskProfileStatus = 'draft' | 'active' | 'deprecated';

export interface PassportRequiredAtom {
  atom_id: string;
  min: Partial<Record<PassportDimension, number>>;
  role: PassportTaskProfileRole;
}

export interface PassportTaskProfile {
  id: UUID;
  taskId: UUID;
  requiredAtoms: PassportRequiredAtom[];
  permitIds: string[];
  acceptanceCriteria: Record<string, unknown> | null;
  evidenceForm: Record<string, unknown> | null;
  securityConstraints: Record<string, unknown> | null;
  version: number;
  status: PassportTaskProfileStatus;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ─── Matching (Фаза 3a, §11.2) ───────────────────────────────────────

export type PassportMatchStatus = 'match' | 'partial' | 'no_match';

export interface PassportMatchGap {
  atomId: string | null;
  permitId?: string;
  role: PassportTaskProfileRole;
  missingDimensions: PassportDimension[];
  critical: boolean;
  reason: 'missing_dimensions' | 'missing_permit';
  permitStatus?: 'absent' | 'expired' | 'revoked';
}

export interface PassportTaskMatching {
  taskId: UUID;
  participantId: UUID;
  status: PassportMatchStatus;
  gaps: PassportMatchGap[];
  checkedCount: number;
  coverage: number;
}

export interface PassportTaskCandidate {
  participantId: UUID;
  participantExternalId: string;
  participantName: string;
  matches: number;
  gaps: number;
  status: PassportMatchStatus;
}

// ─── Permit (Фаза 3b, §10.3) ─────────────────────────────────────────

export type PassportPermitStatus = 'active' | 'revoked' | 'expired';

export interface PassportPermit {
  permitId: string;
  name: string;
  issuedBy: string;
  scope: string | null;
  validUntil: ISODateTime | null;
  verificationMethod: string;
  status: PassportPermitStatus;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PassportParticipantPermit {
  id: UUID;
  participantId: UUID;
  permitId: string;
  issuedAt: ISODateTime;
  validUntil: ISODateTime | null;
  verificationData: Record<string, unknown>;
  status: PassportPermitStatus;
  issuedBy: UUID;
  revokedAt: ISODateTime | null;
  revokedBy: UUID | null;
  revokeReason: string | null;
  createdAt: ISODateTime;
  effectiveValidUntil: ISODateTime | null;
  isExpired: boolean;
}

// ─── mentor_questions (Фаза 3b, A28) ─────────────────────────────────

export type PassportMentorQuestionStatus =
  | 'open'
  | 'answered'
  | 'escalated'
  | 'closed';

export interface PassportMentorQuestion {
  id: UUID;
  participantId: UUID;
  mentorId: UUID | null;
  atomId: string | null;
  question: string;
  answer: string | null;
  status: PassportMentorQuestionStatus;
  slaHours: number;
  createdAt: ISODateTime;
  answeredAt: ISODateTime | null;
  firstResponseAt: ISODateTime | null;
}

// ─── TeamCapability (Фаза 3c, §11.4) ─────────────────────────────────

export type PassportTeamCapabilityStatus =
  | 'draft'
  | 'active'
  | 'assessed'
  | 'deprecated';

export interface PassportTeamCapability {
  id: UUID;
  name: string;
  expectedResult: string;
  participants: UUID[];
  criteria: Record<string, Record<string, unknown>>;
  assessorId: UUID | null;
  status: PassportTeamCapabilityStatus;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PassportTeamCapabilityAssessment {
  id: UUID;
  teamId: UUID;
  level: number;
  criteriaScores: Record<string, number>;
  context: Record<string, unknown>;
  assessorId: UUID;
  assessedAt: ISODateTime;
}

// ─── Каталог v0.4 — workflow предложений (§16.1) ────────────────────

export type PassportCatalogProposalType =
  | 'new_atom'
  | 'update_atom'
  | 'deprecate_atom';

export type PassportCatalogProposalStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'merged';

export interface PassportCatalogProposal {
  id: UUID;
  proposalType: PassportCatalogProposalType;
  atomId: string | null;
  payload: Record<string, unknown>;
  status: PassportCatalogProposalStatus;
  reason: string | null;
  reviewNote: string | null;
  createdBy: UUID;
  reviewedBy: UUID | null;
  mergedBy: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  mergedAt: ISODateTime | null;
}

// ─── TeachingRelation (Фаза 3a, §12) ─────────────────────────────────

export type PassportReadinessState = 'ready' | 'not_ready' | 'unknown';

export interface PassportReadinessSignal {
  dimension: PassportDimension;
  level: number | null;
  required: number;
  ok: boolean;
}

export interface PassportReadinessResult {
  mentorId: UUID;
  atomId: string;
  state: PassportReadinessState;
  score: number;
  signals: PassportReadinessSignal[];
  reason?: string;
}

export interface PassportTeachingRelation {
  id: UUID;
  mentorId: UUID;
  menteeId: UUID;
  atomId: string;
  dimensions: PassportDimension[];
  status: 'active' | 'revoked' | 'expired';
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
  reason: string | null;
  createdBy: UUID;
  createdAt: ISODateTime;
}

export interface PassportMentorCandidate {
  mentorId: UUID;
  mentorExternalId: string;
  mentorName: string;
  readiness: PassportReadinessResult;
}

export interface PassportTeachingStudentItem {
  relationId: UUID;
  menteeId: UUID;
  menteeExternalId: string;
  menteeName: string;
  atomId: string;
  atomName: string;
  dimensions: PassportDimension[];
  createdAt: ISODateTime;
}

export interface PassportTeachingMentorItem {
  relationId: UUID | null;
  mentorId: UUID;
  mentorExternalId: string | null;
  mentorName: string | null;
  atomId: string | null;
  atomName: string | null;
  dimensions: PassportDimension[] | null;
  source: 'primary' | 'per_atom';
  createdAt: ISODateTime | null;
}

// ─── Калибровка 0–9 (Фаза 3d, §6.5) ─────────────────────────────────

export type PassportCalibrationSessionStatus = 'draft' | 'open' | 'closed';

export interface PassportAnchorExample {
  id: UUID;
  atomId: string;
  dimension: PassportDimension;
  level: number;
  title: string;
  description: string | null;
  content: Record<string, unknown>;
  version: number;
  createdBy: UUID;
  createdAt: ISODateTime;
}

export interface PassportCalibrationSession {
  id: UUID;
  atomId: string;
  dimension: PassportDimension;
  status: PassportCalibrationSessionStatus;
  createdBy: UUID;
  deadline: ISODateTime | null;
  createdAt: ISODateTime;
  closedAt: ISODateTime | null;
}

export interface PassportCalibrationAssignment {
  id: UUID;
  sessionId: UUID;
  anchorExampleId: UUID;
  assessorId: UUID;
  level: number | null;
  note: string | null;
  createdAt: ISODateTime;
  scoredAt: ISODateTime | null;
}

export interface PassportCalibrationWorkReport {
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
  maxDiff: number | null;
  needsThird: boolean;
}

export interface PassportCalibrationReport {
  session: PassportCalibrationSession;
  works: PassportCalibrationWorkReport[];
  summary: {
    worksCount: number;
    scoredCount: number;
    unscoredCount: number;
    flaggedCount: number;
    overdue: boolean;
  };
}

export interface PassportParticipantBrief {
  id: UUID;
  externalId: string;
  name: string;
  status: string;
}

// ─── Граф паспорта (Фаза 3d, §8.4) ──────────────────────────────────

export interface PassportGraphNodeDimension {
  dimension: PassportDimension;
  level: number | null;
  status: PassportPersonStatus;
}

export interface PassportGraphNode {
  atomId: string;
  name: string;
  cluster: string;
  dimensions: PassportGraphNodeDimension[];
  directions: PassportAtomDirections;
  isWidth: boolean;
  isDepthExecution: boolean;
  isDepthUnderstanding: boolean;
  isDepthFull: boolean;
}

export interface PassportGraphEdge {
  fromAtomId: string;
  toAtomId: string;
  relationType: string;
}

export interface PassportGraphPayload {
  nodes: PassportGraphNode[];
  edges: PassportGraphEdge[];
  meta: {
    totalNodes: number;
    totalEdges: number;
    filter: {
      cluster: string | null;
      direction: number | null;
      status: 'all' | 'assessed' | 'not_assessed';
    };
  };
  audit_id?: string;
}