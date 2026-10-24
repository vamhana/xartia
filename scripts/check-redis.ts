// scripts/check-redis.ts
// Диагностика: куда реально подключается приложение и что в этом Redis.
// Запуск: pnpm tsx scripts/check-redis.ts

import 'dotenv/config';
import { redis } from '../src/lib/redis.js';

async function main(): Promise<void> {
  // Server info — какой Redis, версия, uptime
  const info = await redis.info('server');
  const serverLines = info.split('\n').filter((l) =>
    l.startsWith('redis_version') ||
    l.startsWith('uptime_in_seconds') ||
    l.startsWith('tcp_port'),
  );
  console.warn('REDIS_URL from env:', process.env['REDIS_URL']);
  console.warn('Server:', serverLines.join(', '));

  // Клиентское соединение

  console.warn('---');

  // Все ключи с префиксами
  const keys = await redis.keys('*');
  console.warn('Всего ключей:', keys.length);
  const byPrefix = new Map<string, number>();
  for (const k of keys) {
    const prefix = k.split(':').slice(0, 2).join(':');
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  for (const [p, n] of [...byPrefix.entries()].sort()) {
    console.warn(`  ${p}: ${n}`);
  }

  // Конкретно ratelimit-ключи
  const rlKeys = keys.filter((k) => k.startsWith('ratelimit:'));
  console.warn('---');
  console.warn('Ratelimit-ключи:', rlKeys.length);
  for (const k of rlKeys.slice(0, 20)) {
    const ttl = await redis.ttl(k);
    const val = await redis.get(k);
    console.warn(`  ${k}  ttl=${ttl}s  val=${(val ?? '').slice(0, 120)}`);
  }

  await redis.quit();
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});