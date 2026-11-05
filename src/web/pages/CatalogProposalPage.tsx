// F.4.10.26 — Предложение каталога (Каталог v0.4, §16.1).
//
// Просмотр + действия по статусу:
//   draft     — автор: submit
//   submitted — FA/COUNCIL: in_review | reject
//   in_review — FA/COUNCIL: approve | reject
//   approved  — FA/COUNCIL: merge  | reject
//   merged / rejected — финал (view only)
//
// Роли проверяются и на бэке (403), UI просто скрывает кнопки.
//
// Попасть на страницу: /catalog/proposals/:id (прямая ссылка).
// Список предложений — TODO 3f.

import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { apiPatch, apiPost } from '../api/client';
import { useApiQuery } from '../hooks/useApi';
import { useUser } from '../store';
import { colors, fontSize, spacing } from '../theme';
import type {
  PassportCatalogProposal,
  PassportCatalogProposalStatus,
  PassportCatalogProposalType,
} from '../types';

const STATUS_TONE: Record<
  PassportCatalogProposalStatus,
  'default' | 'info' | 'success' | 'danger' | 'warning'
> = {
  draft: 'default',
  submitted: 'info',
  in_review: 'warning',
  approved: 'info',
  rejected: 'danger',
  merged: 'success',
};

const TYPE_LABEL: Record<PassportCatalogProposalType, string> = {
  new_atom: 'Новый атом',
  update_atom: 'Обновление атома',
  deprecate_atom: 'Устаревание атома',
};

const REVIEWER_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER'] as const;

type ActionStatus = 'submitted' | 'in_review' | 'approved' | 'rejected';

interface StatusVars {
  status: ActionStatus;
  reason?: string;
  reviewNote?: string;
}

export function CatalogProposalPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <div style={{ color: colors.danger }}>proposalId missing</div>;
  }

  const qc = useQueryClient();
  const user = useUser();
  const roles = new Set(user?.roles ?? []);
  const isReviewer = REVIEWER_ROLES.some((r) => roles.has(r));

  const q = useApiQuery<PassportCatalogProposal>(
    ['passport', 'catalog', 'proposal', id],
    `/passport/catalog/proposals/${id}`,
  );

  const [reason, setReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const updateStatus = useMutation<PassportCatalogProposal, Error, StatusVars>({
    mutationFn: (v) =>
      apiPatch(`/passport/catalog/proposals/${id}`, {
        status: v.status,
        ...(v.reason ? { reason: v.reason } : {}),
        ...(v.reviewNote ? { reviewNote: v.reviewNote } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['passport', 'catalog', 'proposal', id],
      });
      setReason('');
      setReviewNote('');
    },
  });

  const merge = useMutation<PassportCatalogProposal, Error, void>({
    mutationFn: () => apiPost(`/passport/catalog/proposals/${id}/merge`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['passport', 'catalog', 'proposal', id],
      });
    },
  });

  if (q.isLoading) return <Spinner label="Загрузка предложения…" />;
  if (q.isError || !q.data) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          {q.error?.message ?? 'Не удалось загрузить предложение'}
        </div>
      </Card>
    );
  }

  const p = q.data;
  const isAuthor = user?.participant.id === p.createdBy;

  const doReject = (): void => {
    if (!reason.trim()) {
      setLocalError('Причина отклонения обязательна');
      return;
    }
    setLocalError(null);
    updateStatus.mutate({ status: 'rejected', reason: reason.trim() });
  };

  const mutError =
    updateStatus.isError ? updateStatus.error.message :
    merge.isError ? merge.error.message :
    null;

  return (
    <div style={{ maxWidth: 900, display: 'grid', gap: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <h1 style={{ margin: 0 }}>Предложение каталога</h1>
        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
      </div>

      <Card
        title={TYPE_LABEL[p.proposalType] ?? p.proposalType}
        subtitle={`ID: ${p.id}`}
      >
        <div style={styles.grid}>
          <Field label="Тип">{TYPE_LABEL[p.proposalType] ?? p.proposalType}</Field>
          <Field label="Атом">
            {p.atomId ? (
              <code style={styles.code}>{p.atomId}</code>
            ) : (
              <span style={styles.muted}>
                — (создастся при merge, new_atom)
              </span>
            )}
          </Field>
          <Field label="Автор">
            <code style={styles.code}>{p.createdBy}</code>
          </Field>
          <Field label="Создано">{formatTs(p.createdAt)}</Field>
          <Field label="Обновлено">{formatTs(p.updatedAt)}</Field>
          {p.reviewedBy && (
            <Field label="Ревьюер">
              <code style={styles.code}>{p.reviewedBy}</code>
            </Field>
          )}
          {p.mergedBy && (
            <Field label="Merged by">
              <code style={styles.code}>{p.mergedBy}</code>
            </Field>
          )}
          {p.mergedAt && (
            <Field label="Merged">{formatTs(p.mergedAt)}</Field>
          )}
        </div>

        {p.reason && (
          <div style={styles.noteDanger}>
            <div style={styles.noteLabel}>Причина отклонения</div>
            <div>{p.reason}</div>
          </div>
        )}
        {p.reviewNote && (
          <div style={styles.noteInfo}>
            <div style={styles.noteLabel}>Заметка ревью</div>
            <div>{p.reviewNote}</div>
          </div>
        )}
      </Card>

      <Card title="Payload">
        <pre style={styles.pre}>{JSON.stringify(p.payload, null, 2)}</pre>
      </Card>

      <Card title="Действия">
        {p.status === 'draft' && isAuthor && (
          <Button
            loading={updateStatus.isPending}
            onClick={() => updateStatus.mutate({ status: 'submitted' })}
          >
            submit (отправить на ревью)
          </Button>
        )}
        {p.status === 'draft' && !isAuthor && (
          <div style={styles.muted}>
            Ожидает submit от автора. Автор не вы.
          </div>
        )}

        {p.status === 'submitted' && !isReviewer && (
          <div style={styles.muted}>
            Ожидает ревьюера (FIRST_ARCHITECT | COUNCIL_MEMBER).
          </div>
        )}
        {p.status === 'submitted' && isReviewer && (
          <ActionRow
            primaryLabel="взять в ревью"
            onPrimary={() =>
              updateStatus.mutate({
                status: 'in_review',
                ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
              })
            }
            onReject={doReject}
            pending={updateStatus.isPending}
          />
        )}

        {p.status === 'in_review' && !isReviewer && (
          <div style={styles.muted}>
            На ревью у FIRST_ARCHITECT | COUNCIL_MEMBER.
          </div>
        )}
        {p.status === 'in_review' && isReviewer && (
          <ActionRow
            primaryLabel="одобрить"
            onPrimary={() =>
              updateStatus.mutate({
                status: 'approved',
                ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
              })
            }
            onReject={doReject}
            pending={updateStatus.isPending}
          />
        )}

        {p.status === 'approved' && !isReviewer && (
          <div style={styles.muted}>
            Одобрено. Merge — действие ревьюера.
          </div>
        )}
        {p.status === 'approved' && isReviewer && (
          <div style={styles.actionColumn}>
            <div style={styles.actionRow}>
              <Button
                variant="secondary"
                loading={merge.isPending}
                onClick={() => merge.mutate()}
              >
                merge (записать в каталог)
              </Button>
              <Button variant="danger" onClick={doReject} loading={updateStatus.isPending}>
                отклонить
              </Button>
            </div>
            <div style={styles.muted}>
              После merge: new_atom создаст атом (MAX+1), update_atom бампнет
              версию (minor), deprecate_atom → status='deprecated'. Всё в
              одной транзакции.
            </div>
          </div>
        )}

        {p.status === 'merged' && (
          <div>
            <Badge tone="success">merged</Badge>
            {p.atomId && (
              <span style={styles.muted}>
                {' '}Атом <code style={styles.code}>{p.atomId}</code> создан
                / обновлён. Откройте во вкладке «Каталог» паспорта.
              </span>
            )}
          </div>
        )}

        {p.status === 'rejected' && (
          <div>
            <Badge tone="danger">rejected</Badge>{' '}
            <span style={styles.muted}>
              Предложение отклонено. История сохранена.
            </span>
          </div>
        )}

        {(p.status === 'submitted' || p.status === 'in_review' || p.status === 'approved') &&
          isReviewer && (
            <div style={{ marginTop: spacing.md, display: 'grid', gap: spacing.sm }}>
              <input
                placeholder="reviewNote (опционально)"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                style={styles.input}
              />
              <input
                placeholder="reason (обязателен для reject)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={styles.input}
              />
            </div>
          )}

        {localError && (
          <div style={{ color: colors.danger, fontSize: fontSize.sm, marginTop: 6 }}>
            {localError}
          </div>
        )}
        {mutError && (
          <div style={{ color: colors.danger, fontSize: fontSize.sm, marginTop: 6 }}>
            {mutError}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Вспомогательные ────────────────────────────────────────────────

function ActionRow({
  primaryLabel,
  onPrimary,
  onReject,
  pending,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onReject: () => void;
  pending: boolean;
}): ReactElement {
  return (
    <div style={styles.actionRow}>
      <Button variant="secondary" onClick={onPrimary} loading={pending}>
        {primaryLabel}
      </Button>
      <Button variant="danger" onClick={onReject} loading={pending}>
        отклонить
      </Button>
    </div>
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

function formatTs(iso: string): ReactElement {
  return <code style={styles.code}>{new Date(iso).toISOString().replace('T', ' ').slice(0, 19)}</code>;
}

// ─── Стили ──────────────────────────────────────────────────────────

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: spacing.md,
    marginBottom: spacing.md,
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
  noteDanger: {
    background: 'rgba(239,68,68,0.08)',
    borderLeft: `3px solid ${colors.danger}`,
    padding: '8px 12px',
    borderRadius: 4,
    marginTop: spacing.sm,
  } as const,
  noteInfo: {
    background: 'rgba(59,130,246,0.08)',
    borderLeft: `3px solid ${colors.primary}`,
    padding: '8px 12px',
    borderRadius: 4,
    marginTop: spacing.sm,
  } as const,
  noteLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as const,
  pre: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bg,
    padding: 12,
    borderRadius: 6,
    overflow: 'auto',
    maxHeight: 500,
    margin: 0,
  } as const,
  actionRow: {
    display: 'flex',
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
  } as const,
  actionColumn: { display: 'grid', gap: spacing.sm } as const,
  input: {
    padding: '6px 10px',
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
  } as const,
};