// A.1.99.01 — Middleware аутентификации
// JWT-проверка. Валидация access_token. Attach participantId к request.
// Проверка blacklist (revoked tokens).
//
// v0.0.02:
//   - directionId: UUID | null — участник может быть без направления
//     (согласовано с LoaderContext в C.0.26.03, getMyPanelById/listMyPanels
//     в C.0.26.02, /panels/:id/render в A.1.26.01).
//     Раньше тип лгал: в JWT поле могло отсутствовать/null.

import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { UnauthorizedError } from '../../core/errors.js';
import { Role } from '../../core/roles.js';
import type { UUID } from '../../core/types.js';
import {
  verifyToken,
  isRevoked,
  isSessionActive,
  type JwtPayload,
} from '../../security/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      participantId: UUID;
      externalId: string;
      role: Role;
      directionId: UUID | null;
      sessionId: UUID;
    };
  }
}

export interface AuthContext {
  participantId: UUID;
  externalId: string;
  role: Role;
  directionId: UUID | null;
  sessionId: UUID;
}

export function extractBearer(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (!auth) {return null;}
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {return null;}
  return parts[1] ?? null;
}

export const authMiddleware: preHandlerHookHandler = async (request: FastifyRequest) => {
  const token = extractBearer(request);
  if (!token) {throw new UnauthorizedError('Требуется авторизация', 'NO_TOKEN');}

  if (await isRevoked(token)) {
    throw new UnauthorizedError('Токен отозван', 'REVOKED');
  }

  const payload: JwtPayload = await verifyToken(token, 'access');

  if (!(await isSessionActive(payload.sessionId))) {
    throw new UnauthorizedError('Сессия истекла или отозвана', 'REVOKED');
  }

  request.auth = {
    participantId: payload.sub,
    externalId: payload.externalId,
    role: payload.role,
    directionId: payload.directionId ?? null,
    sessionId: payload.sessionId,
  };
};

export const optionalAuthMiddleware: preHandlerHookHandler = async (request) => {
  const token = extractBearer(request);
  if (!token) {return;}
  try {
    if (await isRevoked(token)) {return;}
    const payload = await verifyToken(token, 'access');
    if (!(await isSessionActive(payload.sessionId))) {return;}
    request.auth = {
      participantId: payload.sub,
      externalId: payload.externalId,
      role: payload.role,
      directionId: payload.directionId ?? null,
      sessionId: payload.sessionId,
    };
  } catch {
    // ignore — optional
  }
};

export function getAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) {throw new UnauthorizedError('Не аутентифицирован', 'NO_TOKEN');}
  return request.auth;
}

export function requireAuth(): preHandlerHookHandler {
  return authMiddleware;
}