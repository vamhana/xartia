// F.4.10.05 — Настройки видимости (по scope) + журнал доступа.
//
// PATCH /passport/visibility — через useMutation + apiPatch(path, body).
// ВНИМАНИЕ: useApiMutation (src/web/hooks/useApi.ts:36) для PATCH не
// передаёт body — использовать нельзя. Паттерн — как в WebhooksPage.tsx:87.
//
// Контракт PATCH: { scope, visibility, consent } (consent обязателен).
// Ответ: PassportVisibilityState + audit_id (без обёртки data).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';

import { apiPatch } from '../../api/client';
import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportAccessLogItem,
  PassportVisibilityLevel,
  PassportVisibilityScope,
  PassportVisibilityState,
} from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const SCOPES: PassportVisibilityScope[] = ['public', 'mentor', 'assessor', 'task'];
const LEVELS: PassportVisibilityLevel[] = ['private', 'summary', 'levels', 'full'];

export function VisibilityPanel({
  states,
  accessLog,
}: {
  states: PassportVisibilityState[];
  accessLog: PassportAccessLogItem[];
}): ReactElement {
  const qc = useQueryClient();
  const [local, setLocal] = useState<
    Record<PassportVisibilityScope, PassportVisibilityState>
  >(() => initialMap(states));

  useEffect(() => {
    setLocal(initialMap(states));
  }, [states]);

  const patch = useMutation<
    PassportVisibilityState,
    Error,
    { scope: PassportVisibilityScope; visibility: PassportVisibilityLevel; consent: boolean }
  >({
    mutationFn: (v) => apiPatch<PassportVisibilityState>('/passport/visibility', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'visibility'] });
      void qc.invalidateQueries({ queryKey: ['passport', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['passport', 'history'] });
    },
  });

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card title="Видимость" subtitle="по умолчанию — private">
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Scope</th>
              <th style={styles.th}>Уровень</th>
              <th style={styles.th}>Согласие</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {SCOPES.map((s) => {
              const cur = local[s]!;
              return (
                <tr key={s}>
                  <td style={styles.td}>
                    <code style={styles.code}>{s}</code>
                  </td>
                  <td style={styles.td}>
                    <select
                      value={cur.visibility}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          [s]: { ...cur, visibility: e.target.value as PassportVisibilityLevel },
                        })
                      }
                      style={styles.select}
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={cur.consent}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          [s]: { ...cur, consent: e.target.checked },
                        })
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={patch.isPending && patch.variables?.scope === s}
                      onClick={() =>
                        patch.mutate({
                          scope: s,
                          visibility: cur.visibility,
                          consent: cur.consent,
                        })
                      }
                    >
                      Сохранить
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {patch.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 8 }}>
            Ошибка сохранения: {patch.error.message}
          </div>
        )}
      </Card>

      <Card title="Журнал доступа" subtitle={`${accessLog.length} записей`}>
        {accessLog.length === 0 ? (
          <div style={styles.muted}>Пока никто не запрашивал доступ</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Когда</th>
                <th style={styles.th}>Кто</th>
                <th style={styles.th}>Scope</th>
                <th style={styles.th}>Причина</th>
              </tr>
            </thead>
            <tbody>
              {accessLog.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>
                    <code style={styles.code}>{new Date(r.createdAt).toISOString()}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{r.viewerId ?? '—'}</code>
                  </td>
                  <td style={styles.td}>{r.scope}</td>
                  <td style={styles.td}>{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function initialMap(
  states: PassportVisibilityState[],
): Record<PassportVisibilityScope, PassportVisibilityState> {
  const m = {} as Record<PassportVisibilityScope, PassportVisibilityState>;
  for (const s of SCOPES) {
    const found = states.find((x) => x.scope === s);
    m[s] = found ?? {
      scope: s,
      visibility: 'private',
      consent: false,
      updatedAt: new Date(0).toISOString(),
    };
  }
  return m;
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
  select: {
    fontSize: fontSize.sm,
    padding: '2px 4px',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
  } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
};