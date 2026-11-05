// F.4.10.11 — MatchingPanel (Фаза 3a, §11.2).
//
// Две секции:
//   * «Моё соответствие» — GET /passport/tasks/:taskId/matching (self).
//   * «Кандидаты» — GET /passport/tasks/:taskId/candidates?limit=20.
// Уровни не раскрываются; matches/gaps/status — достаточно для сортировки.

import type { ReactElement } from 'react';

import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportMatchStatus,
  PassportTaskCandidate,
  PassportTaskMatching,
} from '../../types';

function statusTone(s: PassportMatchStatus): 'success' | 'warning' | 'danger' {
  if (s === 'match') return 'success';
  if (s === 'partial') return 'warning';
  return 'danger';
}

function statusLabel(s: PassportMatchStatus): string {
  if (s === 'match') return 'соответствует';
  if (s === 'partial') return 'частично';
  return 'не соответствует';
}

export function MatchingPanel({ taskId }: { taskId: string }): ReactElement {
  const me = useApiQuery<PassportTaskMatching>(
    ['passport', 'matching', taskId, 'me'],
    `/passport/tasks/${taskId}/matching`,
  );
  const candidates = useApiQuery<{ data: PassportTaskCandidate[] }>(
    ['passport', 'matching', taskId, 'candidates'],
    `/passport/tasks/${taskId}/candidates?limit=20`,
  );

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card title="Моё соответствие" subtitle="§11.2 · matching">
        {me.isLoading && <Spinner label="Проверка…" />}
        {me.isError && !me.data && (
          <div style={styles.muted}>
            Профиль задачи не задан — matching недоступен.
          </div>
        )}
        {me.data && (
          <>
            <div style={styles.headerRow}>
              <Badge tone={statusTone(me.data.status)}>
                {statusLabel(me.data.status)}
              </Badge>
              <span style={styles.muted}>
                покрыто {me.data.checkedCount - me.data.gaps.length} из{' '}
                {me.data.checkedCount} ({Math.round(me.data.coverage * 100)}%)
              </span>
            </div>
            {me.data.gaps.length > 0 && (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Атом</th>
                    <th style={styles.th}>Роль</th>
                    <th style={styles.th}>Не хватает</th>
                    <th style={styles.th}>Критично</th>
                  </tr>
                </thead>
                <tbody>
                  {me.data.gaps.map((g) => (
                    <tr key={(g.atomId ?? 'permit:' + (g.permitId ?? '')) + ':' + g.role}>
                      <td style={styles.td}>
                        {g.reason === 'missing_permit' ? (
                          <span>
                            <Badge tone="danger">permit</Badge>{' '}
                            <code style={styles.code}>{g.permitId ?? '—'}</code>
                          </span>
                        ) : (
                          <code style={styles.code}>{g.atomId ?? '—'}</code>
                        )}
                      </td>
                      <td style={styles.td}>{g.role}</td>
                      <td style={styles.td}>
                        {g.missingDimensions.map((d) => (
                          <Badge key={d} tone="warning">{d}</Badge>
                        ))}
                        {g.reason === 'missing_permit' && (
                          <Badge tone="warning">{g.permitStatus ?? 'absent'}</Badge>
                        )}
                      </td>
                      <td style={styles.td}>
                        {g.critical ? (
                          <Badge tone="danger">да</Badge>
                        ) : (
                          <Badge tone="default">нет</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>

      <Card title="Кандидаты" subtitle="top-20 по покрытию">
        {candidates.isLoading && <Spinner label="Поиск кандидатов…" />}
        {candidates.isError && !candidates.data && (
          <div style={styles.muted}>
            Профиль задачи не задан — кандидаты недоступны.
          </div>
        )}
        {candidates.data && candidates.data.data.length === 0 && (
          <div style={styles.muted}>
            Нет участников, покрывающих профиль без критичных пробелов.
          </div>
        )}
        {candidates.data && candidates.data.data.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Участник</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Покрыто</th>
                <th style={styles.th}>Gaps</th>
              </tr>
            </thead>
            <tbody>
              {candidates.data.data.map((c) => (
                <tr key={c.participantId}>
                  <td style={styles.td}>
                    <code style={styles.code}>{c.participantExternalId}</code>{' '}
                    {c.participantName}
                  </td>
                  <td style={styles.td}>
                    <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{c.matches}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{c.gaps}</code>
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
  headerRow: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  } as const,
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
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
};