// F.4.10.08 — TaskProfilePanel (Фаза 3a, §11.1).
//
// Показывает существующий профиль. Если нет — форма создания.
// PATCH — через useMutation + apiPatch (паттерн Фазы 2).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiPatch, apiPost } from '../../api/client';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';
import type { PassportTaskProfile } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

interface Props {
  taskId: string;
}

const ROLE_LABEL: Record<string, string> = {
  executor: 'исполнитель',
  designer: 'проектировщик',
  consultant: 'консультант',
  assessor: 'проверяющий',
};

export function TaskProfilePanel({ taskId }: Props): ReactElement {
  const qc = useQueryClient();
  const q = useApiQuery<PassportTaskProfile>(
    ['passport', 'task-profile', taskId],
    `/passport/tasks/${taskId}/profile`,
  );

  const create = useMutation<
    PassportTaskProfile,
    Error,
    { requiredAtoms: string }
  >({
    mutationFn: (v) =>
      apiPost('/passport/tasks/' + taskId + '/profile', {
        requiredAtoms: JSON.parse(v.requiredAtoms),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'task-profile', taskId] });
    },
  });

  const patch = useMutation<
    PassportTaskProfile,
    Error,
    { requiredAtoms: string }
  >({
    mutationFn: (v) =>
      apiPatch('/passport/tasks/' + taskId + '/profile', {
        requiredAtoms: JSON.parse(v.requiredAtoms),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'task-profile', taskId] });
    },
  });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState('');

  const openCreate = (): void => {
    setEditorText(
      JSON.stringify(
        [
          {
            atom_id: 'CYB.ATOM.0009',
            role: 'executor',
            min: { P: 4, U: 3 },
          },
        ],
        null,
        2,
      ),
    );
    setEditorOpen(true);
  };

  const openEdit = (): void => {
    if (!q.data) {return;}
    setEditorText(JSON.stringify(q.data.requiredAtoms, null, 2));
    setEditorOpen(true);
  };

  return (
    <Card
      title="Профиль требований"
      subtitle="§11.1 · TaskProfile через атомы"
      actions={
        q.data ? (
          <Button variant="secondary" size="sm" onClick={openEdit}>
            изменить
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={openCreate}>
            создать профиль
          </Button>
        )
      }
    >
      {q.isLoading && <Spinner label="Загрузка профиля…" />}
      {!q.isLoading && q.isError && !q.data && (
        <div style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
          Профиль не задан. Создайте его, если вы Архитектор, член Совета или ОТК.
        </div>
      )}

      {q.data && (
        <div style={{ display: 'grid', gap: spacing.sm }}>
          <div style={styles.header}>
            <Badge tone={q.data.status === 'active' ? 'success' : 'default'}>
              {q.data.status}
            </Badge>
            <span style={styles.muted}>v{q.data.version}</span>
            <span style={styles.muted}>
              создан: {new Date(q.data.createdAt).toISOString().slice(0, 10)}
            </span>
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Атом</th>
                <th style={styles.th}>Роль</th>
                <th style={styles.th}>Минимумы</th>
              </tr>
            </thead>
            <tbody>
              {q.data.requiredAtoms.map((r) => (
                <tr key={r.atom_id + ':' + r.role}>
                  <td style={styles.td}>
                    <code style={styles.code}>{r.atom_id}</code>
                  </td>
                  <td style={styles.td}>{ROLE_LABEL[r.role] ?? r.role}</td>
                  <td style={styles.td}>
                    {Object.entries(r.min).map(([d, v]) => (
                      <Badge key={d} tone="info">
                        {`${d}:${v}`}
                      </Badge>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {q.data.permitIds.length > 0 && (
            <div>
              <div style={styles.section}>Permit IDs</div>
              <div style={styles.muted}>
                {q.data.permitIds.join(', ')} (проверка Permit — Фаза 3b)
              </div>
            </div>
          )}
        </div>
      )}

      {editorOpen && (
        <div style={{ marginTop: spacing.sm, display: 'grid', gap: spacing.sm }}>
          <div style={styles.section}>
            {q.data ? 'Изменить requiredAtoms (JSON)' : 'requiredAtoms (JSON)'}
          </div>
          <textarea
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            rows={12}
            style={styles.textarea}
          />
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Button
              variant="secondary"
              size="sm"
              loading={q.data ? patch.isPending : create.isPending}
              onClick={() => {
                if (q.data) {patch.mutate({ requiredAtoms: editorText });}
                else {create.mutate({ requiredAtoms: editorText });}
              }}
            >
              сохранить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditorOpen(false)}
            >
              отмена
            </Button>
          </div>
          {(create.isError || patch.isError) && (
            <div style={{ color: colors.danger, fontSize: fontSize.xs }}>
              {(create.isError ? create.error?.message : patch.error?.message) ??
                'ошибка'}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const styles = {
  header: { display: 'flex', gap: spacing.sm, alignItems: 'center' } as const,
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
  section: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as const,
  textarea: {
    width: '100%',
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    padding: 6,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
    boxSizing: 'border-box' as const,
  } as const,
};