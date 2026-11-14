// F.4.10.10 — Наставничество (Фаза 3a, §12).
// 3 секции: «Мои ученики», «Мои наставники», «Стать наставником по атому».

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiPost } from '../../api/client';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportMentorCandidate,
  PassportTeachingMentorItem,
  PassportTeachingStudentItem,
} from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

export function TeachingPanel(): ReactElement {
  const qc = useQueryClient();

  const students = useApiQuery<{ data: PassportTeachingStudentItem[] }>(
    ['passport', 'teaching', 'students'],
    '/passport/teaching/students',
  );
  const mentors = useApiQuery<{ data: PassportTeachingMentorItem[] }>(
    ['passport', 'teaching', 'mentors-for-me'],
    '/passport/teaching/mentors-for-me',
  );

  const [atomQuery, setAtomQuery] = useState('CYB.ATOM.0009');
  const [menteeId, setMenteeId] = useState('');

  const candidates = useApiQuery<{ data: PassportMentorCandidate[] }>(
    ['passport', 'teaching', 'mentors', atomQuery],
    `/passport/teaching/mentors?atomId=${encodeURIComponent(atomQuery)}&limit=50`,
    { enabled: /^CYB\.ATOM\.\d{4}$/.test(atomQuery) },
  );

  const assign = useMutation<
    unknown,
    Error,
    { menteeId: string; atomId: string }
  >({
    mutationFn: (v) =>
      apiPost('/passport/teaching/assign', {
        menteeId: v.menteeId,
        atomId: v.atomId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'teaching'] });
      void qc.invalidateQueries({ queryKey: ['passport', 'teaching', 'students'] });
    },
  });

  const revoke = useMutation<unknown, Error, { relationId: string }>({
    mutationFn: (v) =>
      apiPost(
        '/passport/teaching/' + v.relationId + '/revoke',
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'teaching'] });
    },
  });

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card
        title="Мои ученики"
        subtitle="я mentor · per-atom"
      >
        {students.isLoading && <Spinner />}
        {students.data && students.data.data.length === 0 && (
          <div style={styles.muted}>Нет активных учеников</div>
        )}
        {students.data && students.data.data.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Ученик</th>
                <th style={styles.th}>Атом</th>
                <th style={styles.th}>Измерения</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {students.data.data.map((s) => (
                <tr key={s.relationId}>
                  <td style={styles.td}>
                    <code style={styles.code}>{s.menteeExternalId}</code>{' '}
                    {s.menteeName}
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{s.atomId}</code>
                    <div style={styles.muted}>{s.atomName}</div>
                  </td>
                  <td style={styles.td}>
                    {s.dimensions.map((d) => (
                      <Badge key={d} tone="info">{d}</Badge>
                    ))}
                  </td>
                  <td style={styles.td}>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={revoke.isPending && revoke.variables?.relationId === s.relationId}
                      onClick={() => revoke.mutate({ relationId: s.relationId })}
                    >
                      отозвать
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Мои наставники" subtitle="primary + per-atom">
        {mentors.isLoading && <Spinner />}
        {mentors.data && mentors.data.data.length === 0 && (
          <div style={styles.muted}>Наставников нет</div>
        )}
        {mentors.data && mentors.data.data.length > 0 && (
          <ul style={styles.list}>
            {mentors.data.data.map((m, i) => (
              <li key={`${m.source}:${m.mentorId}:${m.atomId ?? ''}:${i}`}>
                <Badge tone={m.source === 'primary' ? 'master' : 'info'}>
                  {m.source === 'primary' ? 'основной' : 'по атому'}
                </Badge>{' '}
                <code style={styles.code}>{m.mentorExternalId ?? '—'}</code>{' '}
                {m.mentorName ?? '—'}
                {m.atomId && (
                  <span style={styles.muted}>
                    {' '}· {m.atomId} ({m.atomName})
                  </span>
                )}
                {m.dimensions && m.dimensions.length > 0 && (
                  <span style={styles.muted}> · {m.dimensions.join(',')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Стать наставником по атому" subtitle="readiness = P≥7 + X≥5 + E≥5">
        <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm }}>
          <input
            value={atomQuery}
            onChange={(e) => setAtomQuery(e.target.value.trim().toUpperCase())}
            placeholder="CYB.ATOM.0009"
            style={styles.input}
          />
        </div>

        {candidates.isLoading && <Spinner label="Загрузка кандидатов…" />}
        {candidates.data && candidates.data.data.length === 0 && (
          <div style={styles.muted}>
            Нет участников с оценками по этому атому (или readiness unknown).
          </div>
        )}
        {candidates.data && candidates.data.data.length > 0 && (
          <>
            <div style={styles.muted}>
              Кандидаты (я = mentor): только те, у кого readiness='ready',
              могут назначать. Ниже — список всех, у кого есть оценки:
            </div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Кандидат</th>
                  <th style={styles.th}>Readiness</th>
                  <th style={styles.th}>Сигналы</th>
                </tr>
              </thead>
              <tbody>
                {candidates.data.data.map((c) => (
                  <tr key={c.mentorId}>
                    <td style={styles.td}>
                      <code style={styles.code}>{c.mentorExternalId}</code>{' '}
                      {c.mentorName}
                    </td>
                    <td style={styles.td}>
                      <Badge
                        tone={
                          c.readiness.state === 'ready'
                            ? 'success'
                            : c.readiness.state === 'not_ready'
                            ? 'warning'
                            : 'default'
                        }
                      >
                        {c.readiness.state}
                      </Badge>
                      <span style={styles.muted}> {Math.round(c.readiness.score * 100)}%</span>
                    </td>
                    <td style={styles.td}>
                      {c.readiness.signals.map((s) => (
                        <span key={s.dimension} style={styles.muted}>
                          {s.dimension}:{s.level ?? '∅'}/{s.required}
                          {s.ok ? '✓' : '✗'}{' '}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ marginTop: spacing.sm, display: 'flex', gap: spacing.sm }}>
          <input
            value={menteeId}
            onChange={(e) => setMenteeId(e.target.value.trim())}
            placeholder="mentee UUID"
            style={{ ...styles.input, minWidth: 320 }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={assign.isPending}
            disabled={!menteeId || !/^CYB\.ATOM\.\d{4}$/.test(atomQuery)}
            onClick={() =>
              assign.mutate(
                { menteeId, atomId: atomQuery },
                {
                  onSuccess: () => {
                    setMenteeId('');
                  },
                },
              )
            }
          >
            назначить
          </Button>
        </div>
        {assign.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
            {assign.error?.message ?? 'ошибка'}
          </div>
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
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  list: { margin: 0, paddingLeft: 18, fontSize: fontSize.sm },
  input: {
    padding: '4px 8px',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 200,
    fontFamily: 'ui-monospace, monospace',
  } as const,
};