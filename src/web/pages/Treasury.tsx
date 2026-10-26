// F.4.02.34 — Казна: пол 1.00 + NAV, выручка Шлюза, мультисиг 3-из-5.

import { useState, type ReactElement } from 'react';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';

interface State {
  t1Usdc: number;
  t2Usdc: number;
  operatingUsdc: number;
  bufferUsdc: number;
  reserveUsdc: number;
  supply: number;
  price: number;
  coverage: number;
  floorUsdc: number;
  updatedAt: string;
}

interface SpendRequest {
  id: string;
  amountUsdc: number;
  purpose: string;
  status: 'pending' | 'executed' | 'rejected';
  approvals: Array<{ participantId: string; role: string }>;
  createdAt: string;
}

interface Operation {
  id: string;
  kind: string;
  amountUsdc: number;
  amountUnits: number;
  price: number;
  note: string | null;
  createdAt: string;
}

function money(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function TreasuryPage(): ReactElement {
  const stateQ = useApiQuery<State>(['treasury', 'state'], '/treasury/state');
  const requestsQ = useApiQuery<{ data: SpendRequest[] }>(
    ['treasury', 'spend-requests'],
    '/treasury/spend-requests',
  );
  const opsQ = useApiQuery<{ data: Operation[] }>(
    ['treasury', 'operations'],
    '/treasury/operations',
  );

  const [amount, setAmount] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = (): void => {
    void stateQ.refetch();
    void requestsQ.refetch();
    void opsQ.refetch();
  };

  const revenue = async (): Promise<void> => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const value = Number(amount);
      await apiPost('/treasury/revenue', { amount_usdc: value, note: 'Выручка Шлюза' });
      setAmount('');
      setMessage('Выручка записана: 60% в резерв, 30% операционный, 10% буфер');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally { setBusy(false); }
  };

  const request = async (): Promise<void> => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPost('/treasury/spend', {
        amount_usdc: Number(spendAmount),
        purpose,
      });
      setSpendAmount(''); setPurpose('');
      setMessage('Запрос траты создан: нужно 3 подписи');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally { setBusy(false); }
  };

  const approve = async (id: string): Promise<void> => {
    setBusy(true); setError(null);
    try {
      await apiPost(`/treasury/spend-requests/${id}/approve`, {});
      setMessage('Подпись добавлена');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally { setBusy(false); }
  };

  const st = stateQ.data;

  return (
    <div style={styles.page}>
      <Card
        title="Казна"
        subtitle="Пол 1.00 в T1; прибыль поднимает курс, траты — только через 3 подписи"
      >
        {stateQ.isLoading ? (
          <Spinner />
        ) : !st ? (
          <p style={styles.muted}>Не удалось загрузить состояние казны.</p>
        ) : (
          <>
            <div style={styles.grid}>
              <Metric label="Резерв T1" value={`$${money(st.t1Usdc)}`} />
              <Metric label="T2 (с дисконтом)" value={`$${money(st.t2Usdc)}`} />
              <Metric label="R = T1 + 0.5·T2" value={`$${money(st.reserveUsdc)}`} />
              <Metric label="Выпущено юнитов" value={money(st.supply)} />
              <Metric label="Курс" value={`$${st.price.toFixed(2)}`} tone={st.price > 1 ? 'success' : undefined} />
              <Metric
                label="Покрытие пола"
                value={st.coverage === Infinity ? '—' : `${(st.coverage * 100).toFixed(1)}%`}
                tone={st.coverage >= 1 ? 'success' : 'danger'}
              />
            </div>
            <p style={styles.muted}>
              Пол: ${money(st.floorUsdc)} · операционный счёт: ${money(st.operatingUsdc)} · буфер:{' '}
              ${money(st.bufferUsdc)}
            </p>
          </>
        )}
      </Card>

      <Card title="Выручка Шлюза" subtitle="60% в резерв, 30% на операции, 10% в буфер">
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="Сумма, USDC"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <Button variant="secondary" loading={busy} onClick={() => void revenue()}>
            Записать выручку
          </Button>
        </div>
      </Card>

      <Card title="Трата из казны" subtitle="3 подписи из 5; пол не трогается">
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="Сумма, USDC"
            value={spendAmount}
            onChange={(e) => setSpendAmount(e.target.value)}
            disabled={busy}
          />
          <input
            style={{ ...styles.input, flex: 2 }}
            placeholder="Назначение (серверы, юристы…)"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            disabled={busy}
          />
          <Button variant="secondary" loading={busy} onClick={() => void request()}>
            Создать запрос
          </Button>
        </div>
        {message && <p style={{ color: colors.success, fontSize: fontSize.sm }}>{message}</p>}
        {error && <p style={{ color: colors.danger, fontSize: fontSize.sm }}>{error}</p>}
      </Card>

      <Card title="Запросы трат" subtitle="Нужно 3 подписи">
        {requestsQ.isLoading ? (
          <Spinner />
        ) : (requestsQ.data?.data ?? []).length === 0 ? (
          <p style={styles.muted}>Запросов нет.</p>
        ) : (
          (requestsQ.data?.data ?? []).map((r) => (
            <div key={r.id} style={styles.reqRow}>
              <span style={styles.reqAmount}>${money(r.amountUsdc)}</span>
              <span style={styles.reqPurpose}>{r.purpose}</span>
              <Badge tone={r.status === 'executed' ? 'success' : r.status === 'rejected' ? 'danger' : 'info'}>
                {r.status}
              </Badge>
              <span style={styles.muted}>подписей: {r.approvals.length}/3</span>
              {r.status === 'pending' && (
                <Button variant="secondary" size="sm" loading={busy} onClick={() => void approve(r.id)}>
                  Подписать
                </Button>
              )}
            </div>
          ))
        )}
      </Card>

      <Card title="Операции" subtitle="Журнал казны">
        {(opsQ.data?.data ?? []).length === 0 ? (
          <p style={styles.muted}>Операций пока нет.</p>
        ) : (
          (opsQ.data?.data ?? []).map((op) => (
            <div key={op.id} style={styles.opRow}>
              <span style={styles.opKind}>{op.kind}</span>
              <span>${money(op.amountUsdc)}</span>
              <span style={styles.muted}>курс ${op.price.toFixed(2)}</span>
              <span style={styles.muted}>{new Date(op.createdAt).toLocaleString('ru-RU')}</span>
              {op.note && <span style={styles.muted}>{op.note}</span>}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

function Metric(props: { label: string; value: string; tone?: 'success' | 'danger' }): ReactElement {
  const color = props.tone === 'success' ? colors.success : props.tone === 'danger' ? colors.danger : colors.text;
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{props.label}</span>
      <span style={{ ...styles.metricValue, color }}>{props.value}</span>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: spacing.sm,
  },
  metric: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '8px 10px',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
  },
  metricLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  metricValue: { fontSize: fontSize.lg, fontWeight: 600 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  input: {
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    flex: 1,
    minWidth: 140,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  reqRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    flexWrap: 'wrap' as const,
  },
  reqAmount: { fontWeight: 600, width: 90 },
  reqPurpose: { flex: 1, fontSize: fontSize.sm },
  opRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
    flexWrap: 'wrap' as const,
  },
  opKind: { width: 70, color: colors.textMuted },
};
