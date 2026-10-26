// W.0.01.01 — Базовый WebSocket-сервер
// Управление подключениями, аутентификация, подписки на каналы,
// broadcast через Redis pub/sub. Единая точка входа для каналов W.2.*.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
// - Отдельный процесс (не часть API). Запускается как `tsx src/ws/server.ts`.
// - Publish-side (broadcast, sendTo*) работает из ЛЮБОГО процесса —
//   он просто publish'ит в Redis-канал `ws:*`.
// - Subscribe-side (startWSServer) активен только в WS-процессе —
//   он подписан на `ws:*` и раздаёт сообщения локальным сокетам.
// - Мультинодовость: N WS-инстансов + 1 Redis = все клиенты получают
//   сообщения независимо от того, к какой ноде они подключены.
// - Auth через `?token=<jwt>` (access). Роли / directionId — из payload.
//
// v0.0.03:
//   - waitForRedis() перед startWSServer: ждём redisSub/redisPub в статусе
//     'ready' до 60s. Иначе на старте (wsl --shutdown, перезапуск Docker
//     Desktop) ensureRedisSubscribed → psubscribe висел/падал, а процесс
//     умирал с 'fatal startup error'. Теперь переживает перезапуск Redis.
//     Таймаут 60s — с запасом; если Redis не поднялся — exit(1) с
//     внятным сообщением.
//
// v0.0.02:
//   - WSConnection.directionId: UUID | null — участник может быть без
//     направления (согласовано с S.0.01.01 JwtPayload и A.1.99.01
//     authMiddleware).

import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import websocket, { type WebSocket } from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../core/errors.js';
import { Role } from '../core/roles.js';
import type { UUID } from '../core/types.js';
import { newUUID } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { redis, redisPub, redisSub } from '../lib/redis.js';
import { verifyToken, isRevoked, type JwtPayload } from '../security/jwt.js';
import { canAccessChannel, getChannelByStringId } from '../core/chat/service.js';
import { queryOne } from '../lib/db.js';

// -------- Типы --------

export interface WSConnection {
  id: UUID;
  participantId: UUID;
  role: Role;
  /** null — участник без направления; direction-broadcast ему не приходит. */
  directionId: UUID | null;
  channels: Set<string>;
  socket: WebSocket;
  connectedAt: string;
  lastPongAt: number;
}

export type ChannelHandler = (
  connection: WSConnection,
  event: string,
  payload: unknown,
) => void;

export interface ServerStats {
  activeConnections: number;
  channels: Record<string, number>;
  uptimeSec: number;
}

export interface ChannelRegistration {
  name: string;
  handler?: ChannelHandler;
}

// -------- Redis-каналы --------

const REDIS_CHANNEL_PATTERN = 'ws:*';
const REDIS_CHANNEL_PREFIX = 'ws:';

function redisChannelForBroadcast(channel: string): string {
  return `${REDIS_CHANNEL_PREFIX}broadcast:${channel}`;
}
function redisChannelForParticipant(participantId: UUID): string {
  return `${REDIS_CHANNEL_PREFIX}participant:${participantId}`;
}
function redisChannelForDirection(directionId: UUID): string {
  return `${REDIS_CHANNEL_PREFIX}direction:${directionId}`;
}
function redisChannelForRole(role: Role): string {
  return `${REDIS_CHANNEL_PREFIX}role:${role}`;
}

// -------- Регистры --------

const connections = new Map<UUID, WSConnection>();
const byParticipant = new Map<UUID, Set<UUID>>();
const byChannel = new Map<string, Set<UUID>>();
const channelHandlers = new Map<string, ChannelHandler>();

let wsServer: FastifyInstance | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let redisSubReady = false;
let startedAt = 0;

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_BUFFERED_BYTES = 1_048_576; // 1 МБ
const MAX_CHANNELS_PER_CONNECTION = 50;

// -------- Ожидание Redis --------

/**
 * Ждём, пока redisSub и redisPub перейдут в статус 'ready'.
 *
 * Зачем: при `wsl --shutdown` или перезапуске Docker Desktop Redis
 * недоступен на старте WS-процесса. Без ожидания ensureRedisSubscribed
 * ниже пытается psubscribe, а ioredis (maxRetriesPerRequest: null для
 * pub/sub) висит до восстановления Redis. Без этого фикса процесс падал
 * с 'fatal startup error' (MaxRetriesPerRequestError на redis-sub).
 *
 * main (`redis`) отдельно не ждём: у него maxRetriesPerRequest=3 и быстрый
 * retryStrategy, он fail-fast. Если Redis поднят, main тоже готов;
 * если нет — waitForRedis не пропустит дальше.
 *
 * Логируем раз в секунду, чтобы в stderr было видно прогресс
 * (sub: connecting → ready). Таймаут 60s — с запасом на старт Docker.
 */
async function waitForRedis(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (redisSub.status === 'ready' && redisPub.status === 'ready') {
      return;
    }
    logger.info(
      { redis: redis.status, sub: redisSub.status, pub: redisPub.status },
      'ws: waiting for redis',
    );
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Redis not ready after ${timeoutMs}ms`);
}

// -------- Публичный API: регистрация канала --------

export async function registerChannel(
  name: string,
  handler: ChannelHandler,
): Promise<void> {
  channelHandlers.set(name, handler);
  logger.debug({ channel: name }, 'ws: channel handler registered');
}

// -------- Publish-side (работает из любого процесса) --------

export async function broadcast(
  channel: string,
  event: string,
  payload: unknown,
): Promise<number> {
  try {
    const receivers = await redisPub.publish(
      redisChannelForBroadcast(channel),
      JSON.stringify({ channel, event, payload }),
    );
    return receivers;
  } catch (e) {
    logger.warn({ err: e, channel, event }, 'ws: broadcast failed');
    return 0;
  }
}

export async function sendToParticipant(
  participantId: UUID,
  event: string,
  payload: unknown,
): Promise<boolean> {
  try {
    await redisPub.publish(
      redisChannelForParticipant(participantId),
      JSON.stringify({ event, payload }),
    );
    return true;
  } catch (e) {
    logger.warn({ err: e, participantId, event }, 'ws: sendToParticipant failed');
    return false;
  }
}

export async function sendToDirection(
  directionId: UUID,
  event: string,
  payload: unknown,
): Promise<number> {
  try {
    return await redisPub.publish(
      redisChannelForDirection(directionId),
      JSON.stringify({ event, payload }),
    );
  } catch (e) {
    logger.warn({ err: e, directionId, event }, 'ws: sendToDirection failed');
    return 0;
  }
}

export async function sendToRole(
  role: Role,
  event: string,
  payload: unknown,
): Promise<number> {
  try {
    return await redisPub.publish(
      redisChannelForRole(role),
      JSON.stringify({ event, payload }),
    );
  } catch (e) {
    logger.warn({ err: e, role, event }, 'ws: sendToRole failed');
    return 0;
  }
}

// -------- Read-side (только для WS-процесса) --------

export function getConnection(connectionId: UUID): WSConnection | null {
  return connections.get(connectionId) ?? null;
}

export function getConnectionsByParticipant(participantId: UUID): WSConnection[] {
  const ids = byParticipant.get(participantId);
  if (!ids) {return [];}
  const out: WSConnection[] = [];
  for (const id of ids) {
    const c = connections.get(id);
    if (c) {out.push(c);}
  }
  return out;
}

export function getStats(): ServerStats {
  const channels: Record<string, number> = {};
  for (const [name, set] of byChannel.entries()) {
    channels[name] = set.size;
  }
  return {
    activeConnections: connections.size,
    channels,
    uptimeSec: startedAt > 0 ? Math.floor((Date.now() - startedAt) / 1000) : 0,
  };
}

export async function closeConnection(
  connectionId: UUID,
  reason: string,
): Promise<void> {
  const conn = connections.get(connectionId);
  if (!conn) {return;}
  try {
    conn.socket.close(1000, reason);
  } catch {
    // уже закрыт
  }
  detachConnection(connectionId);
}

// -------- Подключение и отключение --------

async function handleIncomingConnection(
  socket: WebSocket,
  request: FastifyRequest,
): Promise<void> {
  // Auth
  let payload: JwtPayload;
  try {
    payload = await authenticateRequest(request);
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'NO_TOKEN';
    logger.warn(
      { err: e, code, url: request.url.slice(0, 80) },
      'ws: connection rejected - auth failed',
    );
    socket.close(4401, code);
    return;
  }

  const connectionId = newUUID();
  const conn: WSConnection = {
    id: connectionId,
    participantId: payload.sub,
    role: payload.role,
    directionId: payload.directionId,   // UUID | null — совпадает с JwtPayload
    channels: new Set<string>(),
    socket,
    connectedAt: new Date().toISOString(),
    lastPongAt: Date.now(),
  };

  registerConnection(conn);

  socket.on('message', (raw: Buffer) => {
    handleClientMessage(conn, raw).catch((e) =>
      logger.warn({ err: e, connectionId }, 'ws: message handler error'),
    );
  });

  socket.on('pong', () => {
    conn.lastPongAt = Date.now();
  });

  socket.on('close', (code: number, reason: Buffer) => {
    logger.debug(
      { connectionId, participantId: conn.participantId, code, reason: reason.toString() },
      'ws: closed',
    );
    detachConnection(connectionId);
  });

  socket.on('error', (e: Error) => {
    logger.warn({ err: e, connectionId }, 'ws: socket error');
  });

  // Отправляем welcome-сообщение.
  try {
    send(conn, 'connected', {
      connectionId,
      participantId: conn.participantId,
      role: conn.role,
      directionId: conn.directionId,   // может быть null — клиент должен уметь
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e, connectionId }, 'ws: failed to send welcome');
  }

  logger.info(
    { connectionId, participantId: conn.participantId, role: conn.role },
    'ws: connected',
  );
}

async function authenticateRequest(request: FastifyRequest): Promise<JwtPayload> {
  const token =
    (request.query as { token?: string } | undefined)?.token ??
    extractBearerFromHeader(request);

  if (!token) {
    throw new UnauthorizedError('Требуется токен', 'NO_TOKEN');
  }
  if (await isRevoked(token)) {
    throw new UnauthorizedError('Токен отозван', 'REVOKED');
  }
  return verifyToken(token, 'access');
}

function extractBearerFromHeader(request: FastifyRequest): string | null {
  const auth = request.headers['authorization'];
  if (typeof auth !== 'string') {return null;}
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {return null;}
  return parts[1] ?? null;
}

function registerConnection(conn: WSConnection): void {
  connections.set(conn.id, conn);
  let set = byParticipant.get(conn.participantId);
  if (!set) {
    set = new Set();
    byParticipant.set(conn.participantId, set);
  }
  set.add(conn.id);
}

function detachConnection(connectionId: UUID): void {
  const conn = connections.get(connectionId);
  if (!conn) {return;}
  for (const channel of conn.channels) {
    const set = byChannel.get(channel);
    if (set) {
      set.delete(connectionId);
      if (set.size === 0) {byChannel.delete(channel);}
    }
    broadcastPresence(channel);
  }
  const participantSet = byParticipant.get(conn.participantId);
  if (participantSet) {
    participantSet.delete(connectionId);
    if (participantSet.size === 0) {byParticipant.delete(conn.participantId);}
  }
  connections.delete(connectionId);
}


// -------- Авторизация подписки на канал --------
//
// Без этого любой аутентифицированный клиент мог подписаться на чужой
// chat:<channelId> или interview:<id> и слушать чужие сообщения.
// Глобальные каналы (tasks/signals/...) доступны всем — это общие ленты.

const GLOBAL_CHANNELS = new Set([
  'balance', 'connectivity', 'crisis', 'otc', 'psy', 'pulse', 'regimes',
  'semantic', 'signals', 'tasks', 'flows', 'notifications', 'treasury',
  'council', 'panels',
]);

async function authorizeChannel(
  conn: WSConnection,
  channel: string,
): Promise<{ ok: boolean; reason?: string }> {
  // Приватные каналы проверяются ДО роли: даже Архитектор не читает
  // чужие личные чаты и собеседования.
  if (channel.startsWith('chat:')) {
    const channelId = channel.slice('chat:'.length);
    try {
      const ch = await getChannelByStringId(channelId);
      const res = await canAccessChannel(conn.participantId, ch);
      return res.allowed ? { ok: true } : { ok: false, reason: res.reason ?? 'FORBIDDEN' };
    } catch {
      return { ok: false, reason: 'NO_CHANNEL' };
    }
  }

  if (channel.startsWith('interview:')) {
    const interviewId = channel.slice('interview:'.length);
    const row = await queryOne<{ participant_id: string | null }>(
      `SELECT participant_id FROM interview_requests WHERE id = $1`,
      [interviewId],
    ).catch(() => null);
    return row && row.participant_id === conn.participantId
      ? { ok: true }
      : { ok: false, reason: 'FORBIDDEN' };
  }

  // Глобальные ленты и служебные каналы — всем.
  if (GLOBAL_CHANNELS.has(channel)) {return { ok: true };}

  // Архитектор видит всё остальное — это его роль гаранта.
  if (conn.role === Role.FIRST_ARCHITECT) {return { ok: true };}

  if (channel.startsWith('participant:')) {
    return { ok: channel === `participant:${conn.participantId}`, reason: 'FORBIDDEN' };
  }
  if (channel.startsWith('direction:')) {
    return {
      ok: conn.directionId !== null && channel === `direction:${conn.directionId}`,
      reason: 'FORBIDDEN',
    };
  }
  if (channel.startsWith('role:')) {
    return { ok: channel === `role:${conn.role}`, reason: 'FORBIDDEN' };
  }

  return { ok: false, reason: 'UNKNOWN_CHANNEL' };
}

/** Присутствие: кто из подписчиков канала сейчас онлайн. */
function broadcastPresence(channel: string): void {
  const set = byChannel.get(channel);
  if (!set || set.size === 0) {return;}
  const participants = new Set<string>();
  for (const connId of set) {
    const conn = connections.get(connId);
    if (conn) {participants.add(conn.participantId);}
  }
  const payload = {
    channel,
    participants: Array.from(participants),
    count: participants.size,
  };
  for (const connId of set) {
    const conn = connections.get(connId);
    if (conn) {send(conn, 'presence', payload);}
  }
}

// -------- Обработка сообщений от клиента --------

interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'ping' | 'signal';
  channel?: string;
  requestId?: string;
  event?: string;
  payload?: unknown;
  /** Время последнего полученного события (catch-up после разрыва). */
  since?: number;
}

async function handleClientMessage(conn: WSConnection, raw: Buffer): Promise<void> {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw.toString('utf8')) as ClientMessage;
  } catch {
    send(conn, 'error', { code: 'BAD_MESSAGE', message: 'Invalid JSON' });
    return;
  }

  if (!msg || typeof msg.action !== 'string') {
    send(conn, 'error', { code: 'BAD_MESSAGE', message: 'Missing action' });
    return;
  }

  switch (msg.action) {
    case 'ping': {
      send(conn, 'pong', { requestId: msg.requestId, serverTime: new Date().toISOString() });
      return;
    }
    case 'subscribe': {
      if (!msg.channel) {
        send(conn, 'error', { code: 'BAD_CHANNEL', message: 'channel required' });
        return;
      }
      if (conn.channels.size >= MAX_CHANNELS_PER_CONNECTION) {
        send(conn, 'error', { code: 'TOO_MANY_CHANNELS', message: 'Limit reached' });
        return;
      }
      const authz = await authorizeChannel(conn, msg.channel);
      if (!authz.ok) {
        send(conn, 'error', {
          code: 'FORBIDDEN',
          message: authz.reason ?? 'Нет доступа к каналу',
          channel: msg.channel,
        });
        return;
      }
      conn.channels.add(msg.channel);
      let set = byChannel.get(msg.channel);
      if (!set) {
        set = new Set();
        byChannel.set(msg.channel, set);
      }
      set.add(conn.id);
      send(conn, 'subscribed', { channel: msg.channel, requestId: msg.requestId });
      broadcastPresence(msg.channel);

      // Догон пропущенного: клиент присылает since (ms последнего события).
      if (typeof msg.since === 'number' && msg.since > 0) {
        await replayBacklog(conn, msg.channel, msg.since);
      }
      return;
    }
    case 'unsubscribe': {
      if (!msg.channel) {return;}
      conn.channels.delete(msg.channel);
      const set = byChannel.get(msg.channel);
      if (set) {
        set.delete(conn.id);
        if (set.size === 0) {byChannel.delete(msg.channel);}
      }
      send(conn, 'unsubscribed', { channel: msg.channel, requestId: msg.requestId });
      broadcastPresence(msg.channel);
      return;
    }
    case 'signal': {
      if (!msg.channel || !msg.channel.startsWith('interview:')) {
        send(conn, 'error', {
          code: 'BAD_CHANNEL',
          message: 'signal only for interview:*',
        });
        return;
      }
      if (!conn.channels.has(msg.channel)) {
        send(conn, 'error', {
          code: 'NOT_SUBSCRIBED',
          message: 'subscribe first',
        });
        return;
      }
      const interviewId = msg.channel.slice('interview:'.length);
      const signal = {
        interviewId,
        fromConnectionId: conn.id,
        data: msg.payload,
      };
      const { emitOffer, emitAnswer, emitIceCandidate } =
        await import('./interview.js');
      if (msg.event === 'offer') {
        await emitOffer(signal);
      } else if (msg.event === 'answer') {
        await emitAnswer(signal);
      } else if (msg.event === 'ice_candidate') {
        await emitIceCandidate(signal);
      } else {
        send(conn, 'error', {
          code: 'BAD_EVENT',
          message: String(msg.event),
        });
      }
      return;
    }
    default: {
      send(conn, 'error', { code: 'UNKNOWN_ACTION', message: String(msg.action) });
      return;
    }
  }
}

// -------- Отправка конкретному сокету --------

function send(
  conn: WSConnection,
  event: string,
  payload: unknown,
  channel?: string,
  ts?: number,
): void {
  if (conn.socket.readyState !== conn.socket.OPEN) {return;}
  if (conn.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    logger.warn(
      { connectionId: conn.id, bufferedAmount: conn.socket.bufferedAmount },
      'ws: backpressure — closing slow connection',
    );
    try {
      conn.socket.close(1013, 'Backpressure');
    } catch {
      // ignore
    }
    return;
  }
  try {
    conn.socket.send(JSON.stringify({
      event,
      payload,
      ...(channel ? { channel } : {}),
      ts: ts ?? Date.now(),
    }));
  } catch (e) {
    logger.warn({ err: e, connectionId: conn.id }, 'ws: send failed');
  }
}

// -------- Redis subscribe: входящие сообщения от других нод --------

async function ensureRedisSubscribed(): Promise<void> {
  if (redisSubReady) {return;}
  redisSubReady = true;

  await redisSub.psubscribe(REDIS_CHANNEL_PATTERN);

  redisSub.on('pmessage', (_pattern: string, channel: string, message: string) => {
    dispatchFromRedis(channel, message).catch((e) =>
      logger.warn({ err: e, channel }, 'ws: dispatch from redis failed'),
    );
  });

  logger.info({ pattern: REDIS_CHANNEL_PATTERN }, 'ws: subscribed to redis pattern');
}

async function dispatchFromRedis(redisChannel: string, raw: string): Promise<void> {
  let envelope: { channel?: string; event: string; payload: unknown };
  try {
    envelope = JSON.parse(raw) as { channel?: string; event: string; payload: unknown };
  } catch {
    logger.warn({ redisChannel }, 'ws: malformed message from redis');
    return;
  }

  // Broadcast в конкретный канал
  if (redisChannel.startsWith(`${REDIS_CHANNEL_PREFIX}broadcast:`)) {
    const channel = envelope.channel ?? redisChannel.slice(`${REDIS_CHANNEL_PREFIX}broadcast:`.length);
    dispatchToChannel(channel, envelope.event, envelope.payload);
    return;
  }

  // Participant
  if (redisChannel.startsWith(`${REDIS_CHANNEL_PREFIX}participant:`)) {
    const participantId = redisChannel.slice(`${REDIS_CHANNEL_PREFIX}participant:`.length);
    dispatchToParticipant(participantId, envelope.event, envelope.payload);
    return;
  }

  // Direction
  if (redisChannel.startsWith(`${REDIS_CHANNEL_PREFIX}direction:`)) {
    const directionId = redisChannel.slice(`${REDIS_CHANNEL_PREFIX}direction:`.length);
    dispatchToDirection(directionId, envelope.event, envelope.payload);
    return;
  }

  // Role
  if (redisChannel.startsWith(`${REDIS_CHANNEL_PREFIX}role:`)) {
    const role = redisChannel.slice(`${REDIS_CHANNEL_PREFIX}role:`.length) as Role;
    dispatchToRole(role, envelope.event, envelope.payload);
    return;
  }
}


// -------- Catch-up (last-event-id по времени) --------
//
// История событий канала хранится в Redis (LPUSH/LTRIM). Клиент при
// переподключении присылает since=ms последнего события и получает пропущенное.

const BACKLOG_MAX = 200;
const BACKLOG_TTL_SEC = 3600;

async function rememberEvent(
  channel: string,
  event: string,
  payload: unknown,
  ts: number,
): Promise<void> {
  try {
    const key = `ws:backlog:${channel}`;
    await redis.lpush(key, JSON.stringify({ event, payload, channel, ts }));
    await redis.ltrim(key, 0, BACKLOG_MAX - 1);
    await redis.expire(key, BACKLOG_TTL_SEC);
  } catch (e) {
    logger.warn({ err: e, channel }, 'ws: backlog write failed');
  }
}

async function replayBacklog(conn: WSConnection, channel: string, since: number): Promise<void> {
  try {
    const raw = await redis.lrange(`ws:backlog:${channel}`, 0, -1);
    const entries = raw
      .map((s) => {
        try { return JSON.parse(s) as { event: string; payload: unknown; ts: number }; }
        catch { return null; }
      })
      .filter((e): e is { event: string; payload: unknown; ts: number } => e !== null)
      .filter((e) => e.ts > since)
      .sort((a, b) => a.ts - b.ts);
    for (const e of entries) {
      send(conn, e.event, e.payload, channel);
    }
  } catch (e) {
    logger.warn({ err: e, channel }, 'ws: backlog replay failed');
  }
}

function dispatchToChannel(channel: string, event: string, payload: unknown): void {
  const ts = Date.now();
  // Catch-up: помним последние события канала в Redis, чтобы клиент после
  // разрыва мог догнать пропущенное (last-event-id по времени).
  void rememberEvent(channel, event, payload, ts);

  const set = byChannel.get(channel);
  if (!set) {return;}
  const handler = channelHandlers.get(channel);
  for (const connId of set) {
    const conn = connections.get(connId);
    if (!conn) {continue;}
    if (handler) {
      try {
        handler(conn, event, payload);
      } catch (e) {
        logger.warn({ err: e, channel, event }, 'ws: channel handler error');
      }
    }
    send(conn, event, payload);
  }
}

function dispatchToParticipant(
  participantId: string,
  event: string,
  payload: unknown,
): void {
  const ids = byParticipant.get(participantId as UUID);
  if (!ids) {return;}
  for (const connId of ids) {
    const conn = connections.get(connId);
    if (conn) {send(conn, event, payload);}
  }
}

function dispatchToDirection(
  directionId: string,
  event: string,
  payload: unknown,
): void {
  for (const conn of connections.values()) {
    // conn.directionId === null → соединение без направления, пропускаем
    // (null === "uuid" всегда false, но проверка явная — семантика).
    if (conn.directionId !== null && conn.directionId === directionId) {
      send(conn, event, payload);
    }
  }
}

function dispatchToRole(role: string, event: string, payload: unknown): void {
  for (const conn of connections.values()) {
    if (conn.role === role) {
      send(conn, event, payload);
    }
  }
}

// -------- Heartbeat --------

function startHeartbeat(): void {
  if (heartbeatTimer) {return;}
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const conn of connections.values()) {
      if (now - conn.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        logger.info(
          { connectionId: conn.id, participantId: conn.participantId },
          'ws: heartbeat timeout — closing',
        );
        try {
          conn.socket.close(4408, 'Heartbeat timeout');
        } catch {
          // ignore
        }
        detachConnection(conn.id);
        continue;
      }
      try {
        conn.socket.ping();
      } catch (e) {
        logger.warn({ err: e, connectionId: conn.id }, 'ws: ping failed');
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// -------- Запуск / остановка --------

export async function startWSServer(port?: number): Promise<FastifyInstance> {
  if (wsServer) {return wsServer;}

  // Ждём Redis до создания Fastify: иначе ensureRedisSubscribed ниже
  // упадёт/повиснет при wsl --shutdown или перезапуске Docker Desktop.
  // 60s — с запасом на старт Redis. При недоступности — exit(1) из
  // entry-point (см. isMainModule ниже) с понятным сообщением.
  await waitForRedis();

  const WS_PORT = port ?? Number(process.env['WS_PORT'] ?? '3001');
  const HOST = process.env['HOST'] ?? '0.0.0.0';

  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] !== 'production'
          ? {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    trustProxy: true,
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 1024, // 1 МБ
      clientTracking: false,
    },
  });

  // Простой health endpoint для K8s / docker healthcheck.
  app.get('/health/live', async () => ({ status: 'ok', service: 'ws' }));
  app.get('/ws/stats', async () => getStats());

  // WebSocket route
  // HTTP-health для CI/деплоя: WS-процесс слушает 3001, но клиенту нужен
  // надёжный признак готовности (Docker открывает порт раньше приложения).
  app.get('/health', async (_req, reply) => {
    reply.send({ status: 'ok', connections: connections.size, uptimeSec: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0 });
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    handleIncomingConnection(socket as unknown as WebSocket, req).catch((e) => {
      logger.error({ err: e }, 'ws: connection handler failed');
      try {
        (socket as unknown as WebSocket).close(1011, 'Internal error');
      } catch {
        // ignore
      }
    });
  });
  // Регистрация каналов W.2.*
  const { registerChatChannel } = await import('./chat.js');
  await registerChatChannel();

  const { registerPsyChannel } = await import('./psy.js');
  await registerPsyChannel();

  const { registerInterviewChannel } = await import('./interview.js');
  await registerInterviewChannel();

  await ensureRedisSubscribed();
  startHeartbeat();

  await app.listen({ port: WS_PORT, host: HOST });
  startedAt = Date.now();

  logger.info(
    { port: WS_PORT, host: HOST, redisPattern: REDIS_CHANNEL_PATTERN },
    'ws: server listening',
  );

  wsServer = app;
  return app;
}

export async function stopWSServer(): Promise<void> {
  stopHeartbeat();

  // Закрываем все соединения.
  for (const conn of connections.values()) {
    try {
      conn.socket.close(1001, 'Server shutting down');
    } catch {
      // ignore
    }
  }
  connections.clear();
  byParticipant.clear();
  byChannel.clear();

  if (redisSubReady) {
    try {
      await redisSub.punsubscribe(REDIS_CHANNEL_PATTERN);
      redisSubReady = false;
    } catch (e) {
      logger.warn({ err: e }, 'ws: punsubscribe failed');
    }
  }

  if (wsServer) {
    try {
      await wsServer.close();
    } catch (e) {
      logger.warn({ err: e }, 'ws: server close failed');
    }
    wsServer = null;
  }

  startedAt = 0;
  logger.info({}, 'ws: server stopped');
}

// -------- Direct entry (когда запускают `tsx src/ws/server.ts`) --------

// Кроссплатформенная проверка «этот файл — entry point».
// На Windows file:// + путь не совпадает с import.meta.url (три слэша vs два).
const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) {return false;}
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  startWSServer()
    .then(() => {
      logger.info({}, 'ws: ready');
    })
    .catch((e) => {
      logger.error({ err: e }, 'ws: fatal startup error');
      process.exit(1);
    });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'ws: shutting down');
    await stopWSServer();
    try {
      await redis.quit();
      await redisPub.quit();
      await redisSub.quit();
    } catch (e) {
      logger.warn({ err: e }, 'ws: redis close failed');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}