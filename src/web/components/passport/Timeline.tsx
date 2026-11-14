// F.4.10.04 — Лента истории: три слоя (past / present / phantom).
//   past    — passport_history_events (append-only).
//   present — текущий срез overview.byCluster (width/depth).
//   phantom — overview.goals[].missingAtoms с пометкой «фантом / не освоено»,
//             borderLeft: 1px dashed (по паспорту 9.3 «пунктиром, не как освоенное»).

import type { ReactElement } from 'react';

import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportClusterAggregate,
  PassportGoal,
  PassportHistoryItem,
} from '../../types';
import { Card } from '../ui/Card';

import { CLUSTER_LABEL } from './clusterLabels';

export function Timeline({
  items,
  clusters,
  goals,
}: {
  items: PassportHistoryItem[];
  clusters?: PassportClusterAggregate[];
  goals?: PassportGoal[];
}): ReactElement {
  const activeGoals = (goals ?? []).filter((g) => g.status === 'active');

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card title="Прошлое — события" subtitle={`${items.length}`}>
        {items.length === 0 ? (
          <div style={styles.muted}>Событий ещё нет</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Когда</th>
                <th style={styles.th}>Событие</th>
                <th style={styles.th}>Атом</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id}>
                  <td style={styles.td}>
                    <code style={styles.code}>{new Date(h.createdAt).toISOString()}</code>
                  </td>
                  <td style={styles.td}>{h.eventType}</td>
                  <td style={styles.td}>
                    <code style={styles.code}>{h.atomId ?? '—'}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {clusters && clusters.length > 0 && (
        <Card title="Настоящее — агрегаты" subtitle="width / depth раздельно">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Кластер</th>
                <th style={styles.thNum}>Ширина</th>
                <th style={styles.thNum}>depth_exec</th>
                <th style={styles.thNum}>depth_und</th>
                <th style={styles.thNum}>depth_full</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => (
                <tr key={c.cluster}>
                  <td style={styles.td}>{CLUSTER_LABEL[c.cluster] ?? c.cluster}</td>
                  <td style={styles.tdNum}>{c.width}</td>
                  <td style={styles.tdNum}>{c.depthExecution}</td>
                  <td style={styles.tdNum}>{c.depthUnderstanding}</td>
                  <td style={styles.tdNum}>{c.depthFull}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {activeGoals.length > 0 && (
        <Card title="Фантом — цели и недостающее" subtitle="не освоено">
          <div style={{ display: 'grid', gap: spacing.sm }}>
            {activeGoals.map((g) => (
              <div
                key={g.id}
                style={{
                  paddingLeft: spacing.sm,
                  borderLeft: '1px dashed ' + colors.border,
                }}
              >
                <div style={{ fontWeight: 600 }}>{g.goal}</div>
                <div style={styles.muted}>
                  {g.targetProfileSlug ?? '—'} · фантом / не освоено
                </div>
                {g.missingAtoms.length > 0 && (
                  <ul style={styles.list}>
                    {g.missingAtoms.map((m) => (
                      <li key={m.atomId}>
                        {m.atomId} {m.atomName} — не хватает:{' '}
                        {m.missingDimensions.join(', ')}
                        {m.alternativeAtomIds.length > 0 && (
                          <span style={styles.muted}>
                            {' '}· альтернативы: {m.alternativeAtomIds.join(', ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
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
  thNum: {
    textAlign: 'right' as const,
    padding: '4px 8px',
    fontSize: fontSize.xs,
    color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '4px 8px', fontSize: fontSize.sm },
  tdNum: {
    padding: '4px 8px',
    fontSize: fontSize.sm,
    textAlign: 'right' as const,
    fontFamily: 'ui-monospace, monospace',
  } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  list: { margin: 0, paddingLeft: 16, fontSize: fontSize.sm } as const,
};