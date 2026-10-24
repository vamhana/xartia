// C.0.02.02 — Сервис участников
// Оркестрирует создание, изменение, паспорт, паузу, смену направления.
// Работает с БД через L.0.01.09. Проверяет права через C.0.01.06.
// Пишет аудит через C.0.01.05. Кэширует паспорта в Redis.
//
// PRIVACY POLICY (по решению Архитектора, 2026-10-15):
//   - Полный паспорт (включая phone, messengers) доступен всем
//     авторизованным участникам.
//   - Список участников доступен всем.
//   - Кэш в Redis хранит ParticipantRow с ЗАШИФРОВАННЫМ phone (не plaintext).
//
// RECOVERY (флоу B, S.0.01.04):
//   - Токен восстановления уходит участнику ТОЛЬКО через мессенджер.
//   - В БД хранится только SHA-256 хеш токена.
//
// v0.0.03:
//   - P1: verifyCredentials — verifyPassword в try/catch (битый hash →
//     UnauthorizedError, а не 500); logAction best-effort (сбой audit
//     не маскирует 401/200).
//   - P2: approveRecoveryRequest — sendNotification в try/catch с
//     откатом status='pending'; при сбое — AppError 503. Иначе заявка
//     становится 'approved' с токеном только в памяти, восстановление
//     невозможно.
//   - P3: register — catch 23505 от partial UNIQUE
//     uniq_registration_phone_hash_active → ConflictError. Убран ложный
//     комментарий «phone_hash НЕ UNIQUE».
//   - P10: auth.login.failed — reason внутри newValue (схема audit_log).
//   - P13: ApproveRecoveryResult.toJSON() — бросает, защита от случайной
//     сериализации токена в логи/JSON.

import { randomBytes } from 'node:crypto';

import { hash as sha256Hex } from '../../lib/crypto.js';
import { query, queryOne, isUniqueViolation, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { send as sendNotification } from '../../lib/notifications.js';
import { redis } from '../../lib/redis.js';
import { encryptField, decryptField, hashForSearch } from '../../security/encryption.js';
import { revokeAllForParticipant } from '../../security/jwt.js';
import { hashPassword, verifyPassword } from '../../security/password.js';
import { listParticipantsWithRole } from '../../security/rbac.js';
import { emitInterviewEnded } from '../../ws/interview.js';
import { logAction } from '../audit.js';
import { WELCOME_PACK } from '../constants.js';
import {
  AppError, ConflictError, ForbiddenError, NotFoundError,
  UnauthorizedError, ValidationError,
} from '../errors.js';
import { Role } from '../roles.js';
import type { UUID, ISODateTime, RegistrationStatus } from '../types.js';

import { createParticipant, type Participant } from './entity.js';

// -------- Уведомления пути участника --------
//
// Заявка — не «строчка в таблице», а событие для четырёх функций Хартии:
//   инкубация (направление 11) проводит аудит и подбирает направление и
//   наставника; балансировка учитывает +1 заявку; ноология проверяет, те ли
//   вопросы задаёт инкубация; верификация — не бот ли регистрируется.
// Если у функции в нужном направлении никого нет — пишем Первому Архитектору,
// чтобы заявка не висела без ответа (I.2.12: «нет влияния» — тоже нарушение).

interface FunctionNotice {
  role: Role;
  directionNumber: number | null;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

async function recipientsFor(role: Role, directionNumber: number | null): Promise<UUID[]> {
  if (directionNumber === null) {
    const all = await listParticipantsWithRole(role);
    if (all.length > 0) {return all;}
  } else {
    const dir = await queryOne<{ id: string }>(
      `SELECT id FROM directions WHERE number = $1 AND status = 'active'`,
      [directionNumber],
    );
    const ids = dir ? await listParticipantsWithRole(role, dir.id) : [];
    if (ids.length > 0) {return ids;}
  }
  // Фолбэк: Первый Архитектор — не «начальник», а гарант, что процедура
  // не встанет, если функция ещё не занята.
  return listParticipantsWithRole(Role.FIRST_ARCHITECT);
}

async function deliver(notice: FunctionNotice): Promise<void> {
  try {
    const recipients = await recipientsFor(notice.role, notice.directionNumber);
    for (const recipientId of recipients) {
      await sendNotification({
        recipientId,
        type: notice.type,
        priority: 'standard',
        title: notice.title,
        body: notice.body,
        data: notice.data,
      });
    }
  } catch (e) {
    // Уведомление — побочный эффект: сбой не отменяет регистрацию.
    logger.warn({ err: e, type: notice.type }, 'journey notification failed');
  }
}

/** Событие «новая заявка» → четыре функции + балансировка. */
async function notifyRegistration(requestId: UUID): Promise<void> {
  const data = { requestId, link: '/admin/requests' };
  await deliver({
    role: Role.COUNCIL_MEMBER,
    directionNumber: 11, // Социальная Инкубация
    type: 'registration.incubation',
    title: 'Новая заявка: нужен аудит',
    body: 'Проведите аудит заявки, подберите направление и наставника.',
    data,
  });
  await deliver({
    role: Role.BALANCER,
    directionNumber: null,
    type: 'registration.balancing',
    title: 'Новая заявка в системе',
    body: 'Учтите заявку в балансе: +1 кандидат.',
    data,
  });
  await deliver({
    role: Role.NOOLOG,
    directionNumber: 6, // Ноология
    type: 'registration.noology',
    title: 'Проверка вопросов инкубации',
    body: 'Проверьте, правильные ли вопросы задаёт инкубация по этой заявке.',
    data,
  });
  await deliver({
    role: Role.VERIFIER,
    directionNumber: 13, // Верификация и Надёжность
    type: 'registration.verification',
    title: 'Проверка регистрации',
    body: 'Проверьте, не бот ли регистрируется (доступ к аудиту — у верификации).',
    data,
  });
}

/** Событие «человек принят» → куратору направления и балансировке. */
async function notifyAccepted(participant: Participant): Promise<void> {
  try {
    const dir = participant.directionId
      ? await queryOne<{ number: number; name: string }>(
          `SELECT number, name FROM directions WHERE id = $1`,
          [participant.directionId],
        )
      : null;
    const data = {
      participantId: participant.id,
      link: `/admin/participants?selected=${participant.id}`,
    };
    if (participant.directionId) {
      const council = await listParticipantsWithRole(Role.COUNCIL_MEMBER, participant.directionId);
      for (const recipientId of council) {
        await sendNotification({
          recipientId,
          type: 'participant.accepted',
          priority: 'standard',
          title: 'Новый участник в направлении',
          body: `${participant.name} (${participant.externalId}) принят. Назначьте наставника.`,
          data,
        });
      }
    }
    await deliver({
      role: Role.BALANCER,
      directionNumber: null,
      type: 'participant.balancing',
      title: 'Участник принят',
      body: `${participant.name} (${participant.externalId}) вошёл в контур${dir ? ` направления ${dir.number}` : ''}.`,
      data,
    });
  } catch (e) {
    logger.warn({ err: e, participantId: participant.id }, 'accepted notification failed');
  }
}

// -------- Публичные типы --------

export interface RegisterInput {
  phone: string;
  messengers: Record<string, string>;
  password: string;
  consentVideo: boolean;
  consentData: boolean;
}

export interface RegisterResult {
  requestId: UUID;
  status: RegistrationStatus;
}

export interface CreateFromRequestInput {
  requestId: UUID;
  interviewerId: UUID;
  directionId: UUID;
  directionNumber: number;
  professionId: UUID | null;
  wave: string;
  waveNumber: number;
  name: string;
  pseudonym?: string | null;
  subdirection?: string;
  status?: Participant['status'];
}

export interface CreateFromRequestResult {
  participant: Participant;
  /**
   * Временный пароль, выданный участнику при создании из заявки.
   * Возвращается ОДИН раз — Архитектор передаёт его лично/через мессенджер.
   * В БД лежит только argon2-хеш.
   */
  temporaryPassword: string;
}

export interface RegistrationRequestItem {
  id: UUID;
  status: RegistrationStatus;
  /** Телефон в маске: видны первые 4 и последние 2 цифры. */
  phoneMasked: string;
  messengers: Record<string, string>;
  assignedTo: UUID | null;
  interviewAt: ISODateTime | null;
  notes: string | null;
  consentVideo: boolean;
  consentData: boolean;
  createdAt: ISODateTime;
}

export interface ListRegistrationRequestsFilter {
  statuses?: RegistrationStatus[];
  page?: number;
  perPage?: number;
}

export interface LoginResult {
  participant: Participant;
  sessionId: UUID;
}

export interface PassportFull extends Participant {
  direction: { id: UUID; number: number; name: string } | null;
  profession: { id: UUID; name: string } | null;
  roles: Array<{ name: string; directionId: UUID | null; validTo: ISODateTime | null }>;
  mentorExternalId: string | null;
}

export interface ParticipantFilter {
  directionId?: UUID;
  status?: Participant['status'];
  page?: number;
  perPage?: number;
}

export interface ProfilePatch {
  pseudonym?: string | null;
  messengers?: Record<string, string>;
  geoEnabled?: boolean;
}

// -------- Recovery (флоу B) — публичные типы --------

export interface CreateRecoveryRequestInput {
  phone: string;
  requestedIp?: string;
}

export interface CreateRecoveryRequestResult {
  requestId: UUID;
  status: 'pending';
}

/**
 * Результат approve. Токен живёт в памяти только до возврата из сервиса.
 *
 * P13: поле token — секрет. `toJSON()` бросает, чтобы случайный
 * `logger.info({ result })` или `JSON.stringify(result)` не утёк токен.
 * Явный `result.token` для dev-режима (ALLOW_DEV_TOKEN) — работает.
 */
export interface ApproveRecoveryResult {
  requestId: UUID;
  expiresAt: ISODateTime;
  deliveredVia: string[];
  /** Секрет. Отдавать наружу только при ALLOW_DEV_TOKEN=true. */
  token: string;
  toJSON(): never;
}

// -------- Внутренние типы --------

interface ParticipantRow {
  id: string; external_id: string; name: string; pseudonym: string | null;
  phone: string; messengers: Record<string, string> | string;
  direction_id: string; subdirection: string | null; profession_id: string | null;
  status: Participant['status']; profile_risk: Participant['profileRisk'];
  mentor_id: string | null; cell_id: string | null;
  geo_enabled: boolean; entered_at: Date; welcome_pack_given: boolean;
  is_first_architect: boolean; created_at: Date; updated_at: Date;
}

function rowToParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    pseudonym: row.pseudonym,
    phone: row.phone,
    messengers: typeof row.messengers === 'string'
      ? JSON.parse(row.messengers) as Record<string, string>
      : row.messengers,
    directionId: row.direction_id,
    subdirection: row.subdirection,
    professionId: row.profession_id,
    status: row.status,
    profileRisk: row.profile_risk,
    mentorId: row.mentor_id,
    cellId: row.cell_id,
    geolocation: null,
    geoEnabled: row.geo_enabled,
    enteredAt: row.entered_at.toISOString(),
    welcomePackGiven: row.welcome_pack_given,
    isFirstArchitect: row.is_first_architect,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// -------- Регистрация и логин --------

export async function register(input: RegisterInput): Promise<RegisterResult> {
  if (!input.consentVideo || !input.consentData) {
    throw new ValidationError('Необходимо согласие на обработку видео и данных');
  }

  const phoneHash = hashForSearch(input.phone);

  // Терминальные статусы: rejected НЕ блокирует повторную регистрацию.
  // Все остальные статусы — блокируют.
  const existingRequest = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM registration_requests
      WHERE phone_hash = $1
        AND status <> 'rejected'
      LIMIT 1`,
    [phoneHash],
  );
  if (existingRequest) {
    throw new ConflictError('Заявка с таким телефоном уже существует', {
      requestId: existingRequest.id,
      status: existingRequest.status,
    });
  }

  const existingParticipant = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE phone_hash = $1 AND deleted_at IS NULL LIMIT 1`,
    [phoneHash],
  );
  if (existingParticipant) {
    throw new ConflictError('Участник с таким телефоном уже зарегистрирован');
  }

  const requestId = newUUID();
  const encryptedPhone = encryptField(input.phone);

  // P3: partial UNIQUE uniq_registration_phone_hash_active ловит гонку
  // двух параллельных register с одним phone_hash. Без этого оба проходят
  // pre-check и создают две pending-заявки.
  try {
    await query(
      `INSERT INTO registration_requests
         (id, phone, phone_hash, messengers, status, consent_video, consent_data)
       VALUES ($1, $2, $3, $4, 'new', $5, $6)`,
      [
        requestId,
        encryptedPhone,
        phoneHash,
        JSON.stringify(input.messengers),
        input.consentVideo,
        input.consentData,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError('Активная заявка на этот телефон уже существует');
    }
    throw e;
  }

  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'auth.register',
    entityType: 'registration_request',
    entityId: requestId,
    newValue: { phone_hash: phoneHash.slice(0, 8), messengers: Object.keys(input.messengers) },
  });

  // Заявка уходит четырём функциям: инкубация, балансировка, ноология,
  // верификация. Фолбэк — Первый Архитектор.
  await notifyRegistration(requestId);

  return { requestId, status: 'new' };
}

export async function getRegistrationStatus(requestId: UUID): Promise<{
  requestId: UUID;
  status: RegistrationStatus;
  interviewAt: ISODateTime | null;
}> {
  const row = await queryOne<{
    id: string;
    status: RegistrationStatus;
    interview_at: Date | null;
  }>(
    `SELECT id, status, interview_at
       FROM registration_requests
      WHERE id = $1`,
    [requestId],
  );
  if (!row) {throw new NotFoundError('Заявка', requestId);}
  return {
    requestId: row.id,
    status: row.status,
    interviewAt: row.interview_at ? row.interview_at.toISOString() : null,
  };
}

export async function verifyCredentials(
  phone: string,
  password: string,
): Promise<LoginResult> {
  const phoneHash = hashForSearch(phone);

  const row = await queryOne<ParticipantRow & { password_hash: string }>(
    `SELECT id, external_id, name, pseudonym, phone, messengers,
            direction_id, subdirection, profession_id, status, profile_risk,
            mentor_id, cell_id, geo_enabled, entered_at, welcome_pack_given,
            is_first_architect, created_at, updated_at, password_hash
       FROM participants
      WHERE phone_hash = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [phoneHash],
  );

  if (!row) {
    // Не раскрываем, что именно неверно — защита от enumeration
    throw new UnauthorizedError('Неверный телефон или пароль', 'INVALID_TOKEN');
  }

  // P1: битый password_hash (например, 'placeholder' из smoke-bootstrap)
  // даёт throw из verifyPassword. Не маскируем под 500 — это auth-путь,
  // отдаём 401. Логируем на error для диагностики.
  let ok: boolean;
  try {
    ok = await verifyPassword(password, row.password_hash);
  } catch (e) {
    logger.error(
      { err: e, participantId: row.id },
      'verifyPassword threw — corrupt hash',
    );
    throw new UnauthorizedError('Неверный телефон или пароль', 'INVALID_TOKEN');
  }

  if (!ok) {
    // P1 + P10: audit — best-effort, reason внутри newValue (схема audit_log).
    try {
      await logAction({
        actorId: row.id,
        actorType: 'participant',
        action: 'auth.login.failed',
        entityType: 'participant',
        entityId: row.id,
        newValue: { reason: 'wrong_password' },
      });
    } catch (e) {
      logger.warn(
        { err: e, participantId: row.id },
        'audit failed on auth.login.failed',
      );
    }
    throw new UnauthorizedError('Неверный телефон или пароль', 'INVALID_TOKEN');
  }

  const participant = rowToParticipant({ ...row, phone: decryptField(row.phone) });
  const sessionId = newUUID();

  // P1: audit — best-effort, не маскируем 200 под 500 при сбое audit.
  try {
    await logAction({
      actorId: participant.id,
      actorType: 'participant',
      action: 'auth.login',
      entityType: 'participant',
      entityId: participant.id,
    });
  } catch (e) {
    logger.warn(
      { err: e, participantId: participant.id },
      'audit failed on auth.login',
    );
  }

  return { participant, sessionId };
}

// -------- Создание участника из заявки --------

export async function createFromRequest(
  input: CreateFromRequestInput,
): Promise<CreateFromRequestResult> {
  const pre = await queryOne<{
    id: string;
    phone: string;
    messengers: Record<string, string>;
  }>(
    `SELECT id, phone, messengers
       FROM registration_requests
      WHERE id = $1
      LIMIT 1`,
    [input.requestId],
  );
  if (!pre) {throw new NotFoundError('Заявка', input.requestId);}

  const plainPhone = decryptField(pre.phone);
  const tempPassword = newUUID().slice(0, 16);
  const passwordHash = await hashPassword(tempPassword);
  const phoneHash = hashForSearch(plainPhone);

  const participantId = newUUID();

  const entity = createParticipant({
    id: participantId,
    wave: input.wave,
    waveNumber: input.waveNumber,
    directionNumber: input.directionNumber,
    ...(input.subdirection ? { subdirection: input.subdirection } : {}),
    name: input.name,
    ...(input.pseudonym !== undefined ? { pseudonym: input.pseudonym } : {}),
    phone: plainPhone,
    messengers: pre.messengers,
    directionId: input.directionId,
    professionId: input.professionId,
    ...(input.status ? { status: input.status } : {}),
  });

  await transaction(async (client) => {
    const lockedRes = await client.query<{
      id: string;
      status: RegistrationStatus;
    }>(
      `SELECT id, status
         FROM registration_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.requestId],
    );
    const locked = lockedRes.rows[0];
    if (!locked) {throw new NotFoundError('Заявка', input.requestId);}
    if (locked.status === 'accepted') {
      throw new ConflictError('Заявка уже принята');
    }

    await client.query(
      `INSERT INTO participants
         (id, external_id, wave_letter, wave_number, direction_id, subdirection,
          profession_id, name, pseudonym, phone, phone_hash, messengers,
          password_hash, status, profile_risk, entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16)`,
      [
        entity.id,
        entity.externalId,
        input.wave || null,
        input.waveNumber,
        entity.directionId,
        entity.subdirection,
        entity.professionId,
        entity.name,
        entity.pseudonym,
        encryptField(entity.phone),
        phoneHash,
        JSON.stringify(entity.messengers),
        passwordHash,
        entity.status,
        entity.profileRisk,
        entity.enteredAt,
      ],
    );

    await client.query(
      `UPDATE registration_requests SET status = 'accepted' WHERE id = $1`,
      [input.requestId],
    );

    await client.query(
      `INSERT INTO participant_status_history (participant_id, status, reason)
       VALUES ($1, $2, $3)`,
      [entity.id, entity.status, 'created'],
    );
  });

  await logAction({
    actorId: input.interviewerId,
    actorType: 'participant',
    action: 'participants.create',
    entityType: 'participant',
    entityId: entity.id,
    newValue: { external_id: entity.externalId, direction_id: entity.directionId },
  });

  await emitInterviewEnded(input.requestId, 'completed');

  // Человек вошёл в контур: куратор направления назначает наставника,
  // балансировка учитывает +1 участника.
  await notifyAccepted(entity);

  return { participant: entity, temporaryPassword: tempPassword };
}

// -------- Очередь заявок на регистрацию --------

function maskPhone(phone: string): string {
  if (phone.length <= 6) {return '***';}
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

export async function listRegistrationRequests(
  filter: ListRegistrationRequestsFilter = {},
): Promise<{ data: RegistrationRequestItem[]; total: number }> {
  const statuses: RegistrationStatus[] = filter.statuses ?? [
    'new',
    'interview_scheduled',
    'decided',
  ];
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM registration_requests
      WHERE status = ANY($1::registration_status_enum[])`,
    [statuses],
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  const rows = await query<{
    id: string;
    phone: string;
    messengers: Record<string, string>;
    status: RegistrationStatus;
    assigned_to: string | null;
    interview_at: Date | null;
    notes: string | null;
    consent_video: boolean;
    consent_data: boolean;
    created_at: Date;
  }>(
    `SELECT id, phone, messengers, status, assigned_to, interview_at, notes,
            consent_video, consent_data, created_at
       FROM registration_requests
      WHERE status = ANY($1::registration_status_enum[])
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3`,
    [statuses, perPage, offset],
  );

  const data = rows.map((row) => ({
    id: row.id,
    status: row.status,
    phoneMasked: maskPhone(decryptField(row.phone)),
    messengers: row.messengers ?? {},
    assignedTo: row.assigned_to,
    interviewAt: row.interview_at ? row.interview_at.toISOString() : null,
    notes: row.notes,
    consentVideo: row.consent_video,
    consentData: row.consent_data,
    createdAt: row.created_at.toISOString(),
  }));

  return { data, total };
}

// -------- Чтение и кэш --------

export async function getById(participantId: UUID): Promise<Participant> {
  const cacheKey = `participant:v2:${participantId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      const row = JSON.parse(cached) as ParticipantRow;
      return rowToParticipant({ ...row, phone: decryptField(row.phone) });
    } catch {
      // ignore, идём в БД
    }
  }

  const row = await queryOne<ParticipantRow>(
    `SELECT id, external_id, name, pseudonym, phone, messengers,
            direction_id, subdirection, profession_id, status, profile_risk,
            mentor_id, cell_id, geo_enabled, entered_at, welcome_pack_given,
            is_first_architect, created_at, updated_at
       FROM participants
      WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!row) {throw new NotFoundError('Участник', participantId);}

  await redis.set(cacheKey, JSON.stringify(row), 'EX', 60);
  return rowToParticipant({ ...row, phone: decryptField(row.phone) });
}

export async function invalidateCache(participantId: UUID): Promise<void> {
  await redis.del(`participant:v2:${participantId}`);
}

// -------- Recovery (флоу B, S.0.01.04) --------

const RECOVERY_TOKEN_TTL_MS = 60 * 60_000;   // 1 час
const RECOVERY_TOKEN_BYTES = 32;             // 32 байта = 64 hex

export async function createRecoveryRequest(
  input: CreateRecoveryRequestInput,
): Promise<CreateRecoveryRequestResult> {
  const phoneHash = hashForSearch(input.phone);

  const participant = await queryOne<{ id: string }>(
    `SELECT id FROM participants
      WHERE phone_hash = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [phoneHash],
  );
  if (!participant) {
    throw new NotFoundError('Участник с таким телефоном');
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM recovery_requests
      WHERE participant_id = $1
        AND status IN ('pending','approved')
      LIMIT 1`,
    [participant.id],
  );
  if (existing) {
    throw new ConflictError('Активная заявка на восстановление уже существует', {
      requestId: existing.id,
    });
  }

  const requestId = newUUID();
  await query(
    `INSERT INTO recovery_requests (id, participant_id, requested_ip)
     VALUES ($1, $2, $3)`,
    [requestId, participant.id, input.requestedIp ?? null],
  );

  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'auth.recover.request',
    entityType: 'recovery_request',
    entityId: requestId,
    newValue: { participant_id: participant.id },
  });

  return { requestId, status: 'pending' };
}

export async function approveRecoveryRequest(
  requestId: UUID,
  approverId: UUID,
): Promise<ApproveRecoveryResult> {
  // -------- 0. Pre-check: ownership + messenger availability --------
  const pre = await queryOne<{
    participant_id: string;
    status: string;
    messengers: Record<string, unknown> | string;
  }>(
    `SELECT rr.participant_id, rr.status, p.messengers
       FROM recovery_requests rr
       JOIN participants p ON p.id = rr.participant_id
      WHERE rr.id = $1`,
    [requestId],
  );
  if (!pre) {
    throw new NotFoundError('Заявка', requestId);
  }

  if (pre.participant_id === approverId) {
    throw new ForbiddenError(
      'Нельзя одобрить заявку на восстановление собственного доступа',
      { request_id: requestId, reason: 'self_approve_forbidden' },
    );
  }

  const messengers: Record<string, unknown> =
    typeof pre.messengers === 'string'
      ? (JSON.parse(pre.messengers) as Record<string, unknown>)
      : pre.messengers;
  const targetChannels = ['telegram', 'whatsapp'] as const;
  const hasChannel = targetChannels.some((c) => {
    const v = messengers[c];
    return typeof v === 'string' && v.trim().length > 0;
  });
  if (!hasChannel) {
    throw new ConflictError(
      'У участника не привязан ни один канал (telegram/whatsapp) — токен некуда доставить. Отклоните заявку или попросите участника привязать мессенджер',
      {
        participant_id: pre.participant_id,
        required_channels: [...targetChannels],
      },
    );
  }

  // -------- 1. Токен --------
  const token = generateRecoveryToken();
  const tokenHash = sha256Hex(token);

  // -------- 2. Atomic pending → approved --------
  const updated = await query<{ participant_id: string; token_expires_at: Date }>(
    `UPDATE recovery_requests
        SET status = 'approved',
            approved_by = $1,
            approved_at = now(),
            token_hash = $2,
            token_expires_at = now() + ($3::int || ' milliseconds')::interval
      WHERE id = $4
        AND status = 'pending'
      RETURNING participant_id, token_expires_at`,
    [approverId, tokenHash, RECOVERY_TOKEN_TTL_MS, requestId],
  );
  const row = updated[0];
  if (!row) {
    const existing = await queryOne<{ status: string }>(
      `SELECT status FROM recovery_requests WHERE id = $1`,
      [requestId],
    );
    if (!existing) {
      throw new NotFoundError('Заявка', requestId);
    }
    throw new ConflictError(
      `Заявка в статусе '${existing.status}' не может быть одобрена`,
    );
  }

  const expiresAt = row.token_expires_at.toISOString();

  // -------- 3. Отправка --------
  // P2: sendNotification может throw (сеть/провайдер мессенджера).
  // В этом случае заявка остаётся 'approved' с токеном только в памяти —
  // восстановление невозможно, повторный approve даст 409. Откатываем
  // заявку в 'pending', чтобы можно было попробовать снова.
  let sendResult: { delivered: string[] };
  try {
    sendResult = await sendNotification({
      recipientId: row.participant_id,
      type: 'auth.recovery_token',
      priority: 'critical',
      title: 'Восстановление доступа',
      body:
        `Код для смены пароля: ${token}\n` +
        `Действует до ${expiresAt}.\n` +
        `Если вы не запрашивали восстановление — сообщите Совету направления.`,
      channels: ['telegram', 'whatsapp'],
      persist: false,
    });
  } catch (e) {
    // Откат: снимаем все поля approved-ветки.
    await query(
      `UPDATE recovery_requests
          SET status = 'pending',
              approved_by = NULL,
              approved_at = NULL,
              token_hash = NULL,
              token_expires_at = NULL
        WHERE id = $1
          AND status = 'approved'`,
      [requestId],
    );
    logger.error(
      { err: e, requestId },
      'approve: sendNotification failed, rolled back to pending',
    );
    throw new AppError(
      'NOTIFICATION_FAILED',
      'Не удалось доставить токен участнику. Попробуйте позже или отклоните заявку.',
      503,
      { request_id: requestId },
    );
  }

  await logAction({
    actorId: approverId,
    actorType: 'participant',
    action: 'auth.recover.approve',
    entityType: 'recovery_request',
    entityId: requestId,
    newValue: {
      participant_id: row.participant_id,
      expires_at: expiresAt,
      delivered_via: sendResult.delivered,
    },
  });

  return {
    requestId,
    expiresAt,
    deliveredVia: sendResult.delivered,
    token,
    // P13: защита от случайной сериализации токена.
    toJSON(): never {
      throw new Error('ApproveRecoveryResult must not be serialized');
    },
  };
}

export async function rejectRecoveryRequest(
  requestId: UUID,
  approverId: UUID,
  reason: string,
): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError('Причина отклонения обязательна');
  }
  if (reason.length > 1000) {
    throw new ValidationError('Причина слишком длинная (max 1000)');
  }

  const updated = await query<{ id: string }>(
    `UPDATE recovery_requests
        SET status = 'rejected',
            approved_by = $1,
            approved_at = now(),
            reject_reason = $2
      WHERE id = $3
        AND status = 'pending'
      RETURNING id`,
    [approverId, reason.trim(), requestId],
  );
  const row = updated[0];
  if (!row) {
    const existing = await queryOne<{ status: string }>(
      `SELECT status FROM recovery_requests WHERE id = $1`,
      [requestId],
    );
    if (!existing) {throw new NotFoundError('Заявка', requestId);}
    throw new ConflictError(
      `Заявка в статусе '${existing.status}' не может быть отклонена`,
    );
  }

  await logAction({
    actorId: approverId,
    actorType: 'participant',
    action: 'auth.recover.reject',
    entityType: 'recovery_request',
    entityId: requestId,
    newValue: { reason: reason.trim() },
  });
}

export async function consumeRecoveryToken(
  token: string,
  newPassword: string,
): Promise<void> {
  if (!token || token.length < 32) {
    throw new ValidationError('Некорректный токен восстановления');
  }

  const tokenHash = sha256Hex(token);

  const row = await queryOne<{
    id: string;
    participant_id: string;
    status: string;
    token_expires_at: Date | null;
  }>(
    `SELECT id, participant_id, status, token_expires_at
       FROM recovery_requests
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );

  if (!row) {
    throw new UnauthorizedError('Токен недействителен', 'INVALID_TOKEN');
  }

  if (row.status === 'used') {
    throw new ConflictError('Токен уже использован');
  }

  if (row.status === 'expired') {
    throw new UnauthorizedError('Срок действия токена истёк', 'TOKEN_EXPIRED');
  }

  if (row.status !== 'approved') {
    throw new ConflictError(`Заявка в статусе '${row.status}' — токен недоступен`);
  }

  if (!row.token_expires_at || row.token_expires_at.getTime() <= Date.now()) {
    await query(
      `UPDATE recovery_requests SET status = 'expired' WHERE id = $1`,
      [row.id],
    );
    throw new UnauthorizedError('Срок действия токена истёк', 'TOKEN_EXPIRED');
  }

  const newHash = await hashPassword(newPassword);

  await transaction(async (client) => {
    const lockRes = await client.query<{ status: string }>(
      `SELECT status FROM recovery_requests WHERE id = $1 FOR UPDATE`,
      [row.id],
    );
    const locked = lockRes.rows[0];
    if (!locked || locked.status !== 'approved') {
      throw new ConflictError('Токен уже использован или отозван');
    }

    await client.query(
      `UPDATE participants SET password_hash = $1, updated_at = now()
        WHERE id = $2 AND deleted_at IS NULL`,
      [newHash, row.participant_id],
    );

    await client.query(
      `UPDATE recovery_requests SET status = 'used', used_at = now()
        WHERE id = $1`,
      [row.id],
    );
  });

  try {
    await revokeAllForParticipant(row.participant_id);
  } catch (e) {
    logger.warn(
      { err: e, participantId: row.participant_id },
      'recovery: revokeAllForParticipant failed (password already changed)',
    );
  }

  await logAction({
    actorId: row.participant_id,
    actorType: 'participant',
    action: 'auth.recover.used',
    entityType: 'recovery_request',
    entityId: row.id,
  });
}

export function generateRecoveryToken(): string {
  return randomBytes(RECOVERY_TOKEN_BYTES).toString('hex');
}

// -------- Welcome pack --------

export async function grantWelcomePack(participantId: UUID): Promise<void> {
  const granted = await transaction(async (client) => {
    const lockRes = await client.query<{ welcome_pack_given: boolean }>(
      `SELECT welcome_pack_given FROM participants
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [participantId],
    );
    const row = lockRes.rows[0];
    if (!row) {
      throw new NotFoundError('Участник', participantId);
    }
    if (row.welcome_pack_given) {
      return false;
    }

    await client.query(
      `INSERT INTO flows (participant_id, type, balance)
       VALUES ($1, 'main', $2)
       ON CONFLICT (participant_id, type)
       DO UPDATE SET balance = flows.balance + $2, updated_at = now()`,
      [participantId, WELCOME_PACK],
    );
    await client.query(
      `INSERT INTO flow_transactions (participant_id, type, amount, reason, source)
       VALUES ($1, 'main', $2, 'Приветственный пакет', 'system')`,
      [participantId, WELCOME_PACK],
    );
    await client.query(
      `UPDATE participants SET welcome_pack_given = true WHERE id = $1`,
      [participantId],
    );
    return true;
  });

  if (!granted) { return; }

  await invalidateCache(participantId);
  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'participants.welcome_pack',
    entityType: 'participant',
    entityId: participantId,
    newValue: { amount: WELCOME_PACK },
  });
}

// -------- Вспомогательные --------

export async function isExternalIdTaken(externalId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1 LIMIT 1`,
    [externalId],
  );
  return row !== null;
}

/**
 * Следующий номер в волне — для приёма заявки без ручного ввода номера.
 * external_id собирается из (волна, номер, направление), поэтому при
 * параллельном приёме двух заявок возможна коллизия; её ловит
 * UNIQUE(external_id) и повтор с новым номером делает вызывающий код.
 */
export async function nextWaveNumber(wave: string): Promise<number> {
  const row = await queryOne<{ next: string }>(
    `SELECT COALESCE(MAX(wave_number), 0) + 1 AS next
       FROM participants
      WHERE wave_letter = $1`,
    [wave],
  );
  return parseInt(row?.next ?? '1', 10);
}

export function isDuplicateError(e: unknown): boolean {
  return isUniqueViolation(e);
}

export async function assertActive(participantId: UUID): Promise<void> {
  const p = await getById(participantId);
  if (p.status === 'excluded') {
    throw new UnauthorizedError('Участник отчуждён', 'INVALID_TOKEN');
  }
}

// -------- Паспорт и список --------

export async function getPassport(
  participantId: UUID,
  _requesterId: UUID,
): Promise<PassportFull> {
  const participant = await getById(participantId);

  const [directionRow, professionRow, rolesRows, mentorRow] = await Promise.all([
    queryOne<{ id: string; number: number; name: string }>(
      `SELECT id, number, name FROM directions WHERE id = $1`,
      [participant.directionId],
    ),
    participant.professionId
      ? queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM professions WHERE id = $1`,
          [participant.professionId],
        )
      : Promise.resolve(null),
    query<{ name: string; direction_id: string | null; valid_to: Date | null }>(
      `SELECT r.name, pr.direction_id, pr.valid_to
         FROM participant_roles pr
         JOIN roles r ON r.id = pr.role_id
        WHERE pr.participant_id = $1
          AND pr.status = 'active'
          AND (pr.valid_to IS NULL OR pr.valid_to > now())`,
      [participantId],
    ),
    participant.mentorId
      ? queryOne<{ external_id: string }>(
          `SELECT external_id FROM participants WHERE id = $1`,
          [participant.mentorId],
        )
      : Promise.resolve(null),
  ]);

  return {
    ...participant,
    direction: directionRow,
    profession: professionRow,
    roles: rolesRows.map((r) => ({
      name: r.name,
      directionId: r.direction_id,
      validTo: r.valid_to ? r.valid_to.toISOString() : null,
    })),
    mentorExternalId: mentorRow?.external_id ?? null,
  };
}

export async function listParticipants(
  filter: ParticipantFilter,
  _requesterId: UUID,
): Promise<{ data: Participant[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.directionId) {
    params.push(filter.directionId);
    conditions.push(`direction_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM participants WHERE ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<ParticipantRow>(
    `SELECT id, external_id, name, pseudonym, phone, messengers,
            direction_id, subdirection, profession_id, status, profile_risk,
            mentor_id, cell_id, geo_enabled, entered_at, welcome_pack_given,
            is_first_architect, created_at, updated_at
       FROM participants
      WHERE ${where}
      ORDER BY entered_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const data = rows.map((row) =>
    rowToParticipant({
      ...row,
      phone: '(скрыто)',
    }),
  );

  return { data, total };
}

export async function updateProfile(
  participantId: UUID,
  patch: ProfilePatch,
): Promise<Participant> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.pseudonym !== undefined) {
    params.push(patch.pseudonym);
    sets.push(`pseudonym = $${params.length}`);
  }
  if (patch.messengers !== undefined) {
    params.push(JSON.stringify(patch.messengers));
    sets.push(`messengers = $${params.length}`);
  }
  if (patch.geoEnabled !== undefined) {
    params.push(patch.geoEnabled);
    sets.push(`geo_enabled = $${params.length}`);
  }

  if (sets.length === 0) {
    return getById(participantId);
  }

  params.push(participantId);
  await query(
    `UPDATE participants SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
    params,
  );

  await invalidateCache(participantId);
  await logAction({
    actorId: participantId,
    actorType: 'participant',
    action: 'participants.update_profile',
    entityType: 'participant',
    entityId: participantId,
    newValue: patch as Record<string, unknown>,
  });

  return getById(participantId);
}