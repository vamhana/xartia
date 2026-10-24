// A.1.99.06 — Middleware валидации
// Zod-схемы. Возврат 422 с деталями.
//
// Совместимость Zod 3 и Zod 4: используем `error.issues` вместо `error.errors`.
// В Zod 3 `errors` — deprecated алиас на `issues`, в Zod 4 он удалён.
// `issues` доступен в обоих мажорах и совпадает по содержимому.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ValidationError } from '../../core/errors.js';

export interface ValidationOptions {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

// Единый формат issues для всех трёх источников (params/query/body).
// Вынесен наружу, чтобы правки в формате делались в одном месте.
function mapIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
}

export function validationMiddleware(options: ValidationOptions): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (options.params) {
      const result = options.params.safeParse(request.params);
      if (!result.success) {
        throw new ValidationError(
          'Ошибка валидации path-параметров',
          mapIssues(result.error),
        );
      }
      request.params = result.data;
    }
    if (options.query) {
      const result = options.query.safeParse(request.query);
      if (!result.success) {
        throw new ValidationError(
          'Ошибка валидации query',
          mapIssues(result.error),
        );
      }
      request.query = result.data;
    }
    if (options.body) {
      const result = options.body.safeParse(request.body);
      if (!result.success) {
        throw new ValidationError(
          'Ошибка валидации body',
          mapIssues(result.error),
        );
      }
      request.body = result.data;
    }
  };
}

export function validateBody<T>(schema: z.ZodType<T>): preHandlerHookHandler {
  return validationMiddleware({ body: schema });
}

export function validateQuery<T>(schema: z.ZodType<T>): preHandlerHookHandler {
  return validationMiddleware({ query: schema });
}

export function validateParams<T>(schema: z.ZodType<T>): preHandlerHookHandler {
  return validationMiddleware({ params: schema });
}