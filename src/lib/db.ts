// L.0.01.09 — DB-клиент PostgreSQL
// Primary + read-replica. Транзакции, health-check, retry.
// Прямой pg, без ORM. Все запросы параметризованные.

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { AppError } from '../core/errors.js';

// -------- Конфигурация --------

const PRIMARY_URL = process.env['DATABASE_URL'];
const REPLICA_URL = process.env['DATABASE_REPLICA_URL'] ?? PRIMARY_URL;
const PRIMARY_POOL_SIZE = Number(process.env['DB_POOL_SIZE'] ?? '20');
const REPLICA_POOL_SIZE = Number(process.env['DB_REPLICA_POOL_SIZE'] ?? '10');
const STATEMENT_TIMEOUT_MS = Number(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '30000');

if (!PRIMARY_URL) {
  throw new AppError('CONFIG', 'DATABASE_URL is not set', 500);
}

// -------- Pools --------

export const db: Pool = new Pool({
  connectionString: PRIMARY_URL,
  max: PRIMARY_POOL_SIZE,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: STATEMENT_TIMEOUT_MS,
});

export const dbRead: Pool = new Pool({
  connectionString: REPLICA_URL,
  max: REPLICA_POOL_SIZE,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: STATEMENT_TIMEOUT_MS,
});

db.on('error', (err) => {
   
  console.error('[db] unexpected pool error:', err.message);
});

dbRead.on('error', (err) => {
   
  console.error('[dbRead] unexpected pool error:', err.message);
});

// -------- Запросы --------

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res: QueryResult<T> = await db.query<T>(sql, params);
  return res.rows;
}

export async function queryRead<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res: QueryResult<T> = await dbRead.query<T>(sql, params);
  return res.rows;
}

export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const res = await db.query(sql, params);
  return res.rowCount ?? 0;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// -------- Транзакции --------

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw e;
  } finally {
    client.release();
  }
}

// -------- Детект ошибок PostgreSQL --------

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

function asPgError(e: unknown): PgError | null {
  if (e && typeof e === 'object' && 'code' in e) {return e as PgError;}
  return null;
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_DEADLOCK = '40P01';
const PG_SERIALIZATION_FAILURE = '40001';

export function isUniqueViolation(e: unknown): boolean {
  return asPgError(e)?.code === PG_UNIQUE_VIOLATION;
}

export function isForeignKeyViolation(e: unknown): boolean {
  return asPgError(e)?.code === PG_FK_VIOLATION;
}

export function isCheckViolation(e: unknown): boolean {
  return asPgError(e)?.code === PG_CHECK_VIOLATION;
}

export function isDeadlock(e: unknown): boolean {
  return asPgError(e)?.code === PG_DEADLOCK;
}

export function isSerializationFailure(e: unknown): boolean {
  return asPgError(e)?.code === PG_SERIALIZATION_FAILURE;
}

// -------- Retry --------

const RETRYABLE = new Set([PG_DEADLOCK, PG_SERIALIZATION_FAILURE]);

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const err = asPgError(e);
      if (!err?.code || !RETRYABLE.has(err.code)) {throw e;}
      // экспоненциальный backoff: 20ms, 40ms, 80ms
      const delay = 20 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// -------- Health-check --------

export interface DbHealth {
  primary: boolean;
  replica: boolean;
  lagMs: number | null;
}

export async function healthCheck(): Promise<DbHealth> {
  const [primary, replica] = await Promise.all([
    ping(db),
    ping(dbRead),
  ]);

  let lagMs: number | null = null;
  if (primary && replica && REPLICA_URL !== PRIMARY_URL) {
    try {
      const rows = await query<{ lag_seconds: string | null }>(
        `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::text AS lag_seconds`,
      );
      const v = rows[0]?.lag_seconds;
      lagMs = v ? Math.round(parseFloat(v) * 1000) : 0;
    } catch {
      lagMs = null;
    }
  }

  return { primary, replica, lagMs };
}

async function ping(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function getReplicaLag(): Promise<number | null> {
  if (REPLICA_URL === PRIMARY_URL) {return null;}
  try {
    const rows = await queryRead<{ lag_seconds: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::text AS lag_seconds`,
    );
    const v = rows[0]?.lag_seconds;
    return v ? Math.round(parseFloat(v) * 1000) : 0;
  } catch {
    return null;
  }
}

// -------- Graceful shutdown --------

export async function closeConnections(): Promise<void> {
  await Promise.all([db.end(), dbRead.end()]);
}