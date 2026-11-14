// F.4.10.07 — Гранты доступа к чужому паспорту (Фаза 2, шаг 9).
//
// Потребитель useApiMutation с bodyBuilder (POST) — закрывает техдолг
// §2.9. DELETE — тоже через useApiMutation (без body).
//
// В Фазе 2 UI минимальный: список + inline-create + revoke.
// Отдельная страница «Кому я дал доступ» — Фаза 3.

import { useState, type ReactElement } from 'react';

import { useApiMutation, useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

interface GrantItem {
  id: string;
  viewerId: string;
  scope: 'mentor' | 'assessor' | 'task';
  taskId: string | null;
  reason: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

type Scope = 'mentor' | 'assessor' | 'task';

export function GrantsPanel(): ReactElement {
  const list = useApiQuery<{ data: GrantItem[] }>(
    ['passport', 'grants'],
    '/passport/grants',
  );

  const [viewerId, setViewerId] = useState('');
  const [scope, setScope] = useState<Scope>('mentor');
  const [reason, setReason] = useState('');

  const create = useApiMutation<
    GrantItem,
    { viewerId: string; scope: Scope; reason?: string }
  >(
    () => '/passport/grants',
    'POST',
    {
      bodyBuilder: (v) => ({
        viewerId: v.viewerId,
        scope: v.scope,
        ...(v.reason ? { reason: v.reason } : {}),
      }),
    },
  );

  const revoke = useApiMutation<void, { grantId: string }>(
    (v) => `/passport/grants/${v.grantId}`,
    'DELETE',
  );

  return (
    <Card title="Гранты доступа" subtitle="§18.2 · явные согласия (по умолчанию — нет доступа)">
      {list.isLoading && <Spinner label="Загрузка грантов…" />}
      {list.isError && (
        <div style={{ color: colors.danger, fontSize: fontSize.sm }}>
          Ошибка загрузки: {list.error?.message ?? 'неизвестно'}
        </div>
      )}

      {list.data && (
        <>
          {list.data.data.length === 0 ? (
            <div style={styles.muted}>Грантов нет</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Кому</th>
                  <th style={styles.th}>Scope</th>
                  <th style={styles.th}>Task</th>
                  <th style={styles.th}>Истекает</th>
                  <th style={styles.th}>Статус</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((g) => {
                  const isActive = !g.revokedAt && (!g.expiresAt || new Date(g.expiresAt) > new Date());
                  return (
                    <tr key={g.id}>
                      <td style={styles.td}>
                        <code style={styles.code}>{g.viewerId}</code>
                      </td>
                      <td style={styles.td}>{g.scope}</td>
                      <td style={styles.td}>
                        {g.taskId ? <code style={styles.code}>{g.taskId}</code> : '—'}
                      </td>
                      <td style={styles.td}>
                        {g.expiresAt ? (
                          <code style={styles.code}>
                            {new Date(g.expiresAt).toISOString().slice(0, 10)}
                          </code>
                        ) : '—'}
                      </td>
                      <td style={styles.td}>
                        {g.revokedAt ? 'отозван' : isActive ? 'активен' : 'истёк'}
                      </td>
                      <td style={styles.td}>
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={revoke.isPending && revoke.variables?.grantId === g.id}
                            onClick={() =>
                              revoke.mutate(
                                { grantId: g.id },
                                { onSuccess: () => { void list.refetch(); } },
                              )
                            }
                          >
                            отозвать
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div style={styles.form}>
            <div style={styles.formTitle}>Выдать грант</div>
            <input
              placeholder="viewer UUID"
              value={viewerId}
              onChange={(e) => setViewerId(e.target.value)}
              style={styles.input}
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              style={styles.input}
            >
              <option value="mentor">mentor</option>
              <option value="assessor">assessor</option>
              <option value="task">task</option>
            </select>
            <input
              placeholder="reason (опц.)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={styles.input}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={create.isPending}
              disabled={!viewerId}
              onClick={() =>
                create.mutate(
                  {
                    viewerId: viewerId.trim(),
                    scope,
                    ...(reason.trim() ? { reason: reason.trim() } : {}),
                  },
                  {
                    onSuccess: () => {
                      void list.refetch();
                      setViewerId('');
                      setReason('');
                    },
                  },
                )
              }
            >
              создать
            </Button>
          </div>

          {create.isError && (
            <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
              {create.error.message}
            </div>
          )}
          {revoke.isError && (
            <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
              {revoke.error.message}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const styles = {
  table: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: spacing.sm },
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
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    paddingTop: spacing.sm,
    borderTop: `1px dashed ${colors.border}`,
  } as const,
  formTitle: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    width: '100%',
  } as const,
  input: {
    padding: '4px 8px',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
  } as const,
};