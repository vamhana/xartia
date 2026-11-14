// F.4.10.20 — Список команд (Фаза 3c, §11.4).
// GET /passport/teams — команды, где viewer участник или assessor.

import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';
import type { PassportTeamCapability } from '../types';

const STATUS_TONE: Record<
  PassportTeamCapability['status'],
  'default' | 'info' | 'success' | 'warning'
> = {
  draft: 'default',
  active: 'info',
  assessed: 'success',
  deprecated: 'warning',
};

export function TeamsListPage(): ReactElement {
  const navigate = useNavigate();
  const q = useApiQuery<{ data: PassportTeamCapability[] }>(
    ['passport', 'teams'],
    '/passport/teams',
  );

  if (q.isLoading) {return <Spinner label="Загрузка команд…" />;}
  if (q.isError) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          {q.error?.message ?? 'Не удалось загрузить команды'}
        </div>
      </Card>
    );
  }

  const items = q.data?.data ?? [];

  return (
    <div style={{ maxWidth: 900, display: 'grid', gap: spacing.md }}>
      <h1 style={{ margin: 0 }}>Команды</h1>
      <Card
        title="Мои команды"
        subtitle={`${items.length} · я участник или assessor`}
      >
        {items.length === 0 ? (
          <div style={styles.muted}>
            Пока нет команд, где вы участник или assessor.
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Название</th>
                <th style={styles.th}>Результат</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Участников</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td style={styles.td}>
                    <strong>{t.name}</strong>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.muted}>{t.expectedResult}</span>
                  </td>
                  <td style={styles.td}>
                    <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{t.participants.length}</code>
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => navigate(`/teams/${t.id}`)}
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
  td: { padding: '6px 8px', fontSize: fontSize.sm },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  link: {
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    fontSize: fontSize.sm,
    padding: 0,
    borderRadius: radius.sm,
  } as const,
};