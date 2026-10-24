// scripts/test-system.ts
// I.9.04.49 — System (health + metrics + version).
//
// Покрытие:
//   - health: /health, /health/live, /health/ready, /health/startup.
//   - metrics: /metrics, /metrics/json, /metrics/health (stub, все 0).
//   - version: /version, /version/charter (revision_years из C.0.01.03),
//     /version/api.
//
// Все 10 эндпоинтов публичные — без auth (K8s probes + клиенты).
//
// Запуск: pnpm tsx scripts/test-system.ts

import 'dotenv/config';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

async function req<T = unknown>(path: string): Promise<{ status: number; data: T; contentType: string | null }> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T, contentType: res.headers.get('content-type') };
}

let OK = 0, FAIL = 0;
function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2).slice(0, 600));
}
function ok(m: string): void { OK++; console.log(`   ✓ ${m}`); }
function fail(m: string): void { FAIL++; console.log(`   ✗ ${m}`); }
function st(actual: number, expected: number, label: string): void {
  if (actual === expected) { ok(`${label} — HTTP ${actual}`); return; }
  fail(`${label} — ожидали ${expected}, получили ${actual}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) { ok(msg); return; }
  fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
}
function truthy(v: unknown, msg: string): void {
  if (v) { ok(msg); return; }
  fail(`${msg} — получено ${String(v)}`);
}
function summarize(): void {
  console.log(`\n─── Итог: ${OK}/${OK + FAIL} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {process.exitCode = 1;}
}

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  //  A.1.90.01 — Health
  // ═══════════════════════════════════════════════════════════

  // 1. GET /health
  {
    const r = await req<{ status: string; uptime: number; version: string }>('/health');
    log('GET /health', r.status, r.data);
    st(r.status, 200, 'health HTTP');
    eq(r.data.status, 'ok', 'health.status=ok');
    eq(typeof r.data.uptime, 'number', 'health.uptime:number');
    eq(typeof r.data.version, 'string', 'health.version:string');
    truthy(r.data.uptime > 0, `health.uptime > 0 (${r.data.uptime})`);
  }

  // 2. GET /health/live
  {
    const r = await req<{ status: string }>('/health/live');
    log('GET /health/live', r.status, r.data);
    st(r.status, 200, 'health/live HTTP');
    eq(r.data.status, 'ok', 'live.status=ok');
  }

  // 3. GET /health/ready
  {
    const r = await req<{
      status: string;
      checks: { db: string; db_replica: string; db_lag_ms: number | null; redis: string };
    }>('/health/ready');
    log('GET /health/ready', r.status, r.data);
    truthy(r.status === 200 || r.status === 503, `health/ready — 200 или 503 (получили ${r.status})`);
    if (r.status === 200) {
      eq(r.data.status, 'ok', 'ready.status=ok');
      eq(r.data.checks.db, 'ok', 'ready.checks.db=ok');
      eq(r.data.checks.redis, 'ok', 'ready.checks.redis=ok');
      truthy(r.data.checks.db_replica === 'ok' || r.data.checks.db_replica === 'fail',
        `ready.checks.db_replica:${r.data.checks.db_replica}`);
    }
  }

  // 4. GET /health/startup
  {
    const r = await req<{ status: string }>('/health/startup');
    log('GET /health/startup', r.status, r.data);
    st(r.status, 200, 'health/startup HTTP');
    eq(r.data.status, 'ok', 'startup.status=ok');
  }

  // ═══════════════════════════════════════════════════════════
  //  A.1.90.02 — Metrics (stub)
  // ═══════════════════════════════════════════════════════════

  // 5. GET /metrics — Prometheus
  {
    const r = await req<string>('/metrics');
    log('GET /metrics', r.status, typeof r.data === 'string' ? r.data.slice(0, 400) : r.data);
    st(r.status, 200, 'metrics HTTP');
    truthy(
      r.contentType?.includes('text/plain'),
      `metrics Content-Type: text/plain (получили ${r.contentType})`,
    );
    if (typeof r.data === 'string') {
      truthy(r.data.includes('charter_rps'), 'metrics: charter_rps');
      truthy(r.data.includes('charter_latency_p95_ms'), 'metrics: charter_latency_p95_ms');
      truthy(r.data.includes('charter_error_rate'), 'metrics: charter_error_rate');
      truthy(r.data.includes('charter_ws_active_connections'), 'metrics: charter_ws_active_connections');
      truthy(r.data.includes('# TYPE charter_rps gauge'), 'metrics: TYPE gauge');
    }
  }

  // 6. GET /metrics/json
  {
    const r = await req<{ metrics: Array<{ name: string; value: number }> }>('/metrics/json');
    log('GET /metrics/json', r.status, r.data);
    st(r.status, 200, 'metrics/json HTTP');
    truthy(Array.isArray(r.data.metrics), 'metrics/json.metrics:array');
    eq(r.data.metrics?.length, 4, 'metrics/json: 4 метрики');
    // Проверяем, что все значения 0 (stub).
    truthy(
      r.data.metrics?.every((m) => m.value === 0),
      'metrics/json: все значения 0 (stub)',
    );
    // Проверяем имя с суффиксом (расхождение с /metrics/health — в спеке).
    truthy(
      r.data.metrics?.some((m) => m.name === 'latency_p95_ms'),
      'metrics/json: name=latency_p95_ms (с суффиксом)',
    );
  }

  // 7. GET /metrics/health
  {
    const r = await req<{ rps: number; latency_p95: number; error_rate: number }>('/metrics/health');
    log('GET /metrics/health', r.status, r.data);
    st(r.status, 200, 'metrics/health HTTP');
    eq(typeof r.data.rps, 'number', 'metrics/health.rps:number');
    eq(typeof r.data.latency_p95, 'number', 'metrics/health.latency_p95:number');
    eq(typeof r.data.error_rate, 'number', 'metrics/health.error_rate:number');
    // stub: все 0
    eq(r.data.rps, 0, 'metrics/health.rps=0 (stub)');
    // Проверяем, что имя без _ms (расхождение с /metrics/json — в спеке).
    truthy('latency_p95' in r.data && !('latency_p95_ms' in r.data),
      'metrics/health: latency_p95 (без _ms)');
  }

  // ═══════════════════════════════════════════════════════════
  //  A.1.90.03 — Version
  // ═══════════════════════════════════════════════════════════

  // 8. GET /version
  {
    const r = await req<{
      api_version: string; charter_version: string; db_schema_version: string;
      build_hash: string; build_date: string;
    }>('/version');
    log('GET /version', r.status, r.data);
    st(r.status, 200, 'version HTTP');
    eq(r.data.api_version, '1.0.0', 'api_version=1.0.0');
    eq(r.data.charter_version, '5.0.0', 'charter_version=5.0.0');
    eq(r.data.db_schema_version, '0.0.01', 'db_schema_version=0.0.01');
    truthy(typeof r.data.build_hash === 'string', 'build_hash:string');
    truthy(typeof r.data.build_date === 'string', 'build_date:string');
  }

  // 9. GET /version/charter — P1: revision_years из C.0.01.03
  {
    const r = await req<{ version: string; revision_years: number }>('/version/charter');
    log('GET /version/charter', r.status, r.data);
    st(r.status, 200, 'version/charter HTTP');
    eq(r.data.version, '5.0.0', 'charter version=5.0.0');
    eq(r.data.revision_years, 5, 'revision_years=5 (CHARTER_REVISION_YEARS)');
  }

  // 10. GET /version/api
  {
    const r = await req<{ version: string; deprecated: boolean }>('/version/api');
    log('GET /version/api', r.status, r.data);
    st(r.status, 200, 'version/api HTTP');
    eq(r.data.version, '1.0.0', 'api version=1.0.0');
    eq(r.data.deprecated, false, 'deprecated=false');
  }

  console.log('\n✅ System (health + metrics + version) замкнут');
}

main()
  .catch((e) => { FAIL++; console.error('\n❌', e instanceof Error ? e.message : e); })
  .finally(async () => {
    summarize();
    try { await gracefulShutdown(); } catch { /* ignore */ }
  });