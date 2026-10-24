// src/lib/regime-cache.ts
// Кэш активных режимов. Используется middleware (A.1.99.04) для быстрой проверки
// и сервисом режимов (C.0.17.02) для инвалидации при активации/деактивации.
//
// Отдельный модуль — чтобы избежать циклов core ↔ middleware.

import { logger } from './logger.js';
import { redis } from './redis.js';

const CACHE_KEY = 'regime:context:active';

export async function invalidateRegimeCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
  } catch (e) {
    logger.warn({ err: e }, 'regime-cache: invalidation failed');
  }
}

export async function getRegimeCacheKey(): Promise<string | null> {
  try {
    return await redis.get(CACHE_KEY);
  } catch {
    return null;
  }
}