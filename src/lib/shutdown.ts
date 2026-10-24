// L.0.01.12 — Graceful shutdown
// Правильный порядок: сначала audit (flush pending batch),
// потом db (audit уже не пишет), потом redis.
//
// В server.ts и во всех тестах использовать только эту функцию —
// она гарантирует, что audit-очередь допишется до закрытия pool.

import { close as closeAudit } from '../core/audit.js';

import { closeConnections as closeDb } from './db.js';
import { logger } from './logger.js';
import { closeConnections as closeRedis } from './redis.js';

let shuttingDown = false;

export async function gracefulShutdown(): Promise<void> {
  // Идемпотентность: повторный SIGTERM/SIGINT или двойной вызов в finally
  // не должен приводить к повторному closeAudit/closeDb/closeRedis —
  // ioredis и pg бросают на повторный quit/end.
  if (shuttingDown) {
    logger.warn('gracefulShutdown: already in progress, ignoring');
    return;
  }
  shuttingDown = true;

  // 1. Audit — flush. Даёт 500ms таймеру сработать.
  try {
    await closeAudit();
  } catch (e) {
    // Не пробрасываем: db/redis должны закрыться даже если audit упал.
    logger.error({ err: e }, 'gracefulShutdown: closeAudit failed');
  }

  // 2. Параллельно закрываем db и redis — audit уже не нужен.
  const results = await Promise.allSettled([closeDb(), closeRedis()]);
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      const name = i === 0 ? 'closeDb' : 'closeRedis';
      logger.error({ err: r.reason }, `gracefulShutdown: ${name} failed`);
    }
  }

  logger.info('gracefulShutdown: complete');
}