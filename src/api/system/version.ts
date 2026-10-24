// A.1.90.03 — Version-контроллер
// Текущая версия системы, API, схемы БД, OpenAPI.
// Публичный. Используется для проверки совместимости клиентов.

import type { FastifyInstance } from 'fastify';

import { CHARTER_REVISION_YEARS } from '../../core/constants.js';

export const version = '0.0.01';
export const apiVersion = '1.0.0';
export const charterVersion = '5.0.0';
export const dbSchemaVersion = '0.0.01';

export async function registerVersionRoutes(app: FastifyInstance): Promise<void> {
  // GET /version
  app.get('/version', async () => ({
    api_version: apiVersion,
    charter_version: charterVersion,
    db_schema_version: dbSchemaVersion,
    build_hash: process.env['BUILD_HASH'] ?? 'dev',
    build_date: process.env['BUILD_DATE'] ?? new Date().toISOString(),
  }));

  // GET /version/charter
  app.get('/version/charter', async () => ({
    version: charterVersion,
    revision_years: CHARTER_REVISION_YEARS,
  }));

  // GET /version/api
  app.get('/version/api', async () => ({
    version: apiVersion,
    deprecated: false,
  }));
}