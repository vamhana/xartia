// C.0.20.02 — Сервис Хранителей
// Фиксация, архивация, поиск, цепочки, реестр ID, сверка.

import { signContent } from '../../lib/crypto.js';
import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  createDocument, signDocument, addChainStep, rebuildChain,
  registerId, linkGlobalId, crossCheck,
  type ArchiveDocument, type ArchiveDocType, type DecisionChain,
  type IdRegistryEntry, type CrossCheck, type ChainStepType,
} from './entity.js';

const KEEPER_KEY = process.env['KEEPER_HMAC_KEY'] ?? process.env['ENCRYPTION_KEY'] ?? '';

// -------- Документы --------

interface DocRow {
  id: string;
  type: ArchiveDocType;
  direction_id: string;
  subject: string;
  content: Record<string, unknown>;
  version: number;
  signed_by: string | null;
  signature: string | null;
  archived_at: Date;
  created_at: Date;
}

function rowToDoc(row: DocRow): ArchiveDocument {
  return {
    id: row.id,
    type: row.type,
    directionId: row.direction_id,
    subject: row.subject,
    content: row.content,
    version: row.version,
    signedBy: row.signed_by,
    signature: row.signature,
    archivedAt: row.archived_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export interface ArchiveFilter {
  type?: ArchiveDocType;
  directionId?: UUID;
  page?: number;
  perPage?: number;
}

export async function listDocuments(
  filter: ArchiveFilter = {},
): Promise<{ data: ArchiveDocument[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.type) { params.push(filter.type); conditions.push(`type = $${params.length}`); }
  if (filter.directionId) { params.push(filter.directionId); conditions.push(`direction_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM archive_documents ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<DocRow>(
    `SELECT id, type, direction_id, subject, content, version,
            signed_by, signature, archived_at, created_at
       FROM archive_documents ${where}
      ORDER BY archived_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToDoc), total };
}

export async function getDocument(id: UUID): Promise<ArchiveDocument> {
  const row = await queryOne<DocRow>(
    `SELECT id, type, direction_id, subject, content, version,
            signed_by, signature, archived_at, created_at
       FROM archive_documents WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Документ', id);}
  return rowToDoc(row);
}

export interface CreateDocumentRequest {
  type: ArchiveDocType;
  directionId: UUID;
  subject: string;
  content: Record<string, unknown>;
}

export async function archiveService(
  input: CreateDocumentRequest, requesterId: UUID,
): Promise<ArchiveDocument> {
  const entity = createDocument({
    id: newUUID(),
    type: input.type,
    directionId: input.directionId,
    subject: input.subject,
    content: input.content,
  });

  await query(
    `INSERT INTO archive_documents (id, type, direction_id, subject, content, version)
     VALUES ($1, $2, $3, $4, $5::jsonb, 1)`,
    [entity.id, entity.type, entity.directionId, entity.subject, JSON.stringify(entity.content)],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'archive.archive', entityType: 'archive_document', entityId: entity.id,
    newValue: { type: entity.type, subject: entity.subject },
  });
  return entity;
}

// B1: keeperId = auth.participantId из контроллера.
// B4: уже подписан → 409 + атомарный UPDATE ... WHERE signed_by IS NULL.
export async function signDocumentService(
  documentId: UUID, keeperId: UUID,
): Promise<{ document: ArchiveDocument; signature: string }> {
  const doc = await getDocument(documentId);

  // B4: уже подписан → 409.
  if (doc.signedBy !== null) {
    throw new ConflictError('Документ уже подписан');
  }

  const payload = JSON.stringify({ id: doc.id, subject: doc.subject, content: doc.content });
  const signature = signContent(payload, keeperId, KEEPER_KEY);

  // entity-validate (defense-in-depth) + возвращаем обновлённый объект.
  const updated = signDocument(doc, keeperId, signature);

  // B4-atomic: UPDATE ... WHERE signed_by IS NULL.
  const result = await query<{ id: string }>(
    `UPDATE archive_documents
        SET signed_by = $1, signature = $2
      WHERE id = $3 AND signed_by IS NULL
      RETURNING id`,
    [keeperId, signature, documentId],
  );
  if (result.length === 0) {
    throw new ConflictError('Документ уже подписан параллельным запросом');
  }

  await logAction({
    actorId: keeperId, actorType: 'participant',
    action: 'archive.sign', entityType: 'archive_document', entityId: documentId,
  });
  return { document: updated, signature };   // ← updated, не getDocument
}

export async function searchDocuments(query_text: string): Promise<ArchiveDocument[]> {
  const rows = await query<DocRow>(
    `SELECT id, type, direction_id, subject, content, version,
            signed_by, signature, archived_at, created_at
       FROM archive_documents
      WHERE to_tsvector('russian', subject) @@ plainto_tsquery('russian', $1)
      ORDER BY archived_at DESC LIMIT 100`,
    [query_text],
  );
  return rows.map(rowToDoc);
}

// -------- Цепочки --------

interface ChainRow {
  id: string;
  chain_id: string;
  step: number;
  type: ChainStepType;
  ref_id: string;
  description: string;
  created_at: Date;
}

function rowToChain(row: ChainRow): DecisionChain {
  return {
    id: row.id,
    chainId: row.chain_id,
    step: row.step,
    type: row.type,
    refId: row.ref_id,
    description: row.description,
    createdAt: row.created_at.toISOString(),
  };
}

// B3: advisory lock по chain_id — сериализует параллельные addChainStep.
export async function addChainStepService(
  input: { chainId: UUID; type: ChainStepType; refId: UUID; description: string },
  requesterId: UUID,
): Promise<DecisionChain> {
  const nextStep = await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`archive:chain:${input.chainId}`],
    );
    const existing = await client.query<{ step: number }>(
      `SELECT step FROM decision_chains WHERE chain_id = $1 ORDER BY step DESC LIMIT 1`,
      [input.chainId],
    );
    return (existing.rows[0]?.step ?? 0) + 1;
  });

  const entity = addChainStep({
    id: newUUID(),
    chainId: input.chainId,
    step: nextStep,
    type: input.type,
    refId: input.refId,
    description: input.description,
  });

  await query(
    `INSERT INTO decision_chains (id, chain_id, step, type, ref_id, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entity.id, entity.chainId, entity.step, entity.type, entity.refId, entity.description],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'archive.add_chain_step', entityType: 'decision_chain', entityId: entity.id,
    newValue: { chain_id: entity.chainId, step: entity.step, type: entity.type },
  });
  return entity;
}

export async function getChain(chainId: UUID): Promise<DecisionChain[]> {
  const rows = await query<ChainRow>(
    `SELECT id, chain_id, step, type, ref_id, description, created_at
       FROM decision_chains WHERE chain_id = $1 ORDER BY step`,
    [chainId],
  );
  return rows.map(rowToChain);
}

export async function rebuildChainService(
  chainId: UUID,
): Promise<{ valid: boolean; gaps: number[] }> {
  const steps = await getChain(chainId);
  return rebuildChain(steps);
}

// -------- Реестр ID --------

interface IdRow {
  id: string;
  participant_id: string;
  external_id: string;
  community_code: string | null;
  internal_id: string | null;
  global_id: string | null;
  valid_from: Date;
  valid_to: Date | null;
}

function rowToId(row: IdRow): IdRegistryEntry {
  return {
    id: row.id,
    participantId: row.participant_id,
    externalId: row.external_id,
    communityCode: row.community_code,
    internalId: row.internal_id,
    globalId: row.global_id,
    validFrom: row.valid_from.toISOString(),
    validTo: row.valid_to ? row.valid_to.toISOString() : null,
  };
}

// B5: дубль external_id → 409.
export async function registerIdService(
  participantId: UUID, externalId: string, requesterId: UUID,
): Promise<IdRegistryEntry> {
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM id_registry WHERE external_id = $1 AND valid_to IS NULL LIMIT 1`,
    [externalId],
  );
  if (dup) {
    throw new ConflictError(`external_id '${externalId}' уже зарегистрирован`);
  }

  const entity = registerId({ id: newUUID(), participantId, externalId });
  await query(
    `INSERT INTO id_registry (id, participant_id, external_id, valid_from)
     VALUES ($1, $2, $3, now())`,
    [entity.id, entity.participantId, entity.externalId],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'archive.register_id', entityType: 'id_registry', entityId: entity.id,
  });
  return entity;
}

// B6: дубль global_id → 409.
export async function linkGlobalIdService(
  entryId: UUID, communityCode: string, globalId: string, requesterId: UUID,
): Promise<IdRegistryEntry> {
  const row = await queryOne<IdRow>(
    `SELECT id, participant_id, external_id, community_code, internal_id, global_id,
            valid_from, valid_to
       FROM id_registry WHERE id = $1`,
    [entryId],
  );
  if (!row) {throw new NotFoundError('Запись реестра', entryId);}

  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM id_registry WHERE global_id = $1 AND id <> $2 AND valid_to IS NULL LIMIT 1`,
    [globalId, entryId],
  );
  if (dup) {
    throw new ConflictError(`global_id '${globalId}' уже привязан к другой записи`);
  }

  const updated = linkGlobalId(rowToId(row), communityCode, globalId);

  await query(
    `UPDATE id_registry SET community_code = $1, global_id = $2 WHERE id = $3`,
    [updated.communityCode, updated.globalId, entryId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'archive.link_global_id', entityType: 'id_registry', entityId: entryId,
    newValue: { community_code: communityCode, global_id: globalId },
  });
  return updated;
}

export async function listIdRegistry(): Promise<IdRegistryEntry[]> {
  const rows = await query<IdRow>(
    `SELECT id, participant_id, external_id, community_code, internal_id, global_id,
            valid_from, valid_to
       FROM id_registry ORDER BY valid_from DESC LIMIT 500`,
  );
  return rows.map(rowToId);
}

// -------- Сверка --------

// B2: стабильная сериализация (сортировка ключей рекурсивно).
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {return JSON.stringify(obj);}
  if (Array.isArray(obj)) {return '[' + obj.map(stableStringify).join(',') + ']';}
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',') + '}';
}

export async function crossCheckService(
  docAId: UUID, docBId: UUID, requesterId: UUID,
): Promise<CrossCheck> {
  if (docAId === docBId) {throw new ValidationError('Документы должны различаться');}
  const [a, b] = await Promise.all([getDocument(docAId), getDocument(docBId)]);

  const discrepancies: Record<string, unknown> = {};
  if (a.subject !== b.subject) {
    discrepancies['subject'] = { a: a.subject, b: b.subject };
  }
  // B2: стабильная сериализация.
  if (stableStringify(a.content) !== stableStringify(b.content)) {
    discrepancies['content'] = 'различается';
  }

  const id = newUUID();
  const result = crossCheck(id, docAId, docBId, discrepancies);
  await query(
    `INSERT INTO cross_checks (id, document_a_id, document_b_id, discrepancies)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [id, docAId, docBId, JSON.stringify(discrepancies)],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'archive.cross_check', entityType: 'cross_check', entityId: id,
    newValue: { document_a: docAId, document_b: docBId, has_discrepancies: Object.keys(discrepancies).length > 0 },
  });

  if (Object.keys(discrepancies).length > 0) {
    // Сигнал в Верификацию и Балансировку (I.4.14)
    await logAction({
      actorId: requesterId, actorType: 'system',
      action: 'archive.cross_check.discrepancy_signal', entityType: 'cross_check', entityId: id,
      newValue: { for: ['verification', 'balance'] },
    });
  }
  return result;
}

// -------- Защита Хранителя --------

// B7: получаем direction_id Хранителя — чтобы сигнал не «висел».
export async function reportPressureService(
  keeperId: UUID, description: string,
): Promise<{ signalId: UUID }> {
  if (!description.trim()) {throw new ConflictError('Описание обязательно');}

  const keeper = await queryOne<{ direction_id: string | null }>(
    `SELECT direction_id FROM participants WHERE id = $1`,
    [keeperId],
  );

  const { createSignalService } = await import('../signals/service.js');
  const signal = await createSignalService({
    type: 'problem',
    description: `Сигнал давления на Хранителя: ${description}`,
    justification: 'Защита Хранителя — I.3.5.9',
    priority: 'high',
    ...(keeper?.direction_id ? { leadDirectionId: keeper.direction_id } : {}),
  }, keeperId);
  return { signalId: signal.id };
}