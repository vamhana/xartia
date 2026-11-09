// I.9.07.05 — Cron: permits.status='expired' (Фаза 3c, A51, A59).
//
// Раз в час:
//   UPDATE permits SET status='expired'
//     WHERE status='active' AND valid_until IS NOT NULL AND valid_until < now();
//   UPDATE participant_permits SET status='expired'
//     WHERE status='active' AND valid_until IS NOT NULL AND valid_until < now();
//
// НЕ пишет в passport_history_events — это не действие актора (§10.3,
// history — «кто/когда/что сделал», а не «время прошло»).
// Логирует в system_events (или audit_log — уточнить после сверки).
//
// Идемпотентно. Лаг до 1 часа приемлем (A59): downstream проверяет
// valid_until, а не status.

import { query } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export interface PermitsExpireResult {
  permitsExpired: number;
  participantPermitsExpired: number;
  durationMs: number;
}

export async function runPermitsExpire(): Promise<PermitsExpireResult> {
  const startedAt = Date.now();

  const permits = await query<{ permit_id: string }>(
    `UPDATE permits
        SET status = 'expired', updated_at = now()
      WHERE status = 'active'
        AND valid_until IS NOT NULL
        AND valid_until < now()
      RETURNING permit_id`,
  );

  const participantPermits = await query<{ id: string }>(
    `UPDATE participant_permits
        SET status = 'expired'
      WHERE status = 'active'
        AND valid_until IS NOT NULL
        AND valid_until < now()
      RETURNING id`,
  );

  const durationMs = Date.now() - startedAt;
  const result: PermitsExpireResult = {
    permitsExpired: permits.length,
    participantPermitsExpired: participantPermits.length,
    durationMs,
  };

  logger.info(result, 'permits-expire: done');

  // system_events — «время прошло, состояние изменилось», не action актора.
  await query(
    `INSERT INTO system_events (type, payload)
     VALUES ('permits_expired', $1::jsonb)`,
    [JSON.stringify(result)],
  ).catch((e) => {
    // Не блокируем job из-за логирования.
    logger.warn({ err: e }, 'permits-expire: system_events insert failed');
  });

  return result;
}