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