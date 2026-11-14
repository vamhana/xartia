// F.4.10.21 — Детали команды (Фаза 3c, §11.4).
// GET /passport/teams/:id + <TeamAssessmentPanel />.
// TeamCapability — не атом индивидуального паспорта (§11.4).

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { TeamAssessmentPanel } from '../components/passport/TeamAssessmentPanel';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, spacing } from '../theme';
import type {
  PassportParticipantBrief,
  PassportTeamCapability,
  UUID,
} from '../types';

const STATUS_TONE: Record<
  PassportTeamCapability['status'],
  'default' | 'info' | 'success' | 'warning'
> = {
  draft: 'default',
  active: 'info',
  assessed: 'success',
  deprecated: 'warning',
};

export function TeamPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <div style={{ color: colors.danger }}>teamId missing</div>;
  }

  const q = useApiQuery<PassportTeamCapability>(
    ['passport', 'team', id],
    `/passport/teams/${id}`,
  );

  if (q.isLoading) {return <Spinner label="Загрузка команды…" />;}
  if (q.isError || !q.data) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          {q.error?.message ?? 'Не удалось загрузить команду'}
        </div>
      </Card>
    );
  }

  const team = q.data;

  return (
    <div style={{ maxWidth: 900, display: 'grid', gap: spacing.md }}>
      <h1 style={{ margin: 0 }}>{team.name}</h1>

      <Card title="О команде" subtitle="§11.4 · способность команды как целого">
        <div style={styles.grid}>
          <Field label="Статус">
            <Badge tone={STATUS_TONE[team.status]}>{team.status}</Badge>
          </Field>
          <Field label="Ожидаемый результат">
            {team.expectedResult}
          </Field>
          <Field label="Участников">
            <code style={styles.code}>{team.participants.length}</code>
          </Field>
          <Field label="Assessor">
            {team.assessorId ? (
              <code style={styles.code}>{team.assessorId}</code>
            ) : (
              <span style={styles.muted}>—</span>
            )}
          </Field>
          <Field label="Создана">
            <code style={styles.code}>
              {new Date(team.createdAt).toISOString().slice(0, 10)}
            </code>
          </Field>
        </div>
      </Card>

      <Card title="Состав" subtitle={`${team.participants.length} участников`}>
        <ParticipantList ids={team.participants} />
      </Card>

      <Card title="Критерии" subtitle={`${Object.keys(team.criteria).length}`}>
        {Object.keys(team.criteria).length === 0 ? (
          <div style={styles.muted}>Критерии не заданы</div>
        ) : (
          <ul style={styles.list}>
            {Object.entries(team.criteria).map(([k, v]) => (
              <li key={k}>
                <strong>{k}</strong>
                {typeof v === 'object' && v !== null && 'description' in v ? (
                  <span style={styles.muted}>
                    {' '}
                    — {String((v as { description?: unknown }).description ?? '')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TeamAssessmentPanel teamId={id} team={team} />
    </div>
  );
}

// Батч-загрузка брифов участников: один запрос на все UUID вместо N+1.
function ParticipantList({ ids }: { ids: UUID[] }): ReactElement {
  const q = useApiQuery<{ data: PassportParticipantBrief[] }>(
    ['passport', 'participants-batch', ids.join(',')],
    `/passport/participants?ids=${encodeURIComponent(ids.join(','))}`,
    { enabled: ids.length > 0 },
  );
  const byId = new Map((q.data?.data ?? []).map((p) => [p.id, p]));
  return (
    <ul style={styles.list}>
      {ids.map((id) => {
        const p = byId.get(id);
        return (
          <li key={id}>
            {p ? (
              <>
                <code style={styles.code}>{p.externalId}</code> {p.name}
              </>
            ) : (
              <code style={styles.code}>{id}</code>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{children}</div>
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: spacing.md,
  } as const,
  field: { minWidth: 0 } as const,
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as const,
  fieldValue: { fontSize: fontSize.sm, color: colors.text } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: fontSize.xs,
  } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  list: { margin: 0, paddingLeft: 18, fontSize: fontSize.sm },
};