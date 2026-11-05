// F.4.10.25 — Отчёт сессии калибровки (Фаза 3d, §6.5).
// GET /passport/calibration/sessions/:id/report — расхождения, needsThird.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, spacing } from '../theme';
import type { PassportCalibrationReport } from '../types';

export function CalibrationPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) return <div style={{ color: colors.danger }}>sessionId missing</div>;

  const q = useApiQuery<PassportCalibrationReport>(
    ['passport', 'calibration', 'report', id],
    `/passport/calibration/sessions/${id}/report`,
  );

  if (q.isLoading) return <Spinner label="Загрузка отчёта…" />;
  if (q.isError || !q.data) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          {q.error?.message ?? 'Не удалось загрузить отчёт'}
        </div>
      </Card>
    );
  }

  const r = q.data;

  return (
    <div style={{ maxWidth: 1000, display: 'grid', gap: spacing.md }}>
      <h1 style={{ margin: 0 }}>
        Калибровка · {r.session.atomId} / {r.session.dimension}
      </h1>

      <Card title="Summary" subtitle={r.session.status}>
        <div style={styles.kpiRow}>
          <Kpi label="Работ" value={r.summary.worksCount} />
          <Kpi label="Оценено" value={r.summary.scoredCount} />
          <Kpi label="Без оценки" value={r.summary.unscoredCount} />
          <Kpi label="Требует 3-го" value={r.summary.flaggedCount} warn />
          <Kpi label="Просрочена" value={r.summary.overdue ? 1 : 0} warn />
        </div>
      </Card>

      {r.works.map((w) => (
        <Card
          key={w.anchorExampleId}
          title={w.title}
          subtitle={`эталон ${w.expectedLevel} · ${w.scores.length} оценок`}
        >
          <div style={{ marginBottom: spacing.sm }}>
            {w.needsThird ? (
              <Badge tone="danger">
                {`расхождение ${w.maxDiff} — нужен третий оценщик`}
              </Badge>
            ) : w.maxDiff !== null ? (
              <Badge tone="success">{`расхождение ${w.maxDiff}`}</Badge>
            ) : (
              <Badge tone="default">недостаточно оценок</Badge>
            )}
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Assessor</th>
                <th style={styles.th}>Уровень</th>
                <th style={styles.th}>Заметка</th>
                <th style={styles.th}>Оценено</th>
              </tr>
            </thead>
            <tbody>
              {w.scores.map((s) => (
                <tr key={s.assignmentId}>
                  <td style={styles.td}>
                    <code style={styles.code}>{s.assessorId}</code>
                  </td>
                  <td style={styles.td}>
                    {s.level === null ? (
                      <Badge tone="warning">нет оценки</Badge>
                    ) : (
                      <Badge tone="info">{String(s.level)}</Badge>
                    )}
                  </td>
                  <td style={styles.td}>{s.note ?? '—'}</td>
                  <td style={styles.td}>
                    {s.scoredAt
                      ? new Date(s.scoredAt).toISOString().slice(0, 19)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function Kpi({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}): ReactElement {
  return (
    <div
      style={{
        padding: spacing.sm,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        background: warn && value > 0 ? 'rgba(239,68,68,0.08)' : undefined,
      }}
    >
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
    </div>
  );
}

const styles = {
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: spacing.sm,
  } as const,
  kpiLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as const,
  kpiValue: { fontSize: 20, fontWeight: 600 as const, color: colors.text },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    fontSize: fontSize.xs,
    color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '4px 8px', fontSize: fontSize.sm },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs } as const,
};