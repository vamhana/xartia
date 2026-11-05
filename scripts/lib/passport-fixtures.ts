// I.9.09.10 — Общие фикстуры для test-passport-v2 и test-passport-v3.
// Только HTTP, кроме createSmokeTask (см. ниже).

import 'dotenv/config';

import { query } from '../../src/lib/db.js';

export const BASE = process.env['API_URL'] ?? 'http://127.0.0.1:3000';

export interface Res<T = unknown> {
  status: number;
  data: T;
}

export async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  base: string = BASE,
): Promise<Res<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

export async function login(
  phone: string,
  password: string,
  base: string = BASE,
): Promise<{ token: string; id: string }> {
  const r = await request<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password }, undefined, base,
  );
  if (r.status !== 200 || !r.data?.access_token) {
    throw new Error(`login ${phone} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return { token: r.data.access_token, id: r.data.participant.id };
}

export function uniquePhone(): string {
  const ts = String(Date.now()).slice(-7);
  const rand = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return `+7999${ts}${rand}`;
}

// ─────────────────────────────────────────────────────────────────────
// ensureActor: register + admin/accept, идемпотентно-аддитивно (создаёт
// нового участника). Требует admin-токен (FIRST_ARCHITECT).
// ─────────────────────────────────────────────────────────────────────

export interface Actor {
  id: string;
  token: string;
  phone: string;
  password: string;
}

export interface EnsureActorOpts {
  name?: string;
  role?: 'VERIFIER' | 'OTC' | 'COUNCIL_MEMBER' | 'FIRST_ARCHITECT';
}

export async function ensureActor(
  adminToken: string,
  opts: EnsureActorOpts = {},
  base: string = BASE,
): Promise<Actor> {
  const dirs = await request<{ data: Array<{ id: string }> }>(
    'GET', '/directions', undefined, adminToken, base,
  );
  const dirId = dirs.data?.data?.[0]?.id;
  if (!dirId) throw new Error('ensureActor: no active direction');

  const errors: string[] = [];
  for (let i = 0; i < 3; i++) {
    const phone = uniquePhone();
    const password = 'SmokePass12345';

    const reg = await request<{ request_id?: string }>(
      'POST', '/auth/register',
      {
        phone,
        messengers: { telegram: `@smoke${Date.now()}${i}` },
        password,
        consent_video: true,
        consent_data: true,
      },
      undefined, base,
    );
    if (reg.status !== 200 && reg.status !== 201) {
      errors.push(`register → ${reg.status}`);
      continue;
    }
    const requestId = reg.data?.request_id;
    if (!requestId) { errors.push('register: no request_id'); continue; }

    const accept = await request<{ temporary_password?: string }>(
      'POST', `/admin/registration-requests/${requestId}/accept`,
      {
        name: opts.name ?? 'Smoke Actor',
        direction_id: dirId,
        ...(opts.role ? { role: opts.role } : {}),
      },
      adminToken, base,
    );
    if (accept.status !== 200 && accept.status !== 201) {
      errors.push(`accept → ${accept.status}`);
      continue;
    }
    const tempPass = accept.data?.temporary_password;
    if (!tempPass) { errors.push('accept: no temporary_password'); continue; }

    try {
      const l = await login(phone, tempPass, base);
      return { ...l, phone, password: tempPass };
    } catch (e) {
      errors.push(`login(tempPass) → ${String(e).slice(0, 120)}`);
    }
  }
  throw new Error(`ensureActor failed: ${errors.join('; ')}`);
}

// ─────────────────────────────────────────────────────────────────────
// Наставник (A13): participants.mentor_id через admin PATCH
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// Наставник (A13): participants.mentor_id.
//
// NB: PATCH /admin/participants/:id {mentor_id} валидирует UUID, но
// НЕ применяет изменение для mentor'а без MENTOR-роли / full-статуса
// (assignMentorService в admin/controller.ts). Это чужой домен, вне
// Фазы 2; для тестовой фикстуры прямой UPDATE надёжнее. Если handler
// починят — вернуть HTTP-вариант.
// ─────────────────────────────────────────────────────────────────────

export async function setMentor(
  _adminToken: string,
  subjectId: string,
  mentorId: string | null,
  _base: string = BASE,
): Promise<void> {
  await query(
    `UPDATE participants SET mentor_id = $1, updated_at = now()
      WHERE id = $2 AND deleted_at IS NULL`,
    [mentorId, subjectId],
  );
}

// ─────────────────────────────────────────────────────────────────────
// Grants
// ─────────────────────────────────────────────────────────────────────

export interface GrantOpts {
  taskId?: string;
  expiresAt?: string;
  reason?: string;
}

export async function createGrant(
  subjectToken: string,
  viewerId: string,
  scope: 'mentor' | 'assessor' | 'task',
  opts: GrantOpts = {},
  base: string = BASE,
): Promise<{ id: string }> {
  const r = await request<{ id?: string }>(
    'POST', '/passport/grants',
    {
      viewerId, scope,
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
    },
    subjectToken, base,
  );
  if (r.status !== 201 || !r.data?.id) {
    throw new Error(`createGrant → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return { id: r.data.id };
}

export async function revokeGrant(
  subjectToken: string,
  grantId: string,
  base: string = BASE,
): Promise<void> {
  const r = await request('DELETE', `/passport/grants/${grantId}`, undefined, subjectToken, base);
  if (r.status !== 200) {
    throw new Error(`revokeGrant → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Visibility
// ─────────────────────────────────────────────────────────────────────

export async function setVisibility(
  token: string,
  scope: 'public' | 'mentor' | 'assessor' | 'task',
  visibility: 'private' | 'summary' | 'levels' | 'full',
  consent: boolean,
  base: string = BASE,
): Promise<void> {
  const r = await request(
    'PATCH', '/passport/visibility',
    { scope, visibility, consent },
    token, base,
  );
  if (r.status !== 200) {
    throw new Error(`setVisibility → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Задача (для scope=task). Схема tasks не публичная через API для
// произвольного создания — используем прямой INSERT. Тест имеет
// доступ к БД (как test-invariants.ts). Если схема tasks изменится
// (появятся NOT NULL required_competencies и т.п.) — расширить INSERT.
// ─────────────────────────────────────────────────────────────────────

export async function createSmokeTask(
  adminToken: string,
  assignedTo: string,
  base: string = BASE,
): Promise<string> {
  // external_id генерируется API по шаблону ^[А-Я]{3}-ГГГГ-ММ-ДД-NNN$
  // (formatTaskExternalId + MAX(SUBSTRING...) в tasks/service.ts).
  // Поэтому создаём через публичный POST /tasks, а не прямым INSERT.
  const dirs = await request<{ data: Array<{ id: string }> }>(
    'GET', '/directions', undefined, adminToken, base,
  );
  const dirId = dirs.data?.data?.[0]?.id;
  if (!dirId) throw new Error('createSmokeTask: no active direction');

  const created = await request<{ id: string }>(
    'POST', '/tasks',
    {
      direction_id: dirId,
      description: 'smoke task for passport v3',
      priority: 'standard',
    },
    adminToken, base,
  );
  if (created.status !== 201 || !created.data?.id) {
    throw new Error(
      `createSmokeTask → ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`,
    );
  }
  const taskId = created.data.id;

  const assigned = await request(
    'POST', `/tasks/${taskId}/assign`,
    { participant_id: assignedTo },
    adminToken, base,
  );
  if (assigned.status !== 200) {
    throw new Error(
      `createSmokeTask assign → ${assigned.status} ${JSON.stringify(assigned.data).slice(0, 200)}`,
    );
  }
  return taskId;
}

// ─────────────────────────────────────────────────────────────────────
// Мелкие хелперы для evidence/assessment/appeal
// ─────────────────────────────────────────────────────────────────────

export async function submitEvidence(
  subjectToken: string,
  atomId: string,
  dimension: 'U' | 'X' | 'D' | 'P' | 'E',
  description = 'smoke evidence',
  base: string = BASE,
): Promise<string> {
  const r = await request<{ evidenceId?: string }>(
    'POST', '/passport/evidence',
    {
      atomId, dimension, evidenceType: 'portfolio',
      description,
    },
    subjectToken, base,
  );
  if (r.status !== 201 || !r.data?.evidenceId) {
    throw new Error(`submitEvidence → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data.evidenceId;
}

export async function submitAssessment(
  assessorToken: string,
  participantId: string,
  atomId: string,
  dimension: 'U' | 'X' | 'D' | 'P' | 'E',
  level: number,
  method = 'exam',
  evidenceIds?: string[],
  base: string = BASE,
): Promise<string> {
  const r = await request<{ assessmentId?: string }>(
    'POST', '/passport/assessments',
    {
      participantId, atomId, dimension, level, method,
      ...(evidenceIds && evidenceIds.length > 0 ? { evidenceIds } : {}),
    },
    assessorToken, base,
  );
  if (r.status !== 201 || !r.data?.assessmentId) {
    throw new Error(`submitAssessment → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data.assessmentId;
}

export async function submitAppeal(
  subjectToken: string,
  assessmentId: string,
  reason = 'smoke appeal',
  base: string = BASE,
): Promise<void> {
  const r = await request(
    'POST', '/passport/appeals',
    { assessmentId, reason },
    subjectToken, base,
  );
  if (r.status !== 200) {
    throw new Error(`submitAppeal → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Пути развития (шаг 7, alternative_to)
// ─────────────────────────────────────────────────────────────────────

export interface CreatePathOpts {
  goal: string;
  targetProfileSlug?: string;
}

export async function createPath(
  subjectToken: string,
  opts: CreatePathOpts,
  base: string = BASE,
): Promise<string> {
  const r = await request<{ pathId?: string }>(
    'POST', '/passport/paths',
    {
      goal: opts.goal,
      ...(opts.targetProfileSlug ? { targetProfileSlug: opts.targetProfileSlug } : {}),
    },
    subjectToken, base,
  );
  if (r.status !== 201 || !r.data?.pathId) {
    throw new Error(`createPath → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data.pathId;
}

// ─────────────────────────────────────────────────────────────────────
// Overview (для staleAssessments)
// ─────────────────────────────────────────────────────────────────────

export interface OverviewGoal {
  id: string;
  goal: string;
  targetProfileSlug: string | null;
  missingAtoms: Array<{
    atomId: string;
    atomName: string;
    missingDimensions: string[];
    alternativeAtomIds: string[];
  }>;
  status: string;
  createdAt: string;
}

export interface OverviewStale {
  atomId: string;
  dimension: string;
  assessorId: string;
  assessedAt: string;
  staleSince: string;
  policy: string;
}

export interface Overview {
  participantId: string;
  width: number;
  depthExecution: number;
  depthUnderstanding: number;
  depthFull: number;
  staleAssessments: OverviewStale[];
  goals: OverviewGoal[];
}

export async function getMe(
  subjectToken: string,
  base: string = BASE,
): Promise<Overview> {
  const r = await request<Overview>('GET', '/passport/me', undefined, subjectToken, base);
  if (r.status !== 200) {
    throw new Error(`getMe → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────
// Бэкдейт created_at assessment (для stale, шаг 6/10).
// Прямой SQL — иначе created_at не изменить (нет API).
// ─────────────────────────────────────────────────────────────────────

export async function backdateAssessment(
  assessmentId: string,
  monthsAgo: number,
): Promise<void> {
  await query(
    `UPDATE passport_assessments
        SET created_at = now() - ($1::int || ' months')::interval
      WHERE id = $2`,
    [monthsAgo, assessmentId],
  );
}

// ─────────────────────────────────────────────────────────────────────
// TaskProfile (Фаза 3a, шаг 4)
// ─────────────────────────────────────────────────────────────────────

export async function createTask(
  adminToken: string,
  description = 'smoke task for v4',
  base: string = BASE,
): Promise<string> {
  const dirs = await request<{ data: Array<{ id: string }> }>(
    'GET', '/directions', undefined, adminToken, base,
  );
  const dirId = dirs.data?.data?.[0]?.id;
  if (!dirId) throw new Error('createTask: no active direction');

  const r = await request<{ id?: string }>(
    'POST', '/tasks',
    { direction_id: dirId, description, priority: 'standard' },
    adminToken, base,
  );
  if (r.status !== 201 || !r.data?.id) {
    throw new Error(`createTask → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data.id;
}

export interface ProfileAtom {
  atom_id: string;
  role: 'executor' | 'designer' | 'consultant' | 'assessor';
  min: Partial<Record<'U' | 'X' | 'D' | 'P' | 'E', number>>;
}

export async function createTaskProfile(
  token: string,
  taskId: string,
  requiredAtoms: ProfileAtom[],
  base: string = BASE,
): Promise<{ status: number; data: unknown }> {
  return request('POST', `/passport/tasks/${taskId}/profile`, { requiredAtoms }, token, base);
}

export async function patchTaskProfile(
  token: string,
  taskId: string,
  requiredAtoms: ProfileAtom[],
  base: string = BASE,
): Promise<{ status: number; data: unknown }> {
  return request('PATCH', `/passport/tasks/${taskId}/profile`, { requiredAtoms }, token, base);
}

// ─────────────────────────────────────────────────────────────────────
// TeachingRelation (Фаза 3a, шаг 5)
// ─────────────────────────────────────────────────────────────────────

export async function assignTeaching(
  mentorToken: string,
  menteeId: string,
  atomId: string,
  dimensions?: Array<'U' | 'X' | 'D' | 'P' | 'E'>,
  base: string = BASE,
): Promise<{ status: number; data: unknown }> {
  return request(
    'POST', '/passport/teaching/assign',
    {
      menteeId, atomId,
      ...(dimensions ? { dimensions } : {}),
    },
    mentorToken, base,
  );
}

export async function revokeTeaching(
  mentorToken: string,
  relationId: string,
  reason?: string,
  base: string = BASE,
): Promise<{ status: number; data: unknown }> {
  return request(
    'POST', `/passport/teaching/${relationId}/revoke`,
    reason ? { reason } : {},
    mentorToken, base,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Permit (Фаза 3b, шаг 2)
// ─────────────────────────────────────────────────────────────────────

export interface CreatePermitOpts {
  permitId: string;
  name: string;
  issuedBy: string;
  scope?: string;
  validUntil?: string;
  verificationMethod: string;
}

export async function createPermit(
  token: string,
  opts: CreatePermitOpts,
  base: string = BASE,
): Promise<{ status: number; data: unknown }> {
  return request('POST', '/passport/permits', opts, token, base);
}

export async function listPermits(
  token: string,
  status: 'active' | 'revoked' | 'expired' = 'active',
  base: string = BASE,
): Promise<{ status: number; data: { data: Array<{ permitId: string }> } }> {
  return request('GET', `/passport/permits?status=${status}`, undefined, token, base);
}

export async function issuePermit(
  token: string,
  participantId: string,
  permitId: string,
  validUntil?: string,
  verificationData?: Record<string, unknown>,
  base: string = BASE,
): Promise<{
  status: number;
  data: { id?: string; isExpired?: boolean; status?: string };
}> {
  return request(
    'POST', `/passport/participants/${participantId}/permits`,
    {
      permitId,
      ...(validUntil !== undefined ? { validUntil } : {}),
      ...(verificationData ? { verificationData } : {}),
    },
    token, base,
  );
}

export async function revokeParticipantPermit(
  token: string,
  participantPermitId: string,
  reason: string,
  base: string = BASE,
): Promise<{ status: number; data: { status?: string } }> {
  return request(
    'POST', `/passport/participant-permits/${participantPermitId}/revoke`,
    { reason },
    token, base,
  );
}

// ─────────────────────────────────────────────────────────────────────
// mentor_questions (Фаза 3b, шаг 4)
// ─────────────────────────────────────────────────────────────────────

export async function createMentorQuestion(
  token: string,
  question: string,
  atomId?: string,
  mentorId?: string,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string; status?: string; mentorId?: string | null } }> {
  return request(
    'POST', '/passport/teaching/questions',
    {
      question,
      ...(atomId ? { atomId } : {}),
      ...(mentorId ? { mentorId } : {}),
    },
    token, base,
  );
}

export async function answerMentorQuestion(
  token: string,
  questionId: string,
  answer: string,
  base: string = BASE,
): Promise<{ status: number; data: { status?: string; answeredAt?: string } }> {
  return request(
    'POST', `/passport/teaching/mentor-questions/${questionId}/answer`,
    { answer },
    token, base,
  );
}

export async function listMyQuestions(
  token: string,
  base: string = BASE,
): Promise<{ status: number; data: { data: Array<{ id: string }> } }> {
  return request('GET', '/passport/teaching/questions', undefined, token, base);
}

// ─────────────────────────────────────────────────────────────────────
// TeamCapability (Фаза 3c, §11.4)
// ─────────────────────────────────────────────────────────────────────

export interface CreateTeamOpts {
  name: string;
  expectedResult: string;
  participants: string[];
  criteria?: Record<string, Record<string, unknown>>;
}

export async function createTeam(
  token: string,
  opts: CreateTeamOpts,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string; status?: string } }> {
  return request('POST', '/passport/teams', opts, token, base);
}

export async function listMyTeams(
  token: string,
  base: string = BASE,
): Promise<{ status: number; data: { data: Array<{ id: string; name: string }> } }> {
  return request('GET', '/passport/teams', undefined, token, base);
}

export async function getTeam(
  token: string,
  teamId: string,
  base: string = BASE,
): Promise<{
  status: number;
  data: { id?: string; status?: string; assessorId?: string | null };
}> {
  return request('GET', `/passport/teams/${teamId}`, undefined, token, base);
}

export async function assessTeam(
  token: string,
  teamId: string,
  level: number,
  criteriaScores: Record<string, number>,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string; level?: number } }> {
  return request(
    'POST', `/passport/teams/${teamId}/assess`,
    { level, criteriaScores },
    token, base,
  );
}

export async function getTeamHistory(
  token: string,
  teamId: string,
  base: string = BASE,
): Promise<{ status: number; data: { data: Array<{ id: string; level: number }> } }> {
  return request('GET', `/passport/teams/${teamId}/history`, undefined, token, base);
}

// ─────────────────────────────────────────────────────────────────────
// Калибровка 0–9 (Фаза 3d, §6.5)
// ─────────────────────────────────────────────────────────────────────

export interface CreateAnchorOpts {
  atomId: string;
  dimension: 'U' | 'X' | 'D' | 'P' | 'E';
  level: number;
  title: string;
  description?: string;
  content?: Record<string, unknown>;
}

export async function createAnchor(
  token: string,
  opts: CreateAnchorOpts,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string } }> {
  return request('POST', '/passport/calibration/anchors', opts, token, base);
}

export async function listAnchors(
  token: string,
  atomId?: string,
  dimension?: string,
  base: string = BASE,
): Promise<{ status: number; data: { data: Array<{ id: string }> } }> {
  const qs = new URLSearchParams();
  if (atomId) qs.set('atomId', atomId);
  if (dimension) qs.set('dimension', dimension);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request('GET', `/passport/calibration/anchors${suffix}`, undefined, token, base);
}

export async function createCalibrationSession(
  token: string,
  atomId: string,
  dimension: 'U' | 'X' | 'D' | 'P' | 'E',
  deadline?: string,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string; status?: string } }> {
  return request(
    'POST', '/passport/calibration/sessions',
    { atomId, dimension, ...(deadline ? { deadline } : {}) },
    token, base,
  );
}

export async function assignAnchor(
  token: string,
  sessionId: string,
  anchorExampleId: string,
  assessorId: string,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string } }> {
  return request(
    'POST', `/passport/calibration/sessions/${sessionId}/assign`,
    { anchorExampleId, assessorId },
    token, base,
  );
}

export async function scoreAssignment(
  token: string,
  assignmentId: string,
  level: number,
  note?: string,
  base: string = BASE,
): Promise<{ status: number; data: { level?: number; scoredAt?: string } }> {
  return request(
    'POST', `/passport/calibration/assignments/${assignmentId}/score`,
    { level, ...(note ? { note } : {}) },
    token, base,
  );
}

export interface ReportWork {
  anchorExampleId: string;
  title: string;
  expectedLevel: number;
  scores: Array<{ assignmentId: string; level: number | null }>;
  maxDiff: number | null;
  needsThird: boolean;
}

export interface CalibrationReport {
  session: { id: string; status: string; overdue?: boolean };
  works: ReportWork[];
  summary: {
    worksCount: number;
    scoredCount: number;
    unscoredCount: number;
    flaggedCount: number;
    overdue: boolean;
  };
}

export async function getSessionReport(
  token: string,
  sessionId: string,
  base: string = BASE,
): Promise<{ status: number; data: CalibrationReport }> {
  return request(
    'GET', `/passport/calibration/sessions/${sessionId}/report`,
    undefined, token, base,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Team update (техдолг 3c)
// ─────────────────────────────────────────────────────────────────────

export interface UpdateTeamOpts {
  name?: string;
  expectedResult?: string;
  participants?: string[];
  criteria?: Record<string, Record<string, unknown>>;
}

export async function updateTeam(
  token: string,
  teamId: string,
  opts: UpdateTeamOpts,
  base: string = BASE,
): Promise<{ status: number; data: { id?: string; name?: string } }> {
  return request('PATCH', `/passport/teams/${teamId}`, opts, token, base);
}

// ─────────────────────────────────────────────────────────────────────
// Batch participants (техдолг 3c)
// ─────────────────────────────────────────────────────────────────────

export interface BatchParticipant {
  id: string;
  externalId: string;
  name: string;
  status: string;
}

export async function getBatchParticipants(
  token: string,
  ids: string[],
  base: string = BASE,
): Promise<{ status: number; data: { data: BatchParticipant[] } }> {
  return request(
    'GET', `/passport/participants?ids=${encodeURIComponent(ids.join(','))}`,
    undefined, token, base,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Graph API (Фаза 3d)
// ─────────────────────────────────────────────────────────────────────

export interface GraphPayload {
  nodes: Array<{
    atomId: string;
    name: string;
    cluster: string;
    isWidth: boolean;
    isDepthExecution: boolean;
    isDepthUnderstanding: boolean;
    isDepthFull: boolean;
  }>;
  edges: Array<{ fromAtomId: string; toAtomId: string; relationType: string }>;
  meta: { totalNodes: number; totalEdges: number };
}

export async function getGraph(
  token: string,
  filter?: 'all' | 'assessed' | 'not_assessed',
  cluster?: string,
  direction?: number,
  base: string = BASE,
): Promise<{ status: number; data: GraphPayload }> {
  const qs = new URLSearchParams();
  if (filter) qs.set('filter', filter);
  if (cluster) qs.set('cluster', cluster);
  if (direction !== undefined) qs.set('direction', String(direction));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request('GET', `/passport/graph${suffix}`, undefined, token, base);
}

// ─────────────────────────────────────────────────────────────────────
// Каталог v0.4 — workflow предложений
// ─────────────────────────────────────────────────────────────────────

export interface CatalogProposalData {
  id: string;
  proposalType: string;
  atomId: string | null;
  status: string;
  payload: Record<string, unknown>;
}

export async function createCatalogProposal(
  token: string,
  proposalType: 'new_atom' | 'update_atom' | 'deprecate_atom',
  payload: Record<string, unknown>,
  atomId?: string,
  base: string = BASE,
): Promise<{ status: number; data: CatalogProposalData }> {
  return request(
    'POST', '/passport/catalog/proposals',
    {
      proposalType,
      payload,
      ...(atomId !== undefined ? { atomId } : {}),
    },
    token, base,
  );
}

export async function listCatalogProposals(
  token: string,
  status?: string,
  base: string = BASE,
): Promise<{ status: number; data: { data: CatalogProposalData[] } }> {
  const suffix = status ? `?status=${status}` : '';
  return request('GET', `/passport/catalog/proposals${suffix}`, undefined, token, base);
}

export async function setProposalStatus(
  token: string,
  proposalId: string,
  status: 'submitted' | 'in_review' | 'approved' | 'rejected',
  opts: { reason?: string; reviewNote?: string } = {},
  base: string = BASE,
): Promise<{ status: number; data: CatalogProposalData }> {
  return request(
    'PATCH', `/passport/catalog/proposals/${proposalId}`,
    {
      status,
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.reviewNote ? { reviewNote: opts.reviewNote } : {}),
    },
    token, base,
  );
}

export async function mergeProposal(
  token: string,
  proposalId: string,
  base: string = BASE,
): Promise<{ status: number; data: CatalogProposalData }> {
  return request(
    'POST', `/passport/catalog/proposals/${proposalId}/merge`,
    undefined, token, base,
  );
}

export async function getAtom(
  token: string,
  atomId: string,
  base: string = BASE,
): Promise<{
  status: number;
  data: { atom?: { atom_id: string; name: string; version: string; status: string } };
}> {
  return request('GET', `/passport/atoms/${atomId}`, undefined, token, base);
}

// ─────────────────────────────────────────────────────────────────────
// Полный workflow: create → submit → in_review → approved → merge.
// Используется в test-passport-v8 (для update_atom / new_atom).
// ─────────────────────────────────────────────────────────────────────

export interface FullMergeResult {
  proposalId: string;
  atomId: string | null;
  status: string;
}

export async function createAndMergeProposal(
  token: string,
  proposalType: 'new_atom' | 'update_atom' | 'deprecate_atom',
  payload: Record<string, unknown>,
  atomId?: string,
  base: string = BASE,
): Promise<FullMergeResult> {
  const c = await createCatalogProposal(token, proposalType, payload, atomId, base);
  if (c.status !== 201 || !c.data.id) {
    throw new Error(
      `createAndMergeProposal: create → ${c.status} ${JSON.stringify(c.data).slice(0, 200)}`,
    );
  }
  const proposalId = c.data.id;
  for (const s of ['submitted', 'in_review', 'approved'] as const) {
    const r = await setProposalStatus(token, proposalId, s, {}, base);
    if (r.status !== 200) {
      throw new Error(
        `createAndMergeProposal: ${s} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`,
      );
    }
  }
  const m = await mergeProposal(token, proposalId, base);
  if (m.status !== 200) {
    throw new Error(
      `createAndMergeProposal: merge → ${m.status} ${JSON.stringify(m.data).slice(0, 200)}`,
    );
  }
  return {
    proposalId,
    atomId: m.data.atomId,
    status: m.data.status,
  };
}