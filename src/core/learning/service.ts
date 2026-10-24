// C.0.31.02 — Сервис Обучения.
// Курсы, маршруты, ПТТ, рефреш, модули, интеграторы.
// Цифровой наставник до 50 стажёров. Маршрут 30 дней, 1% экскурсантов.
//
// v0.0.02:
//   - P8:  completeByCourse(courseId, participantId) — без requesterId;
//          completeCourse(row.id, participantId) — аудит от имени участника.
//   - P9:  addIntegratorMenteeService — 404, если mentee не существует
//          (mentees — JSONB без FK).
//   - P10: startRefreshService — 404, если d1/d2 не существуют (JSONB без FK).
//   - P11: createRouteService — 23503 (FK violation) → 404 с именем constraint.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  createCourse, enroll as entityEnroll,
  completeCourse as completeCourseEntity,
  createDigitalMentor,
  startPtt as entityStartPtt, advancePtt,
  createRoute, completeRoute, getRouteQueueSize,
  startRefresh, passModule,
  assignIntegrator, addIntegratorMentee,
  LEARNING_CONSTANTS,
  type Course, type Enrollment, type DigitalMentor, type Ptt,
  type CognitiveRoute, type RefreshCourse, type ModulePass,
  type IntegratorMentor,
  type EnrollmentStatus, type PttStatus, type RouteStatus,
} from './entity.js';

// ─── Row-mappers ─────────────────────────────────────────────────

interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  modules: Array<Record<string, unknown>>;
  duration_days: number;
  created_at: Date;
}

function rowToCourse(r: CourseRow): Course {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    modules: r.modules ?? [],
    durationDays: r.duration_days,
    createdAt: r.created_at.toISOString(),
  };
}

interface EnrollmentRow {
  id: string;
  course_id: string;
  participant_id: string;
  status: EnrollmentStatus;
  started_at: Date;
  finished_at: Date | null;
}

function rowToEnrollment(r: EnrollmentRow): Enrollment {
  return {
    id: r.id,
    courseId: r.course_id,
    participantId: r.participant_id,
    status: r.status,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

interface PttRow {
  id: string;
  goal: string;
  duration_days: number;
  status: PttStatus;
  started_at: Date;
  finished_at: Date | null;
}

function rowToPtt(r: PttRow): Ptt {
  return {
    id: r.id,
    goal: r.goal,
    durationDays: r.duration_days,
    status: r.status,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

interface RouteRow {
  id: string;
  participant_id: string;
  direction_id: string;
  mentor_id: string;
  started_at: Date;
  finished_at: Date | null;
  status: RouteStatus;
  certificate_issued: boolean;
}

function rowToRoute(r: RouteRow): CognitiveRoute {
  return {
    id: r.id,
    participantId: r.participant_id,
    directionId: r.direction_id,
    mentorId: r.mentor_id,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    status: r.status,
    certificateIssued: r.certificate_issued,
  };
}

interface IntegratorRow {
  id: string;
  mentor_id: string;
  direction_id: string;
  mentees: string[];
  max_mentees: number;
  created_at: Date;
}

function rowToIntegrator(r: IntegratorRow): IntegratorMentor {
  return {
    id: r.id,
    mentorId: r.mentor_id,
    directionId: r.direction_id,
    mentees: r.mentees ?? [],
    maxMentees: r.max_mentees,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Курсы ───────────────────────────────────────────────────────

export interface CourseFilter {
  page?: number;
  perPage?: number;
}

export async function listCourses(filter: CourseFilter = {}): Promise<{
  data: Course[];
  total: number;
}> {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;
  const offset = (page - 1) * perPage;
  const totalRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM courses`,
  );
  const rows = await query<CourseRow>(
    `SELECT * FROM courses ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [perPage, offset],
  );
  return {
    data: rows.map(rowToCourse),
    total: parseInt(totalRow?.cnt ?? '0', 10),
  };
}

export interface CourseCreate {
  title: string;
  description?: string;
  modules: Array<Record<string, unknown>>;
  durationDays: number;
}

export async function createCourseService(
  input: CourseCreate,
  requesterId: UUID,
): Promise<Course> {
  const id = newUUID();
  const c = createCourse({ id, ...input });
  await query(
    `INSERT INTO courses (id, title, description, modules, duration_days)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [c.id, c.title, c.description, JSON.stringify(c.modules), c.durationDays],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.course.created',
    entityType: 'course',
    entityId: c.id,
    newValue: { title: c.title },
  });
  return c;
}

export async function getCourse(courseId: UUID): Promise<Course> {
  const r = await queryOne<CourseRow>(
    `SELECT * FROM courses WHERE id = $1`,
    [courseId],
  );
  if (!r) {throw new NotFoundError('Курс', courseId);}
  return rowToCourse(r);
}

// ─── Записи (enrollments) ────────────────────────────────────────

export async function enroll(
  courseId: UUID,
  participantId: UUID,
): Promise<Enrollment> {
  await getCourse(courseId); // проверка существования
  const e = entityEnroll(courseId, participantId);
  try {
    await query(
      `INSERT INTO enrollments (id, course_id, participant_id, status)
       VALUES ($1, $2, $3, $4)`,
      [e.id, e.courseId, e.participantId, e.status],
    );
  } catch (e2) {
    const err = e2 as { code?: string };
    if (err.code === '23505') {
      throw new ConflictError('Вы уже записаны на этот курс');
    }
    throw e2;
  }
  return e;
}

export async function completeCourse(
  enrollmentId: UUID,
  requesterId: UUID,
): Promise<Enrollment> {
  const r = await queryOne<EnrollmentRow>(
    `SELECT * FROM enrollments WHERE id = $1`,
    [enrollmentId],
  );
  if (!r) {throw new NotFoundError('Запись', enrollmentId);}
  const e = rowToEnrollment(r);
  const updated = completeCourseEntity(e);
  await query(
    `UPDATE enrollments SET status = $2, finished_at = $3 WHERE id = $1`,
    [enrollmentId, updated.status, updated.finishedAt],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.course.completed',
    entityType: 'enrollment',
    entityId: enrollmentId,
  });
  return updated;
}


// ─── Цифровой наставник ──────────────────────────────────────────

export async function getDigitalMentor(): Promise<DigitalMentor> {
  // D.2.01.03: у digital_mentor_state колонка updated_at, created_at нет.
  let r = await queryOne<{
    id: string;
    mentor_type: 'ai';
    active_mentees: number;
    algorithm_version: string;
    updated_at: Date;
  }>(`SELECT * FROM digital_mentor_state LIMIT 1`);

  if (!r) {
    const dm = createDigitalMentor('v1');
    await query(
      `INSERT INTO digital_mentor_state (id, mentor_type, active_mentees, algorithm_version)
       VALUES ($1, $2, $3, $4)`,
      [dm.id, dm.mentorType, dm.activeMentees, dm.algorithmVersion],
    );
    return dm;
  }

  return {
    id: r.id,
    mentorType: r.mentor_type,
    activeMentees: r.active_mentees,
    algorithmVersion: r.algorithm_version,
    createdAt: r.updated_at.toISOString(),
  };
}

export async function transferToHuman(
  menteeId: UUID,
  humanMentorId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<DigitalMentor> {
  const dm = await getDigitalMentor();
  if (dm.activeMentees > 0) {
    await query(
      `UPDATE digital_mentor_state
          SET active_mentees = GREATEST(active_mentees - 1, 0)
        WHERE id = $1`,
      [dm.id],
    );
  }
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.mentor.transferred',
    entityType: 'participant',
    entityId: menteeId,
    newValue: { humanMentorId, reason },
  });
  return { ...dm, activeMentees: Math.max(dm.activeMentees - 1, 0) };
}

// ─── ПТТ ─────────────────────────────────────────────────────────

export async function startPtt(
  goal: string,
  durationDays: number,
  requesterId: UUID,
): Promise<Ptt> {
  const p = entityStartPtt(goal, durationDays);
  await query(
    `INSERT INTO ptt_projects (id, goal, duration_days, status)
     VALUES ($1, $2, $3, $4)`,
    [p.id, p.goal, p.durationDays, p.status],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.ptt.started',
    entityType: 'ptt',
    entityId: p.id,
    newValue: { goal: p.goal, durationDays: p.durationDays },
  });
  return p;
}

export async function getPtt(pttId: UUID): Promise<Ptt> {
  const r = await queryOne<PttRow>(
    `SELECT * FROM ptt_projects WHERE id = $1`,
    [pttId],
  );
  if (!r) {throw new NotFoundError('ПТТ', pttId);}
  return rowToPtt(r);
}

export async function advancePttService(
  pttId: UUID,
  requesterId: UUID,
): Promise<Ptt> {
  const p = await getPtt(pttId);
  const updated = advancePtt(p);
  await query(
    `UPDATE ptt_projects SET status = $2, finished_at = $3 WHERE id = $1`,
    [pttId, updated.status, updated.finishedAt],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.ptt.advanced',
    entityType: 'ptt',
    entityId: pttId,
    newValue: { status: updated.status },
  });
  return updated;
}

export async function auditPtt(
  pttId: UUID,
  requesterId: UUID,
): Promise<{ findings: string[] }> {
  const p = await getPtt(pttId);
  const findings: string[] = [];
  if (p.durationDays > LEARNING_CONSTANTS.PTT_MAX_DAYS) {
    findings.push(`Длительность ПТТ превышает ${LEARNING_CONSTANTS.PTT_MAX_DAYS} дней`);
  }
  const hoursSinceStart =
    (Date.now() - new Date(p.startedAt).getTime()) / 3600000;
  if (p.status === 'started' && hoursSinceStart > 24) {
    findings.push('ПТТ в статусе started > 24 часов');
  }
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.ptt.audited',
    entityType: 'ptt',
    entityId: pttId,
    newValue: { findings },
  });
  return { findings };
}

// ─── Когнитивные маршруты ────────────────────────────────────────

export async function listRoutes(filter: {
  participantId?: UUID;
  status?: RouteStatus;
}): Promise<CognitiveRoute[]> {
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (filter.participantId) {
    params.push(filter.participantId);
    wheres.push(`participant_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    wheres.push(`status = $${params.length}`);
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows = await query<RouteRow>(
    `SELECT * FROM cognitive_routes ${where}
     ORDER BY started_at DESC LIMIT 200`,
    params,
  );
  return rows.map(rowToRoute);
}

export async function createRouteService(
  participantId: UUID,
  directionId: UUID,
  mentorId: UUID,
  requesterId: UUID,
): Promise<CognitiveRoute> {
  const r = createRoute(participantId, directionId, mentorId);
  try {
    await query(
      `INSERT INTO cognitive_routes
         (id, participant_id, direction_id, mentor_id, status, certificate_issued)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.id, r.participantId, r.directionId, r.mentorId, r.status, r.certificateIssued],
    );
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505') {throw new ConflictError('Участник уже в маршруте');}
    // P11: FK violation → 404. constraint — имя FK (participant_id / direction_id /
    // mentor_id) для диагностики; NotFoundError.resource подсказывает, что не найдено.
    if (err.code === '23503') {
      throw new NotFoundError(
        'Участник / направление / наставник',
        String(err.constraint ?? ''),
      );
    }
    throw e;
  }
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.route.created',
    entityType: 'cognitive_route',
    entityId: r.id,
    newValue: { participantId, directionId, mentorId },
  });
  return r;
}

export async function completeRouteService(
  routeId: UUID,
  requesterId: UUID,
): Promise<CognitiveRoute> {
  const r = await queryOne<RouteRow>(
    `SELECT * FROM cognitive_routes WHERE id = $1`,
    [routeId],
  );
  if (!r) {throw new NotFoundError('Маршрут', routeId);}
  const updated = completeRoute(rowToRoute(r));
  await query(
    `UPDATE cognitive_routes
        SET status = $2, certificate_issued = $3, finished_at = $4
      WHERE id = $1`,
    [routeId, updated.status, updated.certificateIssued, updated.finishedAt],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.route.completed',
    entityType: 'cognitive_route',
    entityId: routeId,
  });
  return updated;
}

export async function getRouteQueue(directionId: UUID): Promise<{
  queue: UUID[];
  freeSlots: number;
}> {
  const cntRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM participants
      WHERE direction_id = $1 AND deleted_at IS NULL`,
    [directionId],
  );
  const total = parseInt(cntRow?.cnt ?? '0', 10);
  const capacity = getRouteQueueSize(total);

  const activeRows = await query<{ participant_id: string }>(
    `SELECT participant_id FROM cognitive_routes
      WHERE direction_id = $1 AND status = 'active'`,
    [directionId],
  );
  const active = activeRows.map((r) => r.participant_id);
  return {
    queue: active,
    freeSlots: Math.max(0, capacity - active.length),
  };
}

// ─── Рефреш ──────────────────────────────────────────────────────

export async function startRefreshService(
  participantId: UUID,
  d1: UUID,
  d2: UUID,
  requesterId: UUID,
): Promise<RefreshCourse> {
  const r = startRefresh(participantId, d1, d2);

  // P10: Валидация направлений (FK в JSONB-полях нет).
  const d1Check = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE id = $1`,
    [d1],
  );
  if (!d1Check) {throw new NotFoundError('Направление', d1);}
  const d2Check = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE id = $1`,
    [d2],
  );
  if (!d2Check) {throw new NotFoundError('Направление', d2);}

  // D.2.01.03: колонки называются direction_1 / direction_2 (без _id).
  await query(
    `INSERT INTO refresh_courses
       (id, participant_id, direction_1, direction_2)
     VALUES ($1, $2, $3, $4)`,
    [r.id, r.participantId, r.direction1Id, r.direction2Id],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.refresh.started',
    entityType: 'refresh_course',
    entityId: r.id,
  });
  return r;
}

// ─── Модули ──────────────────────────────────────────────────────

export async function passModuleService(
  participantId: UUID,
  module: string,
  requesterId: UUID,
): Promise<ModulePass> {
  const m = passModule(participantId, module);
  await query(
    `INSERT INTO module_passes (id, participant_id, module)
     VALUES ($1, $2, $3)`,
    [m.id, m.participantId, m.module],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.module.passed',
    entityType: 'module_pass',
    entityId: m.id,
    newValue: { module },
  });
  return m;
}

// ─── Интеграторы ─────────────────────────────────────────────────

export async function listIntegrators(
  directionId?: UUID,
): Promise<IntegratorMentor[]> {
  const params: unknown[] = [];
  const where = directionId
    ? (params.push(directionId), `WHERE direction_id = $1`)
    : '';
  const rows = await query<IntegratorRow>(
    `SELECT * FROM integrator_mentors ${where} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(rowToIntegrator);
}

export async function assignIntegratorService(
  mentorId: UUID,
  directionId: UUID,
  requesterId: UUID,
): Promise<IntegratorMentor> {
  const im = assignIntegrator(mentorId, directionId);
  try {
    await query(
      `INSERT INTO integrator_mentors (id, mentor_id, direction_id, mentees, max_mentees)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [im.id, im.mentorId, im.directionId, JSON.stringify(im.mentees), im.maxMentees],
    );
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23505') {throw new ConflictError('Интегратор уже назначен');}
    throw e;
  }
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.integrator.assigned',
    entityType: 'integrator_mentor',
    entityId: im.id,
    newValue: { mentorId, directionId },
  });
  return im;
}

export async function addIntegratorMenteeService(
  mentorId: UUID,
  menteeId: UUID,
  requesterId: UUID,
): Promise<IntegratorMentor> {
  const row = await queryOne<IntegratorRow>(
    `SELECT * FROM integrator_mentors WHERE mentor_id = $1`,
    [mentorId],
  );
  if (!row) {throw new NotFoundError('Интегратор', mentorId);}

  // P9: mentees — JSONB-массив, FK нет. Проверяем существование вручную.
  const mentee = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [menteeId],
  );
  if (!mentee) {throw new NotFoundError('Участник', menteeId);}

  const updated = addIntegratorMentee(rowToIntegrator(row), menteeId);
  await query(
    `UPDATE integrator_mentors SET mentees = $2::jsonb WHERE id = $1`,
    [updated.id, JSON.stringify(updated.mentees)],
  );
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'learning.integrator.mentee.added',
    entityType: 'integrator_mentor',
    entityId: updated.id,
    newValue: { menteeId },
  });
  return updated;
}

export {
  LEARNING_CONSTANTS,
  canAcceptMentee,
  canBeIntegrator,
} from './entity.js';

// P8: completeByCourse(courseId, participantId) — без requesterId.
// Завершает курс от имени участника (аудит: actorId = participantId).
export async function completeByCourse(
  courseId: UUID,
  participantId: UUID,
): Promise<Enrollment> {
  const row = await queryOne<EnrollmentRow>(
    `SELECT * FROM enrollments
      WHERE course_id = $1 AND participant_id = $2
        AND status IN ('enrolled', 'in_progress')
      LIMIT 1`,
    [courseId, participantId],
  );
  if (!row) {
    throw new NotFoundError('Активная запись на курс', courseId);
  }
  return completeCourse(row.id, participantId);
}