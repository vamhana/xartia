// F.4.10.22 — История оценок команды + форма «Оценить» (Фаза 3c).
// GET /passport/teams/:id/history, POST /passport/teams/:id/assess.
// Роли: FA | VERIFIER; assessor ∉ participants (валидируется на бэке + триггер).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiPost } from '../../api/client';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportParticipantBrief,
  PassportTeamCapability,
  PassportTeamCapabilityAssessment,
} from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

interface Props {
  teamId: string;
  team: PassportTeamCapability;
}

export function TeamAssessmentPanel({ teamId, team }: Props): ReactElement {
  const qc = useQueryClient();
  const history = useApiQuery<{ data: PassportTeamCapabilityAssessment[] }>(
    ['passport', 'team-history', teamId],
    `/passport/teams/${teamId}/history`,
  );

  // Батч-загрузка брифов асессоров из истории (один запрос).
  const assessorIds = Array.from(
    new Set((history.data?.data ?? []).map((a) => a.assessorId)),
  );
  const assessorsQ = useApiQuery<{ data: PassportParticipantBrief[] }>(
    ['passport', 'participants-batch', assessorIds.join(',')],
    `/passport/participants?ids=${encodeURIComponent(assessorIds.join(','))}`,
    { enabled: assessorIds.length > 0 },
  );
  const assessorById = new Map(
    (assessorsQ.data?.data ?? []).map((p) => [p.id, p]),
  );

  const [level, setLevel] = useState(5);
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const k of Object.keys(team.criteria)) {m[k] = 5;}
    return m;
  });

  const assess = useMutation<
    PassportTeamCapabilityAssessment,
    Error,
    { level: number; criteriaScores: Record<string, number> }
  >({
    mutationFn: (v) =>
      apiPost(`/passport/teams/${teamId}/assess`, {
        level: v.level,
        criteriaScores: v.criteriaScores,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'team-history', teamId] });
      void qc.invalidateQueries({ queryKey: ['passport', 'team', teamId] });
      void qc.invalidateQueries({ queryKey: ['passport', 'teams'] });
    },
  });

  const hasCriteria = Object.keys(team.criteria).length > 0;

  return (
    <Card
      title="История оценок"
      subtitle={
        history.data ? `${history.data.data.length} записей` : undefined
      }
    >
      {history.isLoading && <Spinner label="Загрузка истории…" />}
      {history.data && history.data.data.length === 0 && (
        <div style={styles.muted}>Оценок пока нет</div>
      )}
      {history.data && history.data.data.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Когда</th>
              <th style={styles.th}>Уровень</th>
              <th style={styles.th}>Критерии</th>
              <th style={styles.th}>Assessor</th>
            </tr>
          </thead>
          <tbody>
            {history.data.data.map((a) => {
              const ap = assessorById.get(a.assessorId);
              return (
                <tr key={a.id}>
                  <td style={styles.td}>
                    <code style={styles.code}>
                      {new Date(a.assessedAt).toISOString()}
                    </code>
                  </td>
                  <td style={styles.td}>
                    <Badge tone="info">{String(a.level)}</Badge>
                  </td>
                  <td style={styles.td}>
                    {Object.entries(a.criteriaScores).map(([k, v]) => (
                      <Badge key={k} tone="default">
                        {`${k}:${v}`}
                      </Badge>
                    ))}
                  </td>
                  <td style={styles.td}>
                    {ap ? (
                      <>
                        <code style={styles.code}>{ap.externalId}</code>{' '}
                        {ap.name}
                      </>
                    ) : (
                      <code style={styles.code}>{a.assessorId}</code>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={styles.form}>
        <div style={styles.formTitle}>Оценить команду</div>
        <div style={styles.formRow}>
          <label style={styles.formLabel}>Уровень 0..9</label>
          <input
            type="number"
            min={0}
            max={9}
            value={level}
            onChange={(e) =>
              setLevel(Math.max(0, Math.min(9, Number(e.target.value) || 0)))
            }
            style={styles.input}
          />
        </div>

        {hasCriteria && (
          <div style={styles.criteriaBlock}>
            {Object.keys(team.criteria).map((k) => (
              <div key={k} style={styles.formRow}>
                <label style={styles.formLabel}>{k}</label>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={scores[k] ?? 5}
                  onChange={(e) =>
                    setScores({
                      ...scores,
                      [k]: Math.max(0, Math.min(9, Number(e.target.value) || 0)),
                    })
                  }
                  style={styles.input}
                />
              </div>
            ))}
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          loading={assess.isPending}
          onClick={() => assess.mutate({ level, criteriaScores: scores })}
        >
          Оценить
        </Button>

        {assess.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
            {assess.error.message}
          </div>
        )}
      </div>
    </Card>
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
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  form: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTop: `1px dashed ${colors.border}`,
    display: 'grid',
    gap: spacing.sm,
  } as const,
  formTitle: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as const,
  formRow: { display: 'flex', gap: spacing.sm, alignItems: 'center' } as const,
  formLabel: { fontSize: fontSize.sm, minWidth: 100 } as const,
  input: {
    width: 80,
    padding: '4px 8px',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'ui-monospace, monospace',
  } as const,
  criteriaBlock: {
    display: 'grid',
    gap: spacing.xs ?? 4,
    paddingLeft: spacing.sm,
  } as const,
};