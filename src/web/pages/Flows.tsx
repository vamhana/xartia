// src/web/pages/Flows.tsx
/**
 * F.4.02.02 — Flows page.
 *
 * Балансы по 6 типам Потоков, Капсула, резервы, возврат.
 * История транзакций недоступна — A.1.14.01 не имеет GET /flows/transactions.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';

import { apiPost } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chart, FlowIndicator, MetricCard, ProgressBar } from '../components/ui/Chart';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type FlowType =
  | 'main'
  | 'reflective'
  | 'council'
  | 'mentoring'
  | 'creation'
  | 'cross_direction';

interface FlowBalance {
  type: FlowType;
  balance: number;
}

interface Capsule {
  participantId: string;
  balance: number;
  updatedAt: string;
}

interface ReturnsInfo {
  percent: number;
  nextReturnAt: string | null;
  status: string;
}

interface DeferredFlow {
  totalVolume: number;
  distributed: number;
  available: number;
}

interface FreedomReserve {
  totalVolume: number;
  accessible: boolean;
}

interface PlanetaryReserve {
  totalVolume: number;
  distributed: number;
  available: number;
}

// ─── Константы ───────────────────────────────────────────────────

const CAPSULE_MAX = 180;

const TYPE_LABEL: Record<FlowType, string> = {
  main: 'Основной',
  reflective: 'Рефлексивный',
  council: 'Совет',
  mentoring: 'Наставничество',
  creation: 'Созидание',
  cross_direction: 'Межнаправленный',
};

// ─── Страница ────────────────────────────────────────────────────

export function FlowsPage(): ReactElement {
  const balancesQ = useApiQuery<{ data: FlowBalance[] }>(
    ['flows'],
    '/flows',
  );
  const capsuleQ = useApiQuery<Capsule>(
    ['flows', 'capsule'],
    '/flows/capsule',
  );
  const returnsQ = useApiQuery<ReturnsInfo | null>(
    ['flows', 'returns'],
    '/flows/returns',
  );
  const deferredQ = useApiQuery<DeferredFlow>(
    ['flows', 'deferred'],
    '/flows/deferred',
  );
  const freedomQ = useApiQuery<FreedomReserve>(
    ['flows', 'freedom-reserve'],
    '/flows/freedom-reserve',
  );
  const planetaryQ = useApiQuery<PlanetaryReserve>(
    ['flows', 'planetary-reserve'],
    '/flows/planetary-reserve',
  );

  const balances = balancesQ.data?.data ?? [];
  const mainBalance =
    balances.find((b) => b.type === 'main')?.balance ?? 0;
  const capsule = capsuleQ.data;
  const returns = returnsQ.data ?? null;

  const pieData = balances.map((b) => ({
    name: TYPE_LABEL[b.type] ?? b.type,
    value: Number(b.balance ?? 0),
  }));

  if (balancesQ.isLoading || capsuleQ.isLoading) {
    return <Spinner label="Загружаем Потоки…" />;
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Потоки</h1>

      {/* Верхний ряд метрик */}
      <div style={styles.metricRow}>
        <MetricCard
          value={mainBalance}
          label="Основной баланс"
        />
        <MetricCard
          value={capsule ? `${capsule.balance} / ${CAPSULE_MAX}` : '—'}
          label="Капсула"
        />
        <MetricCard
          value={returns ? `${returns.percent}%` : '—'}
          label="Ставка возврата"
          hint={
            returns?.nextReturnAt
              ? `Следующий: ${new Date(returns.nextReturnAt).toLocaleDateString('ru-RU')}`
              : 'не запланирован'
          }
        />
        <MetricCard
          value={deferredQ.data?.available ?? '—'}
          label="Отложенный (7%)"
          hint="доступно"
        />
      </div>

      {/* Индикатор + Pie */}
      <div style={styles.twoCol}>
        <Card title="Основной Поток">
          <div style={styles.centered}>
            <FlowIndicator
              balance={mainBalance}
              max={Math.max(mainBalance, 1000)}
              label="Баланс"
            />
            <p style={styles.hint}>
              Относительная шкала: 100% — это {Math.max(mainBalance, 1000)} П
            </p>
          </div>
        </Card>

        <Card title="Распределение по типам">
          {pieData.length === 0 ? (
            <p style={styles.muted}>Нет данных</p>
          ) : (
            <Chart
              type="pie"
              data={pieData}
              config={{ valueKey: 'value', nameKey: 'name' }}
              height={220}
            />
          )}
        </Card>
      </div>

      {/* Таблица балансов */}
      <Card title="Все типы">
        <div style={styles.balanceGrid}>
          {balances.map((b) => (
            <div key={b.type} style={styles.balanceRow}>
              <span style={styles.balanceLabel}>
                {TYPE_LABEL[b.type] ?? b.type}
              </span>
              <span style={styles.balanceValue}>{b.balance} П</span>
            </div>
          ))}
          {balances.length === 0 ? (
            <p style={styles.muted}>Нет балансов</p>
          ) : null}
        </div>
      </Card>

      {/* Капсула */}
      <CapsulePanel capsule={capsule ?? null} />

      {/* Резервы */}
      <div style={styles.threeCol}>
        <ReserveCard
          title="Отложенный Поток (7%)"
          data={deferredQ.data}
          loading={deferredQ.isLoading}
        />
        <ReserveCard
          title="Резерв Свободы (2%)"
          data={freedomQ.data}
          loading={freedomQ.isLoading}
        />
        <ReserveCard
          title="Планетарный Резерв (3%)"
          data={planetaryQ.data}
          loading={planetaryQ.isLoading}
        />
      </div>
    </div>
  );
}

// ─── Капсула ─────────────────────────────────────────────────────

function CapsulePanel({ capsule }: { capsule: Capsule | null }): ReactElement {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const depositM = useMutation({
    mutationFn: (a: number) =>
      apiPost<Capsule>('/flows/capsule/deposit', { amount: a }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['flows', 'capsule'] });
      void qc.invalidateQueries({ queryKey: ['flows'] });
      setAmount('');
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Ошибка пополнения'),
  });

  const withdrawM = useMutation({
    mutationFn: (a: number) =>
      apiPost<Capsule>('/flows/capsule/withdraw', { amount: a }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['flows', 'capsule'] });
      void qc.invalidateQueries({ queryKey: ['flows'] });
      setAmount('');
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Ошибка снятия'),
  });

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const busy = depositM.isPending || withdrawM.isPending;

  const onAction = (action: 'deposit' | 'withdraw'): void => {
    if (!valid) {
      setErr('Сумма должна быть положительным числом');
      return;
    }
    if (action === 'deposit') {
      void depositM.mutateAsync(parsed);
    } else {
      void withdrawM.mutateAsync(parsed);
    }
  };

  return (
    <Card title="Капсула" subtitle={`Максимум ${CAPSULE_MAX} П`}>
      <div style={styles.capsuleBlock}>
        <ProgressBar
          value={capsule?.balance ?? 0}
          max={CAPSULE_MAX}
          label="Заполнено"
        />

        <div style={styles.capsuleActions}>
          <input
            style={styles.input}
            placeholder="Сумма"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <Button
            variant="secondary"
            onClick={() => onAction('withdraw')}
            disabled={busy || !capsule || capsule.balance <= 0}
          >
            Снять
          </Button>
          <Button
            variant="primary"
            onClick={() => onAction('deposit')}
            disabled={busy || (capsule?.balance ?? 0) >= CAPSULE_MAX}
          >
            Пополнить
          </Button>
        </div>

        {err ? <div style={styles.error}>{err}</div> : null}
      </div>
    </Card>
  );
}

// ─── Резерв ──────────────────────────────────────────────────────

interface ReserveProps {
  title: string;
  data: DeferredFlow | FreedomReserve | PlanetaryReserve | undefined;
  loading: boolean;
}

function ReserveCard({ title, data, loading }: ReserveProps): ReactElement {
  return (
    <Card title={title}>
      {loading ? (
        <Spinner label="Загрузка…" />
      ) : !data ? (
        <p style={styles.muted}>Нет данных</p>
      ) : (
        <div style={styles.reserveList}>
          <ReserveRow label="Всего" value={data.totalVolume} />
          {'distributed' in data ? (
            <ReserveRow label="Распределено" value={data.distributed} />
          ) : null}
          {'available' in data ? (
            <ReserveRow label="Доступно" value={data.available} />
          ) : null}
          {'accessible' in data ? (
            <ReserveRow
              label="Доступно"
              value={data.accessible ? 'да' : 'нет'}
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ReserveRow({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div style={styles.reserveRow}>
      <span style={styles.reserveLabel}>{label}</span>
      <span style={styles.reserveValue}>{value}</span>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  title: {
    margin: 0,
    fontSize: 22,
    color: colors.text,
  },
  metricRow: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: spacing.md,
  },
  twoCol: {
    display: 'grid' as const,
    gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)',
    gap: spacing.md,
  },
  threeCol: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: spacing.md,
  },
  centered: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    padding: spacing.md,
  },
  hint: {
    marginTop: spacing.sm,
    color: colors.textDim,
    fontSize: fontSize.xs,
    textAlign: 'center' as const,
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  balanceGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: spacing.sm,
  },
  balanceRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    padding: '6px 10px',
    background: colors.bgInput,
    borderRadius: radius.sm,
  },
  balanceLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  balanceValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: 600,
  },
  capsuleBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  capsuleActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    width: 100,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
  },
  reserveList: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 6,
  },
  reserveRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
  },
  reserveLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  reserveValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: 600,
  },
};