// F.4.10.12 — Допуски (Фаза 3b, §10.3).
//
// Секции:
//   * Мои допуски (GET /passport/participants/:me/permits — все статусы).
//   * Справочник (GET /passport/permits?status=active).
//   * Выдать (POST /passport/participants/:subjectId/permits).
//   * Отозвать (POST /passport/participant-permits/:id/revoke).
//   * Создать permit (POST /passport/permits) — для FA | COUNCIL.
//
// Эмитент проверяется на бэке (403), UI не блокирует попытки.

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { apiPost } from '../../api/client';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, spacing } from '../../theme';
import type {
  PassportParticipantPermit,
  PassportPermit,
  PassportPermitStatus,
} from '../../types';

const STATUS_TONE: Record<
  PassportPermitStatus,
  'success' | 'warning' | 'danger' | 'default'
> = {
  active: 'success',
  expired: 'warning',
  revoked: 'danger',
};

export function PermitsPanel({ meId }: { meId: string }): ReactElement {
  const qc = useQueryClient();

  const mine = useApiQuery<{ data: PassportParticipantPermit[] }>(
    ['passport', 'participant-permits', meId],
    `/passport/participants/${meId}/permits`,
  );
  const catalog = useApiQuery<{ data: PassportPermit[] }>(
    ['passport', 'permits', 'active'],
    '/passport/permits?status=active',
  );

  const [issuePermitId, setIssuePermitId] = useState('');
  const [issueValidUntil, setIssueValidUntil] = useState('');
  const [subjectId, setSubjectId] = useState(meId);

  const [newPermitId, setNewPermitId] = useState('');
  const [newName, setNewName] = useState('');
  const [newIssuedBy, setNewIssuedBy] = useState('');
  const [newScope, setNewScope] = useState('');
  const [newMethod, setNewMethod] = useState('');

  const issue = useMutation<unknown, Error, {
    participantId: string;
    permitId: string;
    validUntil?: string;
  }>({
    mutationFn: (v) =>
      apiPost(
        '/passport/participants/' + v.participantId + '/permits',
        {
          permitId: v.permitId,
          ...(v.validUntil ? { validUntil: v.validUntil } : {}),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'participant-permits'] });
      void qc.invalidateQueries({ queryKey: ['passport', 'history'] });
    },
  });

  const revoke = useMutation<unknown, Error, { id: string; reason: string }>({
    mutationFn: (v) =>
      apiPost(
        '/passport/participant-permits/' + v.id + '/revoke',
        { reason: v.reason },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'participant-permits'] });
      void qc.invalidateQueries({ queryKey: ['passport', 'history'] });
    },
  });

  const createPermit = useMutation<unknown, Error, {
    permitId: string;
    name: string;
    issuedBy: string;
    scope?: string;
    verificationMethod: string;
  }>({
    mutationFn: (v) => apiPost('/passport/permits', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['passport', 'permits'] });
      setNewPermitId('');
      setNewName('');
      setNewIssuedBy('');
      setNewScope('');
      setNewMethod('');
    },
  });

  return (
    <div style={{ display: 'grid', gap: spacing.md }}>
      <Card title="Мои допуски" subtitle="§10.3 · не выводится из уровня атомов">
        {mine.isLoading && <Spinner label="Загрузка…" />}
        {mine.data && mine.data.data.length === 0 && (
          <div style={styles.muted}>Допусков нет</div>
        )}
        {mine.data && mine.data.data.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Permit</th>
                <th style={styles.th}>Статус</th>
                <th style={styles.th}>Действует до</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {mine.data.data.map((p) => {
                const isActive = p.status === 'active' && !p.isExpired;
                return (
                  <tr key={p.id}>
                    <td style={styles.td}>
                      <code style={styles.code}>{p.permitId}</code>
                    </td>
                    <td style={styles.td}>
                      <Badge tone={STATUS_TONE[p.status]}>
                        {p.isExpired ? 'expired' : p.status}
                      </Badge>
                      {p.revokeReason && (
                        <div style={styles.muted}>{p.revokeReason}</div>
                      )}
                    </td>
                    <td style={styles.td}>
                      {p.effectiveValidUntil ? (
                        <code style={styles.code}>
                          {new Date(p.effectiveValidUntil).toISOString().slice(0, 10)}
                        </code>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={styles.td}>
                      {isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={revoke.isPending && revoke.variables?.id === p.id}
                          onClick={() => {
                            const reason = window.prompt('Причина отзыва:');
                            if (reason && reason.trim().length > 0) {
                              revoke.mutate({ id: p.id, reason: reason.trim() });
                            }
                          }}
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
      </Card>

      <Card
        title="Справочник"
        subtitle={catalog.data ? `${catalog.data.data.length} активных` : undefined}
      >
        {catalog.isLoading && <Spinner label="Загрузка…" />}
        {catalog.data && catalog.data.data.length === 0 && (
          <div style={styles.muted}>Пока нет permit'ов</div>
        )}
        {catalog.data && catalog.data.data.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Permit</th>
                <th style={styles.th}>Название</th>
                <th style={styles.th}>Эмитент</th>
                <th style={styles.th}>Scope</th>
              </tr>
            </thead>
            <tbody>
              {catalog.data.data.map((p) => (
                <tr key={p.permitId}>
                  <td style={styles.td}>
                    <code style={styles.code}>{p.permitId}</code>
                  </td>
                  <td style={styles.td}>{p.name}</td>
                  <td style={styles.td}>{p.issuedBy}</td>
                  <td style={styles.td}>{p.scope ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Выдать допуск" subtitle="FA | OTC | COUNCIL (иначе 403)">
        <div style={styles.formRow}>
          <input
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value.trim())}
            placeholder="participant UUID (получатель)"
            style={styles.input}
          />
          <select
            value={issuePermitId}
            onChange={(e) => setIssuePermitId(e.target.value)}
            style={styles.input}
          >
            <option value="">— permit —</option>
            {(catalog.data?.data ?? []).map((p) => (
              <option key={p.permitId} value={p.permitId}>
                {p.permitId} — {p.name}
              </option>
            ))}
          </select>
          <input
            value={issueValidUntil}
            onChange={(e) => setIssueValidUntil(e.target.value)}
            placeholder="2027-06-30T00:00:00Z (опц.)"
            style={styles.input}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={issue.isPending}
            disabled={!subjectId || !issuePermitId}
            onClick={() =>
              issue.mutate(
                {
                  participantId: subjectId,
                  permitId: issuePermitId,
                  ...(issueValidUntil.trim() ? { validUntil: issueValidUntil.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setIssuePermitId('');
                    setIssueValidUntil('');
                  },
                },
              )
            }
          >
            выдать
          </Button>
        </div>
        {issue.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
            {issue.error?.message ?? 'ошибка'}
          </div>
        )}
      </Card>

      <Card title="Создать permit в справочнике" subtitle="FA | COUNCIL_MEMBER (иначе 403)">
        <div style={styles.formGrid}>
          <input
            value={newPermitId}
            onChange={(e) => setNewPermitId(e.target.value.toUpperCase())}
            placeholder="PERMIT.HEIGHT.0001"
            style={styles.input}
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название"
            style={styles.input}
          />
          <input
            value={newIssuedBy}
            onChange={(e) => setNewIssuedBy(e.target.value)}
            placeholder="Эмитент (текст)"
            style={styles.input}
          />
          <input
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            placeholder="Scope (опц.)"
            style={styles.input}
          />
          <input
            value={newMethod}
            onChange={(e) => setNewMethod(e.target.value)}
            placeholder="Verification method"
            style={styles.input}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={createPermit.isPending}
            disabled={!newPermitId || !newName || !newIssuedBy || !newMethod}
            onClick={() =>
              createPermit.mutate({
                permitId: newPermitId,
                name: newName,
                issuedBy: newIssuedBy,
                ...(newScope.trim() ? { scope: newScope.trim() } : {}),
                verificationMethod: newMethod,
              })
            }
          >
            создать
          </Button>
        </div>
        {createPermit.isError && (
          <div style={{ color: colors.danger, fontSize: fontSize.xs, marginTop: 4 }}>
            {createPermit.error?.message ?? 'ошибка'}
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
  formRow: {
    display: 'flex',
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  } as const,
  formGrid: {
    display: 'grid',
    gap: spacing.sm,
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  } as const,
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