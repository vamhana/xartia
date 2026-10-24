// src/web/pages/Balance.tsx
/**
 * F.4.02.10 — Balance page.
 *
 * Метрики + пульс + аномалии + мета-запросы + нормативы + риски + индексы.
 * WS-подписка на balance.* события.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost, apiDelete } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chart, MetricCard } from '../components/ui/Chart';
import { Form, FormInput, FormTextarea } from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type AnomalyType =
  | 'speed' | 'format' | 'etiquette' | 'priority' | 'iteration';
type AnomalyStatus = 'new' | 'analyzed' | 'resolved';
type GuardianIndexType =
  | 'defense_maturity' | 'excess_capacity' | 'import_dependency';

interface Anomaly {
  id: string;
  type: AnomalyType;
  directionId: string;
  severity: number;
  status: AnomalyStatus;
  metaRequestId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface BalanceMetricsSnapshot {
  directionId: string | null;
  period: string | null;
  metrics: Record<string, number>;
}

interface PulseData {
  directionId: string | null;
  metrics: Record<string, number>;
}

interface NormativeSpeed {
  id: string;
  priority: string;
  deadlineMs: number;
  version: number;
  publishedAt: string;
}

interface CompetenceRisk {
  id: string;
  directionId: string;
  status: string;
  reason: string;
  verifiedBy: string | null;
  validFrom: string;
  validTo: string | null;
}

interface GuardianIndex {
  id: string;
  type: GuardianIndexType;
  value: number;
  directionId: string | null;
  createdAt: string;
}

// ─── Константы ───────────────────────────────────────────────────

const ANOMALY_TYPE_LABEL: Record<AnomalyType, string> = {
  speed: 'Скорость',
  format: 'Формат',
  etiquette: 'Этикет',
  priority: 'Приоритет',
  iteration: 'Итерации',
};

const ANOMALY_STATUS_LABEL: Record<AnomalyStatus, string> = {
  new: 'Новая',
  analyzed: 'Проанализирована',
  resolved: 'Решена',
};

const ANOMALY_STATUS_TONE: Record<AnomalyStatus, BadgeTone> = {
  new: 'warning',
  analyzed: 'info',
  resolved: 'success',
};

const INDEX_LABEL: Record<GuardianIndexType, string> = {
  defense_maturity: 'Защитная зрелость',
  excess_capacity: 'Избыточная ёмкость',
  import_dependency: 'Импортозависимость',
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Критический',
  high: 'Высокий',
  standard: 'Стандартный',
  background: 'Фоновый',
};

// ─── Хелперы ─────────────────────────────────────────────────────

function severityTone(s: number): BadgeTone {
  if (s >= 8) {return 'critical';}
  if (s >= 6) {return 'high';}
  if (s >= 4) {return 'standard';}
  return 'default';
}

function formatMs(ms: number): string {
  if (ms < 1000) {return `${ms} мс`;}
  const s = Math.round(ms / 1000);
  if (s < 60) {return `${s} с`;}
  const m = Math.round(s / 60);
  if (m < 60) {return `${m} мин`;}
  return `${Math.round(m / 60)} ч`;
}

// ─── Страница ────────────────────────────────────────────────────

interface OverdueTaskRow {
  id: string;
  externalId: string;
  description: string;
  directionNumber: number | null;
  daysLate: number;
  status: string;
}

/**
 * Отклонения планов — рабочий индикатор балансировки.
 * По Хартии балансировка не решает за направление: она замечает отклонение
 * и поднимает сигнал, чтобы направление проверило участок.
 */


function OverdueBlock(): ReactElement {
  const qc = useQueryClient();
  const q = useApiQuery<{ data: OverdueTaskRow[]; meta: { total: number } }>(
    ['balance', 'overdue'],
    '/tasks/overdue',
  );
  const scanM = useMutation({
    mutationFn: () => apiPost<{ data: { tasks: number; created: number; skipped: number } }>(
      '/tasks/overdue/scan',
      {},
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['balance', 'overdue'] });
      void qc.invalidateQueries({ queryKey: ['signals'] });
    },
  });
  const rows = q.data?.data ?? [];

  return (
    <Card
      title="Не сданы в ОТК"
      subtitle="Срок истёк, отчёта нет: ОТК нечего проверять — сигнал направлению"
    >
      {q.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p style={styles.muted}>Все задачи в срок переданы на проверку.</p>
      ) : (
        <>
          <Table<OverdueTaskRow>
            data={rows}
            getRowId={(r) => r.id}
            columns={[
              {
                key: 'task',
                title: 'Задача',
                render: (r) => (
                  <div>
                    <div>{r.description}</div>
                    <div style={styles.muted}>{r.externalId}</div>
                  </div>
                ),
              },
              {
                key: 'direction',
                title: 'Направление',
                width: 130,
                render: (r) => (r.directionNumber ? `№${r.directionNumber}` : '—'),
              },
              {
                key: 'late',
                title: 'Просрочка',
                width: 120,
                align: 'right',
                render: (r) => `${r.daysLate} дн.`,
              },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <Button
              variant="secondary"
              loading={scanM.isPending}
              onClick={() => scanM.mutate()}
            >
              Поднять сигналы направлениям
            </Button>
            {scanM.data && (
              <span style={{ ...styles.muted, marginLeft: 12 }}>
                задач {scanM.data.data.tasks}, новых сигналов {scanM.data.data.created}
                {scanM.data.data.skipped > 0 ? `, пропущено ${scanM.data.data.skipped}` : ''}
              </span>
            )}
            {scanM.isError && (
              <span style={{ color: colors.warning, marginLeft: 12 }}>
                {scanM.error instanceof Error ? scanM.error.message : 'Ошибка'}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

interface OversightSignal {
  id: string;
  externalId: string;
  status: string;
  description: string;
}

interface OversightNode {
  kind: 'plan' | 'branch' | 'cell' | 'person';
  id: string;
  title: string;
  subtitle: string;
  coordinator: string | null;
  directionId: string | null;
  planId: string;
  total: number;
  done: number;
  overdue: number;
  early: number;
  people: number;
  signals: OversightSignal[];
  children: OversightNode[];
}

const OVERSIGHT_KIND_LABEL: Record<OversightNode['kind'], string> = {
  plan: 'План',
  branch: 'Ветка',
  cell: 'Ячейка',
  person: 'Человек',
};

/**
 * Дерево надзора: микрорайон → дом → ячейка → человек.
 * Балансировка видит, где именно провал, и поднимает сигнал Совету
 * направления прямо из узла; Совет видит то же дерево и может связаться
 * с координатором ячейки или исполнителем.
 */
function OversightBlock(): ReactElement {
  const qc = useQueryClient();
  const q = useApiQuery<{ data: OversightNode[] }>(
    ['balance', 'oversight'],
    '/plans/oversight',
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const signalM = useMutation({
    mutationFn: (node: OversightNode) =>
      apiPost('/signals', {
        type: 'problem',
        description: `[ветка:${node.id}] ${node.title}: требуется проверка (балансировка)`,
        justification:
          `Балансировка: ${node.title} — принято ${node.done} из ${node.total}, `
          + `просрочено ${node.overdue}. Просьба проверить участок и решить вопрос.`,
        priority: node.overdue > 2 ? 'high' : 'standard',
        ...(node.directionId
          ? { directions: [node.directionId], lead_direction_id: node.directionId }
          : {}),
        subject_plan_id: node.planId,
        ...(node.kind === 'branch' ? { subject_task_id: node.id } : {}),
        ...(node.kind === 'cell' || node.kind === 'person'
          ? node.kind === 'cell'
            ? { subject_cell_id: node.id }
            : { subject_task_id: node.id }
          : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['balance', 'oversight'] });
      void qc.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Не удалось поднять сигнал'),
  });

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {next.delete(id);} else {next.add(id);}
      return next;
    });
  };

  const renderNode = (node: OversightNode, depth: number): ReactElement => {
    const isOpen = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={`${node.kind}-${node.id}`}>
        <div
          style={{
            ...styles.ovRow,
            paddingLeft: spacing.sm + depth * 16,
            background: node.kind === 'plan' ? colors.bgSoft : 'transparent',
          }}
        >
          {/* Первая линия: что это и кто. Вторая: счётчики, координатор,
              кнопка. Раньше всё стояло в одну строку и на узкой панели
              координатор и кнопка уезжали за край. */}
          <div style={styles.ovMain}>
            <button
              type="button"
              style={styles.ovToggle}
              onClick={() => toggle(node.id)}
              disabled={!hasChildren}
            >
              {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
            </button>
            <span style={styles.ovKind}>{OVERSIGHT_KIND_LABEL[node.kind]}</span>
            <span style={styles.ovTitle}>{node.title}</span>
            <span style={styles.ovSub}>{node.subtitle}</span>
          </div>
          <div style={styles.ovMeta}>
            <span style={styles.ovCounts}>
              <span style={{ color: colors.danger }}>−{node.overdue}</span>
              <span style={{ color: colors.success }}>+{node.early}</span>
              <span style={{ color: colors.textMuted }}>{node.done}/{node.total}</span>
            </span>
            <span style={styles.ovPeople}>чел.: {node.people}</span>
            {node.kind !== 'person' ? (
              <span style={styles.ovCoord}>
                {node.kind === 'plan' ? 'Куратор' : 'Координатор'}:{' '}
                {node.coordinator ?? 'не назначен'}
              </span>
            ) : null}
            {node.signals.length > 0 ? (
              <Badge tone="danger">{`сигналов: ${node.signals.length}`}</Badge>
            ) : null}
            {node.kind === 'cell' || node.kind === 'person' || node.kind === 'branch' ? (
              <Button
                variant="secondary"
                size="sm"
                loading={signalM.isPending}
                onClick={() => signalM.mutate(node)}
              >
                Сигнал Совету
              </Button>
            ) : null}
          </div>
        </div>
        {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const plans = q.data?.data ?? [];

  return (
    <Card
      title="Дерево надзора"
      subtitle="Микрорайон → дом → ячейка → человек: где просрочка, где сигнал, кто координатор"
    >
      {q.isLoading ? (
        <Spinner />
      ) : plans.length === 0 ? (
        <p style={styles.muted}>
          Активных планов нет. Как только план взят в работу, здесь появится
          дерево участков.
        </p>
      ) : (
        <div style={styles.ovTree}>
          {plans.map((plan) => renderNode(plan, 0))}
        </div>
      )}
      {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{error}</p>}
    </Card>
  );
}

export function BalancePage(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [directionFilter, setDirectionFilter] = useState('');
  const [anomalyStatus, setAnomalyStatus] = useState('');
  const [metaRequestFor, setMetaRequestFor] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const directionId = directionFilter || user?.participant.directionId || '';

  const metricsQ = useApiQuery<BalanceMetricsSnapshot>(
    ['balance', 'metrics', directionId],
    `/balance/metrics${directionId ? `?direction_id=${directionId}` : ''}`,
  );
  const pulseQ = useApiQuery<PulseData>(
    ['balance', 'pulse', directionId],
    `/balance/pulse${directionId ? `?direction_id=${directionId}` : ''}`,
  );
  const anomaliesQ = useApiQuery<{ data: Anomaly[]; meta: { total: number } }>(
    ['balance', 'anomalies', anomalyStatus, directionId],
    `/balance/anomalies?page=1&per_page=100${anomalyStatus ? `&status=${anomalyStatus}` : ''}${directionId ? `&direction_id=${directionId}` : ''}`,
  );
  const normsQ = useApiQuery<{ data: NormativeSpeed[] }>(
    ['balance', 'norms'],
    '/balance/norms',
  );
  const risksQ = useApiQuery<{ data: CompetenceRisk[] }>(
    ['balance', 'risks'],
    '/balance/risks',
  );
  const indicesQ = useApiQuery<{ data: GuardianIndex[] }>(
    ['balance', 'indices'],
    '/balance/indices',
  );

  // WS
  useWSSubscription('balance', (event) => {
    if (
      event === 'balance.anomaly' ||
      event === 'balance.anomaly_resolved' ||
      event === 'balance.meta_request' ||
      event === 'balance.norms_updated' ||
      event === 'balance.competence_risk' ||
      event === 'balance.pulse_updated'
    ) {
      void qc.invalidateQueries({ queryKey: ['balance'] });
    }
  });

  const detectM = useMutation({
    mutationFn: () =>
      apiPost<{ detected: number; persisted: number; anomalies: Anomaly[] }>(
        '/balance/detect',
        directionId ? { direction_id: directionId } : {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['balance'] });
      setDetecting(false);
    },
  });

  const recalcM = useMutation({
    mutationFn: () => apiPost('/balance/norms/recalc', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['balance', 'norms'] }),
  });

  const anomalies = anomaliesQ.data?.data ?? [];
  const risks = risksQ.data?.data ?? [];
  const indices = indicesQ.data?.data ?? [];

  const anomalyColumns: Column<Anomaly>[] = useMemo(
    () => [
      {
        key: 'severity',
        title: 'Severity',
        width: 100,
        sortable: true,
        render: (r) => (
          <Badge tone={severityTone(r.severity)}>{String(r.severity)}</Badge>
        ),
      },
      {
        key: 'type',
        title: 'Тип',
        width: 130,
        render: (r) => ANOMALY_TYPE_LABEL[r.type] ?? r.type,
      },
      {
        key: 'status',
        title: 'Статус',
        width: 140,
        render: (r) => (
          <Badge tone={ANOMALY_STATUS_TONE[r.status]}>
            {ANOMALY_STATUS_LABEL[r.status]}
          </Badge>
        ),
      },
      {
        key: 'createdAt',
        title: 'Создана',
        render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
      },
      {
        key: 'actions',
        title: '',
        width: 200,
        render: (r) => (
          <AnomalyActions
            anomaly={r}
            onMetaRequest={() => setMetaRequestFor(r.id)}
          />
        ),
      },
    ],
    [],
  );

  const riskColumns: Column<CompetenceRisk>[] = useMemo(
    () => [
      { key: 'reason', title: 'Причина' },
      {
        key: 'validFrom',
        title: 'С',
        width: 120,
        render: (r) => new Date(r.validFrom).toLocaleDateString('ru-RU'),
      },
      {
        key: 'actions',
        title: '',
        width: 60,
        render: (r) => <DeleteRiskButton riskId={r.id} />,
      },
    ],
    [],
  );

  // Данные для графика индексов
  const indexChartData = indices.map((i) => ({
    name: INDEX_LABEL[i.type] ?? i.type,
    value: Number((i.value * 100).toFixed(1)),
  }));

  // Пульс — плоский объект метрик
  const pulseMetrics = pulseQ.data?.metrics ?? {};
  const pulseChartData = Object.entries(pulseMetrics).map(([k, v]) => ({
    name: k,
    value: Number(v),
  }));

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Балансировка</h1>
        <div style={styles.headerActions}>
          <input
            style={styles.input}
            placeholder="UUID направления (опционально)"
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => setDetecting(true)}
            disabled={detectM.isPending}
          >
            {detectM.isPending ? '…' : 'Detect аномалий'}
          </Button>
        </div>
      </div>

      {/* Метрики */}
      <div style={styles.metricRow}>
        <MetricCard
          value={metricsQ.data?.metrics?.['open_signals'] ?? '—'}
          label="Открытых сигналов"
        />
        <MetricCard
          value={metricsQ.data?.metrics?.['active_tasks'] ?? '—'}
          label="Активных задач"
        />
        <MetricCard
          value={metricsQ.data?.metrics?.['overdue_tasks'] ?? '—'}
          label="Просрочено"
        />
        <MetricCard
          value={anomaliesQ.data?.meta?.total ?? '—'}
          label="Аномалий"
        />
      </div>

      {/* Пульс + Индексы */}
      <div style={styles.twoCol}>
        <OversightBlock />

        <OverdueBlock />

        <Card title="Пульс">
          {pulseChartData.length === 0 ? (
            <p style={styles.muted}>Нет данных</p>
          ) : (
            <Chart
              type="bar"
              data={pulseChartData}
              config={{
                xKey: 'name',
                series: [{ key: 'value', label: 'Значение' }],
              }}
              height={220}
            />
          )}
        </Card>

        <Card title="Индексы Стражей">
          {indexChartData.length === 0 ? (
            <p style={styles.muted}>Нет данных</p>
          ) : (
            <>
              <Chart
                type="bar"
                data={indexChartData}
                config={{
                  xKey: 'name',
                  series: [{ key: 'value', label: '%' }],
                }}
                height={200}
              />
              <div style={styles.indexValues}>
                {indices.map((i) => (
                  <div key={i.id} style={styles.indexRow}>
                    <span>{INDEX_LABEL[i.type] ?? i.type}</span>
                    <strong>{(i.value * 100).toFixed(1)}%</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Аномалии */}
      <Card
        title="Аномалии"
        subtitle={`Всего ${anomaliesQ.data?.meta?.total ?? 0}`}
        actions={
          <select
            value={anomalyStatus}
            onChange={(e) => setAnomalyStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(ANOMALY_STATUS_LABEL) as AnomalyStatus[]).map((s) => (
              <option key={s} value={s}>
                {ANOMALY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        }
      >
        {anomaliesQ.isLoading ? (
          <Spinner />
        ) : (
          <Table<Anomaly>
            data={anomalies}
            columns={anomalyColumns}
            getRowId={(r) => r.id}
            emptyMessage="Аномалий нет"
          />
        )}
      </Card>

      {/* Нормативы */}
      <Card
        title="Нормативы скоростей"
        subtitle={`Версий: ${normsQ.data?.data?.length ?? 0}`}
        actions={
          <Button
            variant="secondary"
            onClick={() => void recalcM.mutateAsync()}
            disabled={recalcM.isPending}
          >
            {recalcM.isPending ? '…' : 'Пересчитать'}
          </Button>
        }
      >
        {normsQ.data?.data?.length === 0 ? (
          <p style={styles.muted}>Нормативы не заданы. Нажмите «Пересчитать».</p>
        ) : (
          <div style={styles.normsGrid}>
            {(normsQ.data?.data ?? []).map((n) => (
              <div key={n.id} style={styles.normRow}>
                <span style={styles.normPriority}>
                  {PRIORITY_LABEL[n.priority] ?? n.priority}
                </span>
                <span style={styles.normValue}>{formatMs(n.deadlineMs)}</span>
                <span style={styles.normVersion}>v{n.version}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Риски */}
      <Card
        title="Компетентностные риски"
        subtitle={`Активных: ${risks.length}`}
        actions={<AddRiskButton directionId={directionId} />}
      >
        {risksQ.isLoading ? (
          <Spinner />
        ) : (
          <Table<CompetenceRisk>
            data={risks}
            columns={riskColumns}
            getRowId={(r) => r.id}
            emptyMessage="Рисков нет"
          />
        )}
      </Card>

      {/* Модалки */}
      {metaRequestFor ? (
        <MetaRequestModal
          anomalyId={metaRequestFor}
          onClose={() => setMetaRequestFor(null)}
        />
      ) : null}

      {detecting ? (
        <DetectResultModal
          result={detectM.data ?? null}
          pending={detectM.isPending}
          onClose={() => {
            setDetecting(false);
            detectM.reset();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Кнопки действий аномалии ────────────────────────────────────

function AnomalyActions({
  anomaly,
  onMetaRequest,
}: {
  anomaly: Anomaly;
  onMetaRequest: () => void;
}): ReactElement {
  const qc = useQueryClient();

  const resolveM = useMutation({
    mutationFn: () =>
      apiPost<Anomaly>(`/balance/anomalies/${anomaly.id}/resolve`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['balance'] }),
  });

  const metaReqDisabled =
    anomaly.metaRequestId !== null || anomaly.status === 'resolved';

  return (
    <div style={styles.rowActions}>
      <Button
        variant="ghost"
        onClick={() => void resolveM.mutateAsync()}
        disabled={resolveM.isPending || anomaly.status === 'resolved'}
      >
        {resolveM.isPending ? '…' : 'Решить'}
      </Button>
      <Button
        variant="ghost"
        onClick={onMetaRequest}
        disabled={metaReqDisabled}
      >
        Мета-запрос
      </Button>
    </div>
  );
}

function DeleteRiskButton({ riskId }: { riskId: string }): ReactElement {
  const qc = useQueryClient();
  const delM = useMutation({
    mutationFn: () => apiDelete<void>(`/balance/risks/${riskId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['balance', 'risks'] }),
  });
  return (
    <button
      type="button"
      style={styles.removeBtn}
      onClick={() => void delM.mutateAsync()}
      disabled={delM.isPending}
    >
      ×
    </button>
  );
}

// ─── Модалка мета-запроса ────────────────────────────────────────

const metaRequestSchema = z.object({
  target_directions_text: z
    .string()
    .min(1, 'Укажите хотя бы одно направление'),
});

type MetaRequestForm = z.infer<typeof metaRequestSchema>;

function MetaRequestModal({
  anomalyId,
  onClose,
}: {
  anomalyId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (targetDirections: string[]) =>
      apiPost(`/balance/anomalies/${anomalyId}/meta-request`, {
        target_directions: targetDirections,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['balance'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось создать'),
  });

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Мета-запрос">
          <Form<MetaRequestForm>
            schema={metaRequestSchema}
            defaultValues={{ target_directions_text: '' }}
            submitLabel="Создать"
            onCancel={onClose}
            loading={createM.isPending}
            onSubmit={async (data) => {
              setErr(null);
              const ids = data.target_directions_text
                .split(/[,\s;]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              await createM.mutateAsync(ids);
            }}
          >
            <FormTextarea
              name="target_directions_text"
              label="Целевые направления (UUID, через запятую) — например, 43cf7775-...,a2d6bb8f-..."
              rows={3}
              required
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Кнопка добавления риска ─────────────────────────────────────

const addRiskSchema = z.object({
  direction_id: z.string().uuid('UUID направления'),
  reason: z.string().min(1, 'Укажите причину').max(1000),
});

type AddRiskForm = z.infer<typeof addRiskSchema>;

function AddRiskButton({ directionId }: { directionId: string }): ReactElement {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addM = useMutation({
    mutationFn: (data: AddRiskForm) => apiPost('/balance/risks', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['balance', 'risks'] });
      setOpen(false);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось добавить'),
  });

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Добавить
      </Button>
    );
  }

  return (
    <div style={styles.modalBackdrop} onClick={() => setOpen(false)}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Новый риск">
          <Form<AddRiskForm>
            schema={addRiskSchema}
            defaultValues={{ direction_id: directionId, reason: '' }}
            submitLabel="Добавить"
            onCancel={() => setOpen(false)}
            loading={addM.isPending}
            onSubmit={async (data) => {
              setErr(null);
              await addM.mutateAsync(data);
            }}
          >
            <FormInput
              name="direction_id"
              label="UUID направления"
              required
            />
            <FormTextarea
              name="reason"
              label="Причина"
              rows={3}
              required
              maxLength={1000}
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Модалка detect ──────────────────────────────────────────────

function DetectResultModal({
  result,
  pending,
  onClose,
}: {
  result: { detected: number; persisted: number; anomalies: Anomaly[] } | null;
  pending: boolean;
  onClose: () => void;
}): ReactElement {
  return (
    <div style={styles.modalBackdrop} onClick={pending ? undefined : onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card
          title="Детект аномалий"
          subtitle="Тройной кросс-доменный вызов (AI + Balance + WS)"
        >
          {pending ? (
            <Spinner label="Анализ…" />
          ) : !result ? (
            <p style={styles.muted}>Нет данных</p>
          ) : (
            <>
              <div style={styles.detectStats}>
                <MetricCard value={result.detected} label="Найдено" />
                <MetricCard value={result.persisted} label="Сохранено" />
                <MetricCard
                  value={result.anomalies.length}
                  label="Всего вернулось"
                />
              </div>
              {result.anomalies.length > 0 ? (
                <div style={styles.subBlock}>
                  <div style={styles.subBlockTitle}>Обнаруженные</div>
                  {result.anomalies.slice(0, 10).map((a) => (
                    <div key={a.id} style={styles.detectRow}>
                      <Badge tone={severityTone(a.severity)}>{String(a.severity)}</Badge>
                      <span>{ANOMALY_TYPE_LABEL[a.type] ?? a.type}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button variant="ghost" onClick={onClose}>Закрыть</Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  ovTree: {
    display: 'flex',
    flexDirection: 'column' as const,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
  },
  ovRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  ovMain: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  ovMeta: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: 10,
    paddingLeft: 28,
  },
  ovToggle: {
    width: 22,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: 13,
  },
  ovKind: { color: colors.textDim, fontSize: fontSize.xs, minWidth: 56 },
  ovTitle: { fontWeight: 500 },
  ovSub: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    flex: 1,
    minWidth: 100,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  ovPeople: { color: colors.textMuted, fontSize: fontSize.xs, whiteSpace: 'nowrap' as const },
  ovCounts: { display: 'flex', gap: 8, fontSize: fontSize.xs, whiteSpace: 'nowrap' as const },
  ovCoord: { color: colors.text, fontSize: fontSize.xs, whiteSpace: 'nowrap' as const },

  page: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
  },
  headerActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  title: { margin: 0, fontSize: 22, color: colors.text },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    minWidth: 280,
  },
  select: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
  },
  metricRow: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: spacing.md,
  },
  twoCol: {
    display: 'grid' as const,
    gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
    gap: spacing.md,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  rowActions: {
    display: 'flex' as const,
    gap: spacing.sm,
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.danger,
    cursor: 'pointer' as const,
    fontSize: 16,
    lineHeight: 1,
    padding: '0 6px',
  },
  normsGrid: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  normRow: {
    display: 'grid' as const,
    gridTemplateColumns: '1fr 120px 60px',
    gap: spacing.md,
    alignItems: 'center' as const,
    padding: '6px 10px',
    background: colors.bgInput,
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
  },
  normPriority: { color: colors.text },
  normValue: { color: colors.text, fontWeight: 600 },
  normVersion: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right' as const },
  indexValues: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    marginTop: spacing.sm,
  },
  indexRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    padding: '8px 12px',
  },
  modalBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 100,
    padding: spacing.lg,
  },
  modal: { width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const },
  detectStats: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  subBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
    marginBottom: spacing.md,
  },
  subBlockTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  detectRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    fontSize: fontSize.sm,
  },
};