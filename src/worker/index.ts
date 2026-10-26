// I.9.07.01 — Worker entry point.src/worker/index.ts
//
// Polling loop: claim → handler → complete/fail.
// Cleanup: setInterval(24 часа). Без cron-эндпоинта и без cronjob-манифеста.
//
// Запуск:
//   pnpm dev:worker      (tsx watch)
//   pnpm start:worker    (node dist/worker/index.js, после pnpm build)
//
// Graceful shutdown через L.0.01.12 (gracefulShutdown): closeAudit → closeDb
// + closeRedis. Сигналы: SIGTERM, SIGINT.

import 'dotenv/config';

import { writeFile } from 'node:fs/promises';

import {
  claim,
  fail,
  cleanupOldJobs,
  type Job,
} from '../lib/jobs.js';
import { escalateOverdue } from '../core/otc/service.js';
import { processExpired } from '../core/mandates/service.js';
import { escalateOverdueQuestions } from '../core/questions/service.js';
import { flagOverdueProposals } from '../core/proposals/service.js';
import { logger } from '../lib/logger.js';
import { gracefulShutdown } from '../lib/shutdown.js';

import {
  handleBulkNotify,
  handleBulkTasksAssign,
  handleBulkFlowsCharge,
  handleBulkRolesGrant,
  handleBulkExport,
} from './handlers/bulk.js';
import {
  handleExportParticipants,
  handleExportPlans,
  handleExportGoods,
  handleExportArchive,
  handleExportAuditLog,
} from './handlers/exports.js';
import {
  handleImportParticipants,
  handleImportGoods,
  handleImportDictionary,
} from './handlers/imports.js';

// ─── Константы ───────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_DAYS_OLD = 30;
const GOVERNANCE_INTERVAL_MS = 60 * 60 * 1000; // SLA-эскалация и истечение мандатов

// ─── Состояние ───────────────────────────────────────────────────

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Dispatch по типу задачи ────────────────────────────────────

async function handleJob(job: Job): Promise<void> {
  switch (job.type) {
    case 'export.participants':
      await handleExportParticipants(job);
      return;
    case 'export.plans':
      await handleExportPlans(job);
      return;
    case 'export.goods':
      await handleExportGoods(job);
      return;
    case 'export.archive':
      await handleExportArchive(job);
      return;
    case 'export.audit-log':
      await handleExportAuditLog(job);
      return;
    case 'import.participants':
      await handleImportParticipants(job);
      return;
    case 'import.goods':
      await handleImportGoods(job);
      return;
    case 'import.dictionary':
      await handleImportDictionary(job);
      return;
    case 'bulk.notify':
      await handleBulkNotify(job);
      return;
    case 'bulk.tasks.assign':
      await handleBulkTasksAssign(job);
      return;
    case 'bulk.flows.charge':
      await handleBulkFlowsCharge(job);
      return;
    case 'bulk.roles.grant':
      await handleBulkRolesGrant(job);
      return;
    case 'bulk.export':
      await handleBulkExport(job);
      return;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

// ─── Основной loop ──────────────────────────────────────────────

async function loop(): Promise<void> {
  while (!shuttingDown) {
    let job: Job | null = null;
    try {
      job = await claim();
    } catch (e) {
      logger.error({ err: e }, 'worker: claim failed');
      await sleep(POLL_INTERVAL_MS);
      await writeFile('/tmp/worker-alive', String(Date.now())).catch(() => {});
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      await writeFile('/tmp/worker-alive', String(Date.now())).catch(() => {});
      continue;
    }

    logger.info(
      { jobId: job.id, type: job.type, createdBy: job.createdBy },
      'worker: claimed',
    );

    try {
      await handleJob(job);
      logger.info({ jobId: job.id, type: job.type }, 'worker: completed');
    } catch (e) {
      logger.error({ err: e, jobId: job.id, type: job.type }, 'worker: handler failed');
      try {
        await fail(job.id, e);
      } catch (e2) {
        logger.error({ err: e2, jobId: job.id }, 'worker: fail() failed');
      }
    }
  }
}

// ─── Cleanup (раз в сутки) ─────────────────────────────────────

async function runCleanup(): Promise<void> {
  try {
    const r = await cleanupOldJobs(CLEANUP_DAYS_OLD);
    logger.info(r, 'worker: cleanup done');
  } catch (e) {
    logger.warn({ err: e }, 'worker: cleanup failed');
  }
}

// ─── Entry point ───────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info(
    { pollMs: POLL_INTERVAL_MS, cleanupMs: CLEANUP_INTERVAL_MS, cleanupDays: CLEANUP_DAYS_OLD },
    'worker: starting',
  );

  // Первый cleanup сразу — на случай, если сервис был выключен давно.
  void runCleanup();

  // Регулярный cleanup.
  const cleanupTimer = setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

// Управленческий контур: SLA-эскалация ОТК и истечение мандатов.
async function runGovernance(): Promise<void> {
  try {
    const escalations = await escalateOverdue();
    const mandates = await processExpired();
    const questions = await escalateOverdueQuestions();
    const proposals = await flagOverdueProposals();
    logger.info({ escalations, mandates, questions, proposals }, 'worker: governance done');
  } catch (e) {
    logger.warn({ err: e }, 'worker: governance failed');
  }
}
void runGovernance();
const governanceTimer = setInterval(() => {
  void runGovernance();
}, GOVERNANCE_INTERVAL_MS);
governanceTimer.unref();

  // Graceful shutdown.
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) {return;}
    shuttingDown = true;
    logger.info({ signal }, 'worker: shutting down');
    clearInterval(cleanupTimer);
    clearInterval(governanceTimer);
    try {
      await gracefulShutdown();
      process.exit(0);
    } catch (e) {
      logger.error({ err: e }, 'worker: shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  // Main loop (blocking, пока не shuttingDown).
  await loop();

  logger.info({}, 'worker: loop ended');
}

main().catch((e) => {
  console.error('Fatal worker startup error:', e);
  process.exit(1);
});