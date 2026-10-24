// A.1.90.02 — Metrics-контроллер (STUB).
//
// ВНИМАНИЕ: файл — заглушка. 4 gauge (rps, latency_p95, error_rate,
// ws_active_connections) всегда 0. updateMetrics() экспортирована,
// но НИКЕМ не вызывается.
//
// TODO(techdebt): реализация — A.1.90.02.01 (roadmap).
//   Требует:
//   - prom-client (middleware http_requests_total с labels method/route/status);
//   - redis.info (clients, memory), db.pool (total/idle/waiting);
//   - audit_log.getQueueSize (S.0.01.05);
//   - WS-connection tracking (W.0.01.01);
//   - auth: IP whitelist или service account (сейчас /metrics публичный —
//     утечка в prod).
//   Потребители (I.2.01.01 prometheus.yml, I.2.01.02 grafana-dashboard.json)
//   сейчас пусты — реализация не имеет смысла до их появления.
//
// Рассинхрон имён: /metrics/json → 'latency_p95_ms',
// /metrics/health → 'latency_p95', Prometheus → 'charter_latency_p95_ms'.
// Оставлено как есть — клиенты должны знать.

import type { FastifyInstance } from 'fastify';

interface MetricsSnapshot {
  rps: number;
  latency_p95: number;
  error_rate: number;
  ws_active_connections: number;
}

// Заглушка с нулями. Prometheus-формат и сбор метрик — в следующих срезах.
let snapshot: MetricsSnapshot = {
  rps: 0,
  latency_p95: 0,
  error_rate: 0,
  ws_active_connections: 0,
};

/**
 * Точка расширения для сбора метрик (TODO: A.1.90.02.01).
 * Пока никем не вызывается — snapshot всегда в нулях.
 * @internal
 */
export function updateMetrics(partial: Partial<MetricsSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  // GET /metrics/json — JSON-формат
  app.get('/metrics/json', async () => ({
    metrics: [
      { name: 'rps', value: snapshot.rps },
      { name: 'latency_p95_ms', value: snapshot.latency_p95 },
      { name: 'error_rate', value: snapshot.error_rate },
      { name: 'ws_active_connections', value: snapshot.ws_active_connections },
    ],
  }));

  // GET /metrics/health — краткие метрики
  app.get('/metrics/health', async () => ({
    rps: snapshot.rps,
    latency_p95: snapshot.latency_p95,
    error_rate: snapshot.error_rate,
  }));

  // GET /metrics — Prometheus exposition format (пока заглушка)
  app.get('/metrics', async (_req, reply) => {
    reply.type('text/plain');
    return [
      `# HELP charter_rps Requests per second`,
      `# TYPE charter_rps gauge`,
      `charter_rps ${snapshot.rps}`,
      `# HELP charter_latency_p95_ms P95 latency in ms`,
      `# TYPE charter_latency_p95_ms gauge`,
      `charter_latency_p95_ms ${snapshot.latency_p95}`,
      `# HELP charter_error_rate Error rate`,
      `# TYPE charter_error_rate gauge`,
      `charter_error_rate ${snapshot.error_rate}`,
      `# HELP charter_ws_active_connections Active WS connections`,
      `# TYPE charter_ws_active_connections gauge`,
      `charter_ws_active_connections ${snapshot.ws_active_connections}`,
      '',
    ].join('\n');
  });
}