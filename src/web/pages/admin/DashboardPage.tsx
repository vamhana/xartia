// F.4.04.02 — Admin dashboard.
// Сводные метрики: каждая плитка кликабельна → переход в раздел с фильтром.
// Доступ: FIRST_ARCHITECT (проверка на бэкенде через requireArchitect, A.1.35.01).

import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card } from '../../components/ui/Card';
import { MetricCard } from '../../components/ui/Chart';
import { Spinner } from '../../components/ui/Spinner';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../../theme';

interface AdminDashboard {
  participantsTotal: number;
  directionsTotal: number;
  activeMandates: number;
  openSignals: number;
  activeRegimes: number;
  recoveryPending: number;
  updatedAt: string;
}

interface TileProps {
  value: number;
  label: string;
  hint?: string;
  to?: string;
}

function Tile({ value, label, hint, to }: TileProps): ReactElement {
  const navigate = useNavigate();

  const onClick = to
    ? (): void => {navigate(to);}
    : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!to}
      style={to ? styles.tile : styles.tileStatic}
    >
      <MetricCard value={value} label={label} {...(hint ? { hint } : {})} />
      {to && <span style={styles.tileHint}>открыть →</span>}
    </button>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function DashboardPage(): ReactElement {
  const q = useApiQuery<AdminDashboard>(['admin', 'dashboard'], '/admin/dashboard');

  if (q.isLoading) {return <Spinner label="Загружаем дашборд…" />;}
  if (q.isError || !q.data) {
    return <Card title="Ошибка"><p style={styles.error}>Не удалось загрузить дашборд.</p></Card>;
  }

  const d = q.data;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Дашборд</h1>
      </header>

      <div style={styles.stack}>
        <div style={styles.metricGrid}>
          <Tile value={d.participantsTotal}  label="Участников"         to="/admin/participants" />
          <Tile value={d.activeMandates}     label="Активных мандатов"  to="/admin/mandates?status=active" />
          <Tile value={d.recoveryPending}    label="Recovery-заявок"    to="/admin/recovery" hint="pending + approved" />
          <Tile value={d.openSignals}        label="Открытых сигналов" />
          <Tile value={d.activeRegimes}      label="Активных режимов" />
          <Tile value={d.directionsTotal}    label="Направлений" />
        </div>
        <p style={styles.muted}>Обновлено: {formatDateTime(d.updatedAt)}</p>
      </div>
    </div>
  );
}

export default DashboardPage;

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, minHeight: '100%' } as const,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text } as const,
  stack: { display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  metricGrid: {
    display: 'grid',
    gap: spacing.md,
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  } as const,
  tile: {
    position: 'relative',
    padding: 0,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'inherit',
    font: 'inherit',
    transition: 'border-color 0.15s',
  } as const,
  tileStatic: {
    position: 'relative',
    padding: 0,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    background: 'transparent',
    textAlign: 'left',
    color: 'inherit',
    font: 'inherit',
    cursor: 'default',
  } as const,
  tileHint: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    fontSize: fontSize.xs,
    color: colors.primary,
    opacity: 0.7,
  } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  error: { color: colors.danger, fontSize: fontSize.sm } as const,
};