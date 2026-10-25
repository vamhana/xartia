// F.4.02.33 — Вкладка «Советы».
//
// Совет направления — не должность, а функция: самый опытный участник по
// принятым работам, с обязательной ротацией и возможностью дисквалификации.
// Здесь видно все советы, историю выборов, открытые сигналы направления и
// можно переизбрать или дисквалифицировать.

import { useMemo, useState, type ReactElement } from 'react';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';

interface CouncilState {
  directionId: string;
  directionNumber: number | null;
  directionName: string | null;
  member: { participantId: string; name: string; externalId: string; score: number } | null;
  termEndsAt: string | null;
  electedAt: string | null;
  fallback: { participantId: string; name: string; externalId: string } | null;
  disqualified: Array<{ participantId: string; name: string; reason: string }>;
}

interface CouncilHistory {
  elections: Array<{
    participantId: string;
    name: string;
    score: number;
    electedAt: string;
    termEndsAt: string | null;
    reason: string | null;
  }>;
  disqualifications: Array<{
    participantId: string;
    name: string;
    reason: string;
    createdAt: string;
  }>;
}

interface SignalRow {
  id: string;
  externalId: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
}

function fmtDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('ru-RU') : '—';
}

export function CouncilsPage(): ReactElement {
  const councilsQ = useApiQuery<{ data: CouncilState[] }>(['councils'], '/council');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  const councils = councilsQ.data?.data ?? [];
  const active = useMemo(
    () => councils.find((c) => c.directionId === selectedId) ?? councils[0] ?? null,
    [councils, selectedId],
  );
  const directionId = active?.directionId ?? '';

  const historyQ = useApiQuery<CouncilHistory>(
    ['council-history', directionId],
    `/council/${directionId}/history`,
    { enabled: !!directionId },
  );
  const signalsQ = useApiQuery<{ data: SignalRow[] }>(
    ['council-signals', directionId],
    `/signals?lead_direction_id=${directionId}&status=new&per_page=20`,
    { enabled: !!directionId },
  );

  const elect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/council/${directionId}/elect`, {});
      await councilsQ.refetch();
      void historyQ.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переизбрать');
    } finally {
      setBusy(false);
    }
  };

  const disqualify = async (participantId: string): Promise<void> => {
    if (!reason.trim()) {setError('Нужна причина дисквалификации'); return;}
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/council/${directionId}/disqualify/${participantId}`, { reason });
      setReason('');
      setReasonFor(null);
      await councilsQ.refetch();
      void historyQ.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось дисквалифицировать');
    } finally {
      setBusy(false);
    }
  };

  if (councilsQ.isLoading) {return <Spinner label="Загружаем советы…" />;}

  return (
    <div style={styles.page}>
      <Card
        title="Советы направлений"
        subtitle="Самый опытный участник по принятым работам; ротация обязательна"
      >
        {councils.length === 0 ? (
          <p style={styles.muted}>Нет активных направлений.</p>
        ) : (
          <div style={styles.list}>
            {councils.map((c) => (
              <button
                key={c.directionId}
                type="button"
                style={{
                  ...styles.item,
                  ...(c.directionId === directionId ? styles.itemActive : {}),
                }}
                onClick={() => setSelectedId(c.directionId)}
              >
                <span style={styles.itemTitle}>
                  №{c.directionNumber} {c.directionName}
                </span>
                {c.member ? (
                  <span style={styles.itemMeta}>
                    {c.member.name} · работ {c.member.score} · до {fmtDate(c.termEndsAt)}
                  </span>
                ) : (
                  <span style={{ ...styles.itemMeta, color: colors.warning }}>
                    Совет не избран — функция у {c.fallback?.name ?? 'Архитектора'}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>

      {active ? (
        <Card
          title={`Совет направления №${active.directionNumber}`}
          subtitle={active.member ? 'Советник избран' : 'Функция у Архитектора'}
        >
          {active.member ? (
            <div style={styles.row}>
              <Badge tone="success">Советник</Badge>
              <span style={styles.name}>
                {active.member.name} ({active.member.externalId})
              </span>
              <span style={styles.muted}>принято работ: {active.member.score}</span>
              <span style={styles.muted}>
                мандат до {fmtDate(active.termEndsAt)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setReasonFor(active.member?.participantId ?? null)}
              >
                Дисквалифицировать
              </Button>
            </div>
          ) : (
            <div style={styles.row}>
              <Badge tone="warning">Совет не избран</Badge>
              <span style={styles.name}>
                функция у Архитектора: {active.fallback?.name ?? '—'}
              </span>
              <span style={styles.muted}>
                нет участников с принятыми работами в направлении
              </span>
            </div>
          )}

          {reasonFor ? (
            <div style={styles.disqBox}>
              <input
                style={styles.input}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Причина дисквалификации"
                disabled={busy}
              />
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => void disqualify(reasonFor)}
              >
                Подтвердить
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReasonFor(null)}>
                Отмена
              </Button>
            </div>
          ) : null}

          <div style={{ marginTop: 10 }}>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void elect()}>
              Переизбрать Совет
            </Button>
            {error && (
              <span style={{ color: colors.danger, marginLeft: 12, fontSize: 13 }}>{error}</span>
            )}
          </div>
        </Card>
      ) : null}

      {active ? (
        <Card title="Сигналы направления" subtitle="Что ждёт решения Совета">
          {signalsQ.isLoading ? (
            <Spinner />
          ) : (signalsQ.data?.data ?? []).length === 0 ? (
            <p style={styles.muted}>Открытых сигналов нет.</p>
          ) : (
            <div style={styles.list}>
              {(signalsQ.data?.data ?? []).map((s) => (
                <div key={s.id} style={styles.signalRow}>
                  <span style={styles.extId}>{s.externalId}</span>
                  <span style={styles.signalDesc}>{s.description.slice(0, 140)}</span>
                  <Badge tone={s.priority === 'critical' ? 'danger' : 'info'}>
                    {s.priority}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {active ? (
        <Card title="История" subtitle="Выборы и дисквалификации">
          {historyQ.isLoading ? (
            <Spinner />
          ) : (
            <>
              <div style={styles.historyTitle}>Выборы</div>
              {(historyQ.data?.elections ?? []).length === 0 ? (
                <p style={styles.muted}>Выборов ещё не было.</p>
              ) : (
                (historyQ.data?.elections ?? []).map((e) => (
                  <div key={`${e.participantId}-${e.electedAt}`} style={styles.historyRow}>
                    <span style={styles.name}>{e.name}</span>
                    <span style={styles.muted}>работ: {e.score}</span>
                    <span style={styles.muted}>{fmtDate(e.electedAt)}</span>
                    <span style={styles.muted}>до {fmtDate(e.termEndsAt)}</span>
                    {e.reason ? <span style={styles.muted}>{e.reason}</span> : null}
                  </div>
                ))
              )}
              <div style={{ ...styles.historyTitle, marginTop: 12 }}>Дисквалификации</div>
              {(historyQ.data?.disqualifications ?? []).length === 0 ? (
                <p style={styles.muted}>Дисквалификаций не было.</p>
              ) : (
                (historyQ.data?.disqualifications ?? []).map((d) => (
                  <div key={`${d.participantId}-${d.createdAt}`} style={styles.historyRow}>
                    <span style={styles.name}>{d.name}</span>
                    <span style={styles.muted}>{d.reason}</span>
                    <span style={styles.muted}>{fmtDate(d.createdAt)}</span>
                  </div>
                ))
              )}
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  item: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: 2,
    padding: '8px 10px',
    background: 'transparent',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: colors.text,
    textAlign: 'left' as const,
    fontFamily: 'inherit',
  },
  itemActive: { background: colors.bgSoft, borderColor: colors.border },
  itemTitle: { fontSize: fontSize.sm, fontWeight: 500 },
  itemMeta: { fontSize: fontSize.xs, color: colors.textMuted },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 12 },
  name: { fontWeight: 500 },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  extId: { color: colors.textDim, fontSize: fontSize.xs, width: 130 },
  signalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  signalDesc: { flex: 1, fontSize: fontSize.sm },
  historyTitle: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: 4 },
  historyRow: {
    display: 'flex',
    gap: 12,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  disqBox: { display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' },
  input: {
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    flex: 1,
  },
};
