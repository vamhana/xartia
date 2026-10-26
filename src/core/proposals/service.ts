// C.0.10.10 — Предложения изменений ядра (RFC).
//
// Цикл: draft → discussion (дедлайн) → agreed/rejected →
// implementing → accepted. Возражения типизированы и должны быть
// закрыты до принятия. Решение хранит обоснование; влияние — список
// инвариантов, которые затрагивает изменение.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { hasRole } from '../../security/rbac.js';
import { Role } from '../roles.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

export type ProposalType = 'module' | 'rule' | 'meta' | 'charter';
export type ProposalStatus =
  | 'draft' | 'discussion' | 'agreed' | 'rejected'
  | 'withdrawn' | 'implementing' | 'accepted' | 'reverted';
export type ObjectionKind = 'factual' | 'conceptual' | 'compatibility';

export interface Invariant {
  id: string;
  statement: string;
  module: string;
  testPath: string;
  status: string;
}

export interface ProposalImpact {
  invariantId: string;
  changeKind: string;
  migrationNote: string | null;
}

export interface ProposalSummary {
  id: UUID;
  type: ProposalType;
  title: string;
  status: ProposalStatus;
  authorId: UUID;
  deadline: string | null;
  prUrl: string | null;
  createdAt: string;
  impactCount: number;
  openObjections: number;
}

export interface Proposal extends ProposalSummary {
  problem: string;
  proposal: string;
  alternatives: string | null;
  discussionUrl: string | null;
  updatedAt: string;
  impacts: ProposalImpact[];
  objections: Array<{
    id: UUID; authorId: UUID; kind: ObjectionKind; text: string;
    status: string; resolution: string | null; createdAt: string;
  }>;
  decisions: Array<{
    id: UUID; decidedBy: UUID; method: string; outcome: string;
    rationale: string; createdAt: string;
  }>;
  events: Array<{
    fromStatus: string | null; toStatus: string; actorId: UUID | null;
    note: string | null; createdAt: string;
  }>;
}

const TYPES: ProposalType[] = ['module', 'rule', 'meta', 'charter'];
const KINDS: ObjectionKind[] = ['factual', 'conceptual', 'compatibility'];

export async function listInvariants(): Promise<Invariant[]> {
  const rows = await query<{
    id: string; statement: string; module: string; test_path: string; status: string;
  }>(
    `SELECT id, statement, module, test_path, status
       FROM invariants WHERE status = 'active' ORDER BY id`,
  );
  return rows.map((r) => ({
    id: r.id,
    statement: r.statement,
    module: r.module,
    testPath: r.test_path,
    status: r.status,
  }));
}

async function isDecider(participantId: UUID): Promise<boolean> {
  return await hasRole(participantId, Role.FIRST_ARCHITECT)
    || await hasRole(participantId, Role.COUNCIL_MEMBER);
}

async function getRaw(id: UUID) {
  const row = await queryOne<{
    id: string; type: string; title: string; problem: string; proposal: string;
    alternatives: string | null; status: string; author_id: string;
    discussion_url: string | null; deadline: Date | null; pr_url: string | null;
    created_at: Date; updated_at: Date;
  }>(`SELECT * FROM proposals WHERE id = $1`, [id]);
  if (!row) {throw new NotFoundError('Предложение', id);}
  return row;
}

export async function getProposal(id: UUID): Promise<Proposal> {
  const row = await getRaw(id);
  const impacts = await query<{ invariant_id: string; change_kind: string; migration_note: string | null }>(
    `SELECT invariant_id, change_kind, migration_note FROM proposal_impacts WHERE proposal_id = $1`,
    [id],
  );
  const objections = await query<{
    id: string; author_id: string; kind: string; text: string;
    status: string; resolution: string | null; created_at: Date;
  }>(`SELECT * FROM proposal_objections WHERE proposal_id = $1 ORDER BY created_at`, [id]);
  const decisions = await query<{
    id: string; decided_by: string; method: string; outcome: string;
    rationale: string; created_at: Date;
  }>(`SELECT * FROM proposal_decisions WHERE proposal_id = $1 ORDER BY created_at`, [id]);
  const events = await query<{
    from_status: string | null; to_status: string; actor_id: string | null;
    note: string | null; created_at: Date;
  }>(`SELECT * FROM proposal_events WHERE proposal_id = $1 ORDER BY created_at`, [id]);

  return {
    id: row.id,
    type: row.type as ProposalType,
    title: row.title,
    problem: row.problem,
    proposal: row.proposal,
    alternatives: row.alternatives,
    status: row.status as ProposalStatus,
    authorId: row.author_id,
    discussionUrl: row.discussion_url,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    prUrl: row.pr_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    impactCount: impacts.length,
    openObjections: objections.filter((o) => o.status === 'open').length,
    impacts: impacts.map((i) => ({
      invariantId: i.invariant_id,
      changeKind: i.change_kind,
      migrationNote: i.migration_note,
    })),
    objections: objections.map((o) => ({
      id: o.id,
      authorId: o.author_id,
      kind: o.kind as ObjectionKind,
      text: o.text,
      status: o.status,
      resolution: o.resolution,
      createdAt: o.created_at.toISOString(),
    })),
    decisions: decisions.map((d) => ({
      id: d.id,
      decidedBy: d.decided_by,
      method: d.method,
      outcome: d.outcome,
      rationale: d.rationale,
      createdAt: d.created_at.toISOString(),
    })),
    events: events.map((e) => ({
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actorId: e.actor_id,
      note: e.note,
      createdAt: e.created_at.toISOString(),
    })),
  };
}

export async function listProposals(filter: {
  status?: string;
  type?: string;
  authorId?: UUID;
} = {}): Promise<ProposalSummary[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {params.push(filter.status); where.push(`p.status = $${params.length}`);}
  if (filter.type) {params.push(filter.type); where.push(`p.type = $${params.length}`);}
  if (filter.authorId) {params.push(filter.authorId); where.push(`p.author_id = $${params.length}`);}

  const rows = await query<{
    id: string; type: string; title: string; status: string; author_id: string;
    deadline: Date | null; pr_url: string | null; created_at: Date;
    impacts: string; open_objections: string;
  }>(
    `SELECT p.id, p.type, p.title, p.status, p.author_id, p.deadline, p.pr_url, p.created_at,
            (SELECT COUNT(*) FROM proposal_impacts i WHERE i.proposal_id = p.id)::text AS impacts,
            (SELECT COUNT(*) FROM proposal_objections o
              WHERE o.proposal_id = p.id AND o.status = 'open')::text AS open_objections
       FROM proposals p
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.created_at DESC
      LIMIT 200`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    type: r.type as ProposalType,
    title: r.title,
    status: r.status as ProposalStatus,
    authorId: r.author_id,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    prUrl: r.pr_url,
    createdAt: r.created_at.toISOString(),
    impactCount: parseInt(r.impacts, 10),
    openObjections: parseInt(r.open_objections, 10),
  }));
}

export async function createProposal(
  input: {
    type: string;
    title: string;
    problem: string;
    proposal: string;
    alternatives?: string | null;
    discussionUrl?: string | null;
    invariants?: string[];
    breaking?: boolean;
  },
  authorId: UUID,
): Promise<Proposal> {
  if (!TYPES.includes(input.type as ProposalType)) {
    throw new ValidationError('Тип: module, rule, meta или charter');
  }
  const title = input.title.trim();
  if (title.length < 5 || title.length > 255) {throw new ValidationError('Заголовок: 5..255 символов');}
  if (input.problem.trim().length < 20) {throw new ValidationError('Проблема: минимум 20 символов');}
  if (input.proposal.trim().length < 20) {throw new ValidationError('Предложение: минимум 20 символов');}

  const ids = [...new Set(input.invariants ?? [])];
  if (ids.length > 0) {
    const found = await query<{ id: string }>(
      `SELECT id FROM invariants WHERE id = ANY($1::text[]) AND status = 'active'`,
      [ids],
    );
    const known = new Set(found.map((f) => f.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new ValidationError(`Неизвестные инварианты: ${unknown.join(', ')}`);
    }
  }

  const id = newUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO proposals
         (id, type, title, problem, proposal, alternatives, author_id, discussion_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, input.type, title, input.problem.trim(), input.proposal.trim(),
       input.alternatives?.trim() ?? null, authorId, input.discussionUrl ?? null],
    );
    for (const invariantId of ids) {
      await client.query(
        `INSERT INTO proposal_impacts (proposal_id, invariant_id, change_kind)
         VALUES ($1,$2,$3)
         ON CONFLICT (proposal_id, invariant_id) DO NOTHING`,
        [id, invariantId, input.breaking ? 'breaking' : 'additive'],
      );
    }
    await client.query(
      `INSERT INTO proposal_events (proposal_id, to_status, actor_id, note)
       VALUES ($1,'draft',$2,'Создано')`,
      [id, authorId],
    );
  });

  await logAction({
    actorId: authorId, actorType: 'participant',
    action: 'proposal.created', entityType: 'proposal', entityId: id,
    newValue: { type: input.type, title },
  });

  return getProposal(id);
}

export async function startDiscussion(
  id: UUID,
  days: number,
  actorId: UUID,
): Promise<Proposal> {
  const row = await getRaw(id);
  if (row.status !== 'draft') {throw new ConflictError(`Предложение в статусе ${row.status}`);}
  if (row.author_id !== actorId && !(await isDecider(actorId))) {
    throw new ForbiddenError('Начать обсуждение может автор или Совет/Архитектор');
  }
  const deadline = new Date(Date.now() + Math.max(1, Math.min(30, days)) * 86_400_000);

  await transaction(async (client) => {
    await client.query(
      `UPDATE proposals SET status='discussion', deadline=$2, updated_at=now() WHERE id=$1`,
      [id, deadline],
    );
    await client.query(
      `INSERT INTO proposal_events (proposal_id, from_status, to_status, actor_id, note)
       VALUES ($1,'draft','discussion',$2,$3)`,
      [id, actorId, `Дедлайн ${deadline.toISOString().slice(0, 10)}`],
    );
  });

  return getProposal(id);
}

export async function addObjection(
  id: UUID,
  input: { kind: string; text: string },
  actorId: UUID,
): Promise<Proposal> {
  const row = await getRaw(id);
  if (row.status !== 'discussion') {
    throw new ConflictError('Возражения принимаются только на стадии обсуждения');
  }
  if (row.author_id === actorId) {
    throw new ForbiddenError('Нельзя возражать самому себе');
  }
  if (!KINDS.includes(input.kind as ObjectionKind)) {
    throw new ValidationError('Тип возражения: factual, conceptual или compatibility');
  }
  if (input.text.trim().length < 10) {throw new ValidationError('Возражение: минимум 10 символов');}

  await query(
    `INSERT INTO proposal_objections (id, proposal_id, author_id, kind, text)
     VALUES ($1,$2,$3,$4,$5)`,
    [newUUID(), id, actorId, input.kind, input.text.trim()],
  );
  return getProposal(id);
}

export async function resolveObjection(
  id: UUID,
  objectionId: UUID,
  input: { status: 'addressed' | 'rejected'; resolution: string },
  actorId: UUID,
): Promise<Proposal> {
  const row = await getRaw(id);
  if (row.author_id !== actorId && !(await isDecider(actorId))) {
    throw new ForbiddenError('Закрыть возражение может автор или Совет/Архитектор');
  }
  if (!['addressed', 'rejected'].includes(input.status)) {
    throw new ValidationError('Статус возражения: addressed или rejected');
  }
  if (input.resolution.trim().length < 5) {
    throw new ValidationError('Ответ на возражение: минимум 5 символов');
  }
  const updated = await query<{ id: string }>(
    `UPDATE proposal_objections
        SET status=$3, resolution=$4, resolved_at=now()
      WHERE id=$1 AND proposal_id=$2 AND status='open'
      RETURNING id`,
    [objectionId, id, input.status, input.resolution.trim()],
  );
  if (updated.length === 0) {throw new ConflictError('Возражение не найдено или уже закрыто');}
  return getProposal(id);
}

export async function decideProposal(
  id: UUID,
  input: { outcome: 'accepted' | 'rejected'; rationale: string; method?: string },
  actorId: UUID,
): Promise<Proposal> {
  if (!(await isDecider(actorId))) {
    throw new ForbiddenError('Решение принимает Совет направления или Архитектор');
  }
  const row = await getRaw(id);
  if (row.status !== 'discussion') {
    throw new ConflictError(`Предложение в статусе ${row.status}`);
  }
  if (input.rationale.trim().length < 20) {
    throw new ValidationError('Обоснование решения: минимум 20 символов');
  }

  if (input.outcome === 'accepted') {
    const open = await query<{ id: string }>(
      `SELECT id FROM proposal_objections WHERE proposal_id=$1 AND status='open'`,
      [id],
    );
    if (open.length > 0) {
      throw new ConflictError(
        `Есть открытые возражения (${open.length}). Ответьте на них до принятия.`,
      );
    }
    const impacts = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM proposal_impacts WHERE proposal_id=$1`,
      [id],
    );
    if (parseInt(impacts?.c ?? '0', 10) === 0) {
      throw new ConflictError('Не указано влияние на инварианты — принять нельзя');
    }
  }

  const nextStatus = input.outcome === 'accepted' ? 'agreed' : 'rejected';
  await transaction(async (client) => {
    await client.query(
      `UPDATE proposals SET status=$2, updated_at=now() WHERE id=$1`,
      [id, nextStatus],
    );
    await client.query(
      `INSERT INTO proposal_decisions (id, proposal_id, decided_by, method, outcome, rationale)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [newUUID(), id, actorId, input.method ?? 'council', input.outcome, input.rationale.trim()],
    );
    await client.query(
      `INSERT INTO proposal_events (proposal_id, from_status, to_status, actor_id, note)
       VALUES ($1,'discussion',$2,$3,$4)`,
      [id, nextStatus, actorId, input.rationale.trim()],
    );
  });

  await logAction({
    actorId, actorType: 'participant',
    action: 'proposal.decided', entityType: 'proposal', entityId: id,
    newValue: { outcome: input.outcome },
  });

  return getProposal(id);
}

export async function markImplemented(
  id: UUID,
  prUrl: string,
  actorId: UUID,
): Promise<Proposal> {
  const row = await getRaw(id);
  if (row.status !== 'agreed') {throw new ConflictError(`Предложение в статусе ${row.status}`);}
  if (!/^https?:\/\//.test(prUrl)) {throw new ValidationError('PR: нужен http(s)-URL');}
  await transaction(async (client) => {
    await client.query(
      `UPDATE proposals SET status='implementing', pr_url=$2, updated_at=now() WHERE id=$1`,
      [id, prUrl],
    );
    await client.query(
      `INSERT INTO proposal_events (proposal_id, from_status, to_status, actor_id, note)
       VALUES ($1,'agreed','implementing',$2,$3)`,
      [id, actorId, prUrl],
    );
  });
  return getProposal(id);
}

export async function acceptImplementation(id: UUID, actorId: UUID): Promise<Proposal> {
  const row = await getRaw(id);
  if (row.status !== 'implementing') {
    throw new ConflictError(`Предложение в статусе ${row.status}`);
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE proposals SET status='accepted', updated_at=now() WHERE id=$1`,
      [id],
    );
    await client.query(
      `INSERT INTO proposal_events (proposal_id, from_status, to_status, actor_id)
       VALUES ($1,'implementing','accepted',$2)`,
      [id, actorId],
    );
  });
  return getProposal(id);
}

export async function withdrawProposal(id: UUID, actorId: UUID): Promise<Proposal> {
  const row = await getRaw(id);
  if (!['draft', 'discussion'].includes(row.status)) {
    throw new ConflictError(`Нельзя отозвать в статусе ${row.status}`);
  }
  if (row.author_id !== actorId && !(await isDecider(actorId))) {
    throw new ForbiddenError('Отозвать может автор или Совет/Архитектор');
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE proposals SET status='withdrawn', updated_at=now() WHERE id=$1`,
      [id],
    );
    await client.query(
      `INSERT INTO proposal_events (proposal_id, from_status, to_status, actor_id)
       VALUES ($1,$2,'withdrawn',$3)`,
      [id, row.status, actorId],
    );
  });
  return getProposal(id);
}

/** Пометить просроченные обсуждения (ровно один раз) и вернуть их число. */
export async function flagOverdueProposals(): Promise<number> {
  const rows = await query<{ id: string }>(
    `SELECT p.id
       FROM proposals p
      WHERE p.status = 'discussion'
        AND p.deadline IS NOT NULL
        AND p.deadline < now()
        AND NOT EXISTS (
          SELECT 1 FROM proposal_events e
           WHERE e.proposal_id = p.id AND e.note = 'Дедлайн истёк'
        )
      LIMIT 100`,
  );
  for (const row of rows) {
    await query(
      `INSERT INTO proposal_events (proposal_id, from_status, to_status, note)
       VALUES ($1, 'discussion', 'discussion', 'Дедлайн истёк')`,
      [row.id],
    );
  }
  return rows.length;
}
