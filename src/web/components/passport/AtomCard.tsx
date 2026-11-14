// F.4.10.03 — Карточка атома (масштаб 3).
// 5 шкал 0..9, доказательства, история, связи.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { apiPost } from '../../api/client';
import { colors, fontSize, spacing } from '../../theme';
import type { PassportAtomCard } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

import { DimensionScale } from './DimensionScale';

export function AtomCardView({
  card,
}: {
  card: PassportAtomCard;
}): ReactElement {
  const a = card.atom;
  const qc = useQueryClient();

  const reuse = useMutation<
    { candidateEvidenceId: string; requiresAssessment: boolean },
    Error,
    { evidenceId: string }
  >({
    mutationFn: ({ evidenceId }) =>
      apiPost('/passport/evidence/' + evidenceId + '/reuse', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'atom', a.atom_id] });
      void qc.invalidateQueries({ queryKey: ['passport', 'history'] });
    },
  });

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card
        title={a.name}
        subtitle={`${a.atom_id} · v${a.version} · ${a.status}`}
      >
        <p style={{ marginTop: 0, fontSize: fontSize.sm }}>{a.definition}</p>
        <div style={styles.twoCols}>
          <div>
            <div style={styles.sectionTitle}>Входит</div>
            <ul style={styles.list}>
              {a.boundary_includes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <div style={styles.sectionTitle}>Не входит</div>
            <ul style={styles.list}>
              {a.boundary_excludes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card title="Пять измерений" subtitle="0..9 · null = нет оценки · среднее запрещено">
        {card.dimensions.map((d) => (
          <DimensionScale key={d.dimension} state={d} />
        ))}
      </Card>

      <Card title="Доказательства" subtitle={`${card.evidence.length}`}>
        {card.evidence.length === 0 ? (
          <div style={styles.muted}>Нет доказательств</div>
        ) : (
          <ul style={styles.list}>
            {card.evidence.map((e) => {
              const reuseForbidden = ['disputed', 'invalidated', 'rejected', 'withdrawn'].includes(e.status);
              return (
                <li key={e.id} style={{ marginBottom: 6 }}>
                  <Badge tone="info">{e.dimension}</Badge>{' '}
                  <span style={styles.muted}>{e.evidenceType}</span> — {e.description}{' '}
                  <Badge tone={e.status === 'accepted' ? 'success' : 'default'}>
                    {e.status}
                  </Badge>
                  {e.reusedFromEvidenceId && (
                    <span style={styles.muted}> (reuse)</span>
                  )}
                  {!reuseForbidden && (
                    <>
                      {' '}
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={reuse.isPending && reuse.variables?.evidenceId === e.id}
                        onClick={() => reuse.mutate({ evidenceId: e.id })}
                      >
                        переиспользовать
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {reuse.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
            {reuse.error.message}
          </div>
        )}
      </Card>

      <Card title="Оценки" subtitle={`${card.assessments.length} (включая историю)`}>
        {card.assessments.length === 0 ? (
          <div style={styles.muted}>Нет оценок</div>
        ) : (
          <ul style={styles.list}>
            {card.assessments.map((x) => (
              <li
                key={x.id}
                style={x.isCurrent ? undefined : styles.historical}
                title={x.isCurrent ? undefined : 'историческая запись'}
              >
                <Badge tone="info">{x.dimension}</Badge>{' '}
                level={x.level === null ? 'null' : x.level} · {x.method} ·{' '}
                <Badge tone={x.status === 'active' ? 'success' : 'warning'}>
                  {x.status}
                </Badge>
                {!x.isCurrent && <span style={styles.historicalTag}> (история)</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="История" subtitle={`${card.history.length} (последние 50)`}>
        {card.history.length === 0 ? (
          <div style={styles.muted}>Нет событий</div>
        ) : (
          <ul style={styles.list}>
            {card.history.map((h) => (
              <li key={h.id}>
                <code style={styles.code}>{h.eventType}</code>{' '}
                <span style={styles.muted}>{new Date(h.createdAt).toISOString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Направления" subtitle="17 направлений Хартии (§14)">
        {!card.directions && (
          <div style={styles.muted}>Маппинг не найден</div>
        )}
        {card.directions && (
          <div style={{ display: 'grid', gap: 6 }}>
            {card.directions.home && (
              <div>
                <Badge tone="master">домашняя</Badge>{' '}
                {card.directions.home.directionNumber}.{' '}
                {card.directions.home.directionName}
              </div>
            )}
            {card.directions.main &&
              card.directions.main.directionId !== card.directions.home?.directionId && (
                <div>
                  <Badge tone="info">владелец</Badge>{' '}
                  {card.directions.main.directionNumber}.{' '}
                  {card.directions.main.directionName}
                </div>
              )}
            {card.directions.related.length > 0 && (
              <div>
                <div style={styles.muted}>Смежные:</div>
                <div style={styles.chipRow}>
                  {card.directions.related.map((d) => (
                    <Badge key={`${d.directionId}-${d.role}`} tone="default">
                      {`${d.directionNumber}. ${d.directionName}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Связи" subtitle={`${card.relations.length}`}>
        {card.relations.length === 0 ? (
          <div style={styles.muted}>Связей нет</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>От</th>
                <th style={styles.th}>К</th>
                <th style={styles.th}>Тип</th>
              </tr>
            </thead>
            <tbody>
              {card.relations.map((r, i) => (
                <tr key={i}>
                  <td style={styles.td}><code style={styles.code}>{r.fromAtomId}</code></td>
                  <td style={styles.td}><code style={styles.code}>{r.toAtomId}</code></td>
                  <td style={styles.td}>{r.relationType}</td>
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
  twoCols: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: spacing.md,
  } as const,
  sectionTitle: {
    fontSize: fontSize.xs, color: colors.textDim, textTransform: 'uppercase' as const,
    marginBottom: 4,
  } as const,
  list: { margin: 0, paddingLeft: 18, fontSize: fontSize.sm },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bg,
    padding: '1px 4px',
    borderRadius: 3,
  } as const,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const, padding: '4px 8px',
    fontSize: fontSize.xs, color: colors.textDim,
    borderBottom: `1px solid ${colors.border}`,
  } as const,
  td: { padding: '4px 8px', fontSize: fontSize.sm },
  chipRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
    marginTop: 4,
  } as const,
  historical: { opacity: 0.55 } as const,
  historicalTag: { color: colors.textMuted, fontSize: fontSize.xs } as const,
};