// F.4.10.24 — Список сессий калибровки (Фаза 3d, §6.5).

import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, spacing } from '../theme';
import type { PassportCalibrationSession } from '../types';

const STATUS_TONE: Record<
  PassportCalibrationSession['status'],
  'default' | 'info' | 'success'
> = {
  draft: 'default',
  open: 'info',
  closed: 'success',
};

export function CalibrationListPage(): ReactElement {
  const navigate = useNavigate();
  const q = useApiQuery<{ data: PassportCalibrationSession[] }>(
    ['passport', 'calibration', 'sessions'],
    '/passport/calibration/sessions',
  );

  if (q.isLoading) return <Spinner label="Загрузка сессий…" />;
  if (q.isError) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          {q.error?.message ?? 'Не удалось загрузить сессии'}
        </div>
      </Card>
    );
  }

  const items = q.data?.data ?? [];

  return (
    <div style={{ maxWidth: 900, display: 'grid', gap: spacing.md }}>
      <h1 style={{ margin: 0 }}>Калибровка</h1>
      <Card title="Сессии" subtitle={`${items.length}`}>
        {items.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
            Сессий пока нет. Создаёт FA или COUNCIL через POST /passport/calibration/sessions.
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Атом</th>
                <th style={styles.th}>Изм.</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Deadline</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td style={styles.td}>
                    <code style={styles.code}>{s.atomId}</code>
                  </td>
                  <td style={styles.td}>{s.dimension}</td>
                  <td style={styles.td}>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </td>
                  <td style={styles.td}>
                    {s.deadline
                      ? new Date(s.deadline).toISOString().slice(0, 10)
                      : '—'}
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => navigate(`/calibration/${s.id}`)}
                      style={styles.link}
                    >
                      открыть →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const styles = {
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
  link: {
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    fontSize: fontSize.sm,
    padding: 0,
  } as const,
};