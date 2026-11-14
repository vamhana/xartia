// C.1.13.01 — Калибровка 0–9 (Фаза 3d, §6.5).
//
// A60–A70:
//   * anchor_examples — эталоны (content JSONB, без файлов в 3d).
//   * Создание anchor / session: FA | COUNCIL.
//   * assign: FA | COUNCIL (сессия должна быть draft|open).
//   * score: назначенный assessor, `level` только 0..9, повтор → 409.
//   * report: max−min среди непустых level; ≥ 2 → needsThird.
//     Медиана не применяется (§6.5 п.3).
//   * assignment append-only по духу: score = UPDATE только с NULL level.
//
// Калибровка не пишет в passport_history_events (методологическая
// активность). Аудит — через system_events/audit_log, если понадобится.
//
// passport_assessments.criteria_version — заполняется при обычной оценке
// атома (submitAssessment), не здесь. Это отдельный техдолг (A70).

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import type {
  AnchorExample,
  AnchorExampleRow,
  CalibrationAssignment,
  CalibrationAssignmentRow,
  CalibrationReport,
  CalibrationSession,
  CalibrationSessionRow,
  CalibrationWorkReport,
  CreateAnchorInput,
  CreateSessionInput,
  Dimension,
} from './types.js';
import { DIMENSIONS } from './types.js';

const CALIB_AUTHOR_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER'] as const;

async function hasAnyRole(
  participantId: UUID,
  roles: readonly string[],
): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [participantId, [...roles]],
  );
  return (row?.n ?? 0) > 0;
}

async function assertAtomExists(atomId: string): Promise<void> {
  const r = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms WHERE atom_id = $1`,
    [atomId],
  );
  if (!r) {throw new NotFoundError('Atom', atomId);}
}

// ─────────────────────────────────────────────────────────────────────
// Маппинг
// ─────────────────────────────────────────────────────────────────────

function toAnchor(r: AnchorExampleRow): AnchorExample {
  return {
    id: r.id,
    atomId: r.atom_id,
    dimension: r.dimension,
    level: r.level,
    title: r.title,
    description: r.description,
    content: r.content,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

function toSession(r: CalibrationSessionRow): CalibrationSession {
  return {
    id: r.id,
    atomId: r.atom_id,
    dimension: r.dimension,
    status: r.status,
    createdBy: r.created_by,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
  };
}

function toAssignment(r: CalibrationAssignmentRow): CalibrationAssignment {
  return {
    id: r.id,
    sessionId: r.session_id,
    anchorExampleId: r.anchor_example_id,
    assessorId: r.assessor_id,
    level: r.level,
    note: r.note,
    createdAt: r.created_at.toISOString(),
    scoredAt: r.scored_at ? r.scored_at.toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Anchors
// ─────────────────────────────────────────────────────────────────────

export async function createAnchor(
  actorId: UUID,
  input: CreateAnchorInput,
): Promise<AnchorExample> {
  if (!(await hasAnyRole(actorId, CALIB_AUTHOR_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER can create anchor examples',
      { allowed_roles: [...CALIB_AUTHOR_ROLES] },
    );
  }
  if (!(DIMENSIONS as readonly string[]).includes(input.dimension)) {
    throw new ValidationError(`Unknown dimension '${input.dimension}'`);
  }
  if (!Number.isInteger(input.level) || input.level < 0 || input.level > 9) {
    throw new ValidationError('level must be integer 0..9');
  }
  if (!input.title || input.title.trim().length === 0) {
    throw new ValidationError('title must not be empty');
  }
  if (input.content !== undefined && (
    typeof input.content !== 'object' || input.content === null ||
    Array.isArray(input.content)
  )) {
    throw new ValidationError('content must be object');
  }

  await assertAtomExists(input.atomId);

  const id = newUUID();
  const ins = await query<AnchorExampleRow>(
    `INSERT INTO anchor_examples
       (id, atom_id, dimension, level, title, description, content, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING id, atom_id, dimension, level, title, description, content,
               version, created_by, created_at`,
    [
      id,
      input.atomId,
      input.dimension,
      input.level,
      input.title.trim(),
      input.description ?? null,
      JSON.stringify(input.content ?? {}),
      actorId,
    ],
  );
  return toAnchor(ins[0]!);
}

export async function listAnchors(opts: {
  atomId?: string;
  dimension?: Dimension;
}): Promise<AnchorExample[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (opts.atomId) {
    params.push(opts.atomId);
    cond.push(`atom_id = $${params.length}`);
  }
  if (opts.dimension) {
    params.push(opts.dimension);
    cond.push(`dimension = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = await query<AnchorExampleRow>(
    `SELECT id, atom_id, dimension, level, title, description, content,
            version, created_by, created_at
       FROM anchor_examples ${where}
      ORDER BY atom_id, dimension, level, created_at DESC`,
    params,
  );
  return rows.map(toAnchor);
}

// ─────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────

export async function createSession(
  actorId: UUID,
  input: CreateSessionInput,
): Promise<CalibrationSession> {
  if (!(await hasAnyRole(actorId, CALIB_AUTHOR_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER can create calibration sessions',
      { allowed_roles: [...CALIB_AUTHOR_ROLES] },
    );
  }
  if (!(DIMENSIONS as readonly string[]).includes(input.dimension)) {
    throw new ValidationError(`Unknown dimension '${input.dimension}'`);
  }
  await assertAtomExists(input.atomId);

  const id = newUUID();
  const ins = await query<CalibrationSessionRow>(
    `INSERT INTO calibration_sessions
       (id, atom_id, dimension, status, created_by, deadline)
     VALUES ($1,$2,$3,'draft',$4,$5::timestamptz)
     RETURNING id, atom_id, dimension, status, created_by, deadline,
               created_at, closed_at`,
    [
      id,
      input.atomId,
      input.dimension,
      actorId,
      input.deadline ?? null,
    ],
  );
  return toSession(ins[0]!);
}

export async function getSession(
  sessionId: UUID,
): Promise<CalibrationSession | null> {
  const r = await queryOne<CalibrationSessionRow>(
    `SELECT id, atom_id, dimension, status, created_by, deadline,
            created_at, closed_at
       FROM calibration_sessions WHERE id = $1`,
    [sessionId],
  );
  return r ? toSession(r) : null;
}

export async function listSessions(
  atomId?: string,
): Promise<CalibrationSession[]> {
  const params: unknown[] = [];
  let where = '';
  if (atomId) {
    params.push(atomId);
    where = `WHERE atom_id = $${params.length}`;
  }
  const rows = await query<CalibrationSessionRow>(
    `SELECT id, atom_id, dimension, status, created_by, deadline,
            created_at, closed_at
       FROM calibration_sessions ${where}
      ORDER BY created_at DESC`,
    params,
  );
  return rows.map(toSession);
}

// ─────────────────────────────────────────────────────────────────────
// Assign
// ─────────────────────────────────────────────────────────────────────

export interface AssignParams {
  sessionId: UUID;
  anchorExampleId: UUID;
  assessorId: UUID;
}

export async function assignAnchor(
  actorId: UUID,
  input: AssignParams,
): Promise<CalibrationAssignment> {
  if (!(await hasAnyRole(actorId, CALIB_AUTHOR_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER can assign anchors',
      { allowed_roles: [...CALIB_AUTHOR_ROLES] },
    );
  }

  return transaction(async (client) => {
    const sessRes = await client.query<CalibrationSessionRow>(
      `SELECT id, atom_id, dimension, status, created_by, deadline,
              created_at, closed_at
         FROM calibration_sessions WHERE id = $1
         FOR UPDATE`,
      [input.sessionId],
    );
    const session = sessRes.rows[0];
    if (!session) {throw new NotFoundError('Calibration session', input.sessionId);}
    if (session.status === 'closed') {
      throw new ConflictError('Session is closed');
    }

    const anchorRes = await client.query<AnchorExampleRow>(
      `SELECT id, atom_id, dimension, level, title, description, content,
              version, created_by, created_at
         FROM anchor_examples WHERE id = $1`,
      [input.anchorExampleId],
    );
    const anchor = anchorRes.rows[0];
    if (!anchor) {throw new NotFoundError('Anchor example', input.anchorExampleId);}
    if (anchor.atom_id !== session.atom_id || anchor.dimension !== session.dimension) {
      throw new ValidationError(
        'Anchor atom/dimension не совпадает с сессией',
        [{ path: 'anchorExampleId', message: 'atom/dimension mismatch' }],
      );
    }

    const assessor = await client.query<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
      [input.assessorId],
    );
    if (assessor.rows.length === 0) {
      throw new NotFoundError('Assessor', input.assessorId);
    }

    const id = newUUID();
    try {
      const ins = await client.query<CalibrationAssignmentRow>(
        `INSERT INTO calibration_assignments
           (id, session_id, anchor_example_id, assessor_id)
         VALUES ($1,$2,$3,$4)
         RETURNING id, session_id, anchor_example_id, assessor_id,
                   level, note, created_at, scored_at`,
        [id, input.sessionId, input.anchorExampleId, input.assessorId],
      );
      return toAssignment(ins.rows[0]!);
    } catch (e) {
      // UNIQUE violation = повторное назначение.
      const err = e as { code?: string };
      if (err.code === '23505') {
        throw new ConflictError(
          'Assignment already exists for (session, anchor, assessor)',
        );
      }
      throw e;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Score
// ─────────────────────────────────────────────────────────────────────

export interface ScoreParams {
  assignmentId: UUID;
  level: number;
  note?: string;
}

export async function scoreAssignment(
  actorId: UUID,
  input: ScoreParams,
): Promise<CalibrationAssignment> {
  if (!Number.isInteger(input.level) || input.level < 0 || input.level > 9) {
    throw new ValidationError('level must be integer 0..9');
  }

  return transaction(async (client) => {
    const cur = await client.query<CalibrationAssignmentRow>(
      `SELECT id, session_id, anchor_example_id, assessor_id,
              level, note, created_at, scored_at
         FROM calibration_assignments WHERE id = $1
         FOR UPDATE`,
      [input.assignmentId],
    );
    const row = cur.rows[0];
    if (!row) {throw new NotFoundError('Assignment', input.assignmentId);}

    if (row.assessor_id !== actorId) {
      throw new ForbiddenError('Only the assigned assessor can score this work');
    }
    if (row.level !== null) {
      throw new ConflictError('Assignment already scored');
    }

    const upd = await client.query<CalibrationAssignmentRow>(
      `UPDATE calibration_assignments
          SET level = $2,
              note = $3,
              scored_at = now()
        WHERE id = $1 AND level IS NULL
        RETURNING id, session_id, anchor_example_id, assessor_id,
                  level, note, created_at, scored_at`,
      [input.assignmentId, input.level, input.note ?? null],
    );
    if (upd.rows.length === 0) {
      throw new ConflictError('Assignment already scored');
    }
    return toAssignment(upd.rows[0]!);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────

export async function getSessionReport(
  sessionId: UUID,
): Promise<CalibrationReport | null> {
  const session = await getSession(sessionId);
  if (!session) {return null;}

  const assignRows = await query<CalibrationAssignmentRow & {
    anchor_title: string;
    anchor_level: number;
  }>(
    `SELECT ca.id, ca.session_id, ca.anchor_example_id, ca.assessor_id,
            ca.level, ca.note, ca.created_at, ca.scored_at,
            ae.title AS anchor_title, ae.level AS anchor_level
       FROM calibration_assignments ca
       JOIN anchor_examples ae ON ae.id = ca.anchor_example_id
      WHERE ca.session_id = $1
      ORDER BY ca.anchor_example_id, ca.assessor_id`,
    [sessionId],
  );

  const byWork = new Map<UUID, {
    title: string;
    expectedLevel: number;
    scores: CalibrationWorkReport['scores'];
  }>();

  for (const r of assignRows) {
    const entry = byWork.get(r.anchor_example_id) ?? {
      title: r.anchor_title,
      expectedLevel: r.anchor_level,
      scores: [],
    };
    entry.scores.push({
      assignmentId: r.id,
      assessorId: r.assessor_id,
      level: r.level,
      note: r.note,
      scoredAt: r.scored_at ? r.scored_at.toISOString() : null,
    });
    byWork.set(r.anchor_example_id, entry);
  }

  const works: CalibrationWorkReport[] = [];
  let scoredCount = 0;
  let unscoredCount = 0;
  let flaggedCount = 0;

  for (const [anchorExampleId, entry] of byWork.entries()) {
    const levels = entry.scores
      .map((s) => s.level)
      .filter((v): v is number => v !== null);
    const maxDiff =
      levels.length >= 2
        ? Math.max(...levels) - Math.min(...levels)
        : null;
    const needsThird = maxDiff !== null && maxDiff >= 2;
    if (needsThird) {flaggedCount++;}

    for (const s of entry.scores) {
      if (s.level === null) {unscoredCount++;}
      else {scoredCount++;}
    }

    works.push({
      anchorExampleId,
      title: entry.title,
      expectedLevel: entry.expectedLevel,
      scores: entry.scores,
      maxDiff,
      needsThird,
    });
  }

  const overdue =
    session.deadline !== null &&
    new Date(session.deadline).getTime() < Date.now() &&
    session.status !== 'closed';

  return {
    session,
    works,
    summary: {
      worksCount: works.length,
      scoredCount,
      unscoredCount,
      flaggedCount,
      overdue,
    },
  };
}