// I.9.09.30 — Ручной прогон permits-expire (Фаза 3c).
// Запуск: pnpm tsx scripts/run-permits-expire.ts

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';
import { runPermitsExpire } from '../src/worker/jobs/permits-expire.js';

runPermitsExpire()
  .then(async (r) => {
    console.log(r);
    await gracefulShutdown();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    try { await gracefulShutdown(); } catch { /* ignore */ }
    process.exit(1);
  });