// F.4.02.08 — Очередь ОТК.
// Список отчётов со status='submitted' → принять / вернуть.

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { PRIORITY_LABEL, PRIORITY_TONE } from '../lib/format';
import { colors, spacing, fontSize, radius } from '../theme';

interface OtcQueueItem {
  reportId: string;
  taskId: string;
  taskExternalId: string;
  taskDescription: string;
  directionId: string;
  authorId: string;
  authorName: string;
  type: 'photo' | 'video' | 'text';
  comment: string | null;
  mediaUrl: string | null;
  artifactUrl: string | null;
  geolocation: { lat: number; lon: number } | null;
  createdAt: string;
  hoursWaiting: number;
}

export function OtcPage(): ReactElement {
  const qc = useQueryClient();
  const queueQuery = useApiQuery<{ data: OtcQueueItem[] }>(
    ['otc', 'queue'],
    '/otc/queue',
    { refetchInterval: 20_000 },
  );

  const criteriaQuery = useApiQuery<{
    data: { items: Array<{ id: string; title: string; required?: boolean }> } | null;
  }>(['otc', 'criteria'], '/otc/criteria');

  const [actionError, setActionError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');

  const decideMutation = useMutation<
    unknown,
    Error,
    {
      reportId: string;
      verdict: 'accepted' | 'returned';
      comment?: string;
      criteria?: Array<{ id: string; passed: boolean }>;
    }
  >({
    mutationFn: (vars) =>
      apiPost('/otc/decisions', {
        report_id: vars.reportId,
        verdict: vars.verdict,
        ...(vars.comment ? { comment: vars.comment } : {}),
        ...(vars.criteria ? { criteria: vars.criteria } : {}),
      }),
    onSuccess: () => {
      setReturningId(null);
      setReturnReason('');
      setAcceptingId(null);
      setChecks({});
      void qc.invalidateQueries({ queryKey: ['otc', 'queue'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => setActionError(e.message),
  });

  const items = queueQuery.data?.data ?? [];

  const criteriaItems = criteriaQuery.data?.data?.items ?? [];

  const onAccept = (reportId: string): void => {
    setActionError(null);
    setAcceptingId(reportId);
    setChecks({});
  };

  const onAcceptConfirm = async (reportId: string): Promise<void> => {
    setActionError(null);
    const criteria = criteriaItems.map((item) => ({
      id: item.id,
      passed: checks[item.id] === true,
    }));
    try {
      await decideMutation.mutateAsync({ reportId, verdict: 'accepted', criteria });
    } catch {
      /* onError уже показал */
    }
  };

  const onReturnSubmit = async (reportId: string): Promise<void> => {
    setActionError(null);
    if (returnReason.trim().length === 0) {
      setActionError('Причина возврата обязательна');
      return;
    }
    try {
      await decideMutation.mutateAsync({
        reportId,
        verdict: 'returned',
        comment: returnReason,
      });
    } catch {
      /* onError уже показал */
    }
  };

  if (queueQuery.isLoading) {return <Spinner label="Загрузка очереди…" />;}
  if (queueQuery.isError) {
    return (
      <Card title="Ошибка">
        <div style={{ color: colors.danger }}>{queueQuery.error?.message}</div>
      </Card>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>
          Очередь ОТК
          {items.length > 0 && <span style={styles.count}>({items.length})</span>}
        </h1>
        <Button
          variant="secondary"
          onClick={() => void queueQuery.refetch()}
          loading={queueQuery.isFetching}
        >
          Обновить
        </Button>
      </div>

      {actionError && <div style={styles.error}>{actionError}</div>}

      {items.length === 0 ? (
        <Card>
          <div style={styles.empty}>Нет отчётов в очереди</div>
        </Card>
      ) : (
        <div style={styles.list}>
          {items.map((it) => (
            <Card
              key={it.reportId}
              title={
                <div style={styles.itemTitle}>
                  <code style={styles.extId}>{it.taskExternalId}</code>
                  <Badge tone={PRIORITY_TONE.standard}>
                    {PRIORITY_LABEL.standard}
                  </Badge>
                  <Badge tone="info">{it.type}</Badge>
                </div>
              }
              actions={
                returningId === it.reportId ? null : (
                  <div style={styles.actions}>
                    <Button
                      size="sm"
                      onClick={() => void onAccept(it.reportId)}
                      loading={
                        decideMutation.isPending &&
                        decideMutation.variables?.reportId === it.reportId &&
                        decideMutation.variables?.verdict === 'accepted'
                      }
                    >
                      Принять
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setReturningId(it.reportId);
                        setReturnReason('');
                      }}
                    >
                      Вернуть
                    </Button>
                  </div>
                )
              }
            >
              <div style={styles.taskBlock}>
                <div style={styles.taskLabel}>Задача</div>
                <div style={styles.taskText}>{it.taskDescription}</div>
              </div>

              {it.comment && (
                <div style={styles.commentBlock}>
                  <div style={styles.commentLabel}>Комментарий исполнителя</div>
                  <div style={styles.commentText}>{it.comment}</div>
                </div>
              )}

              {it.artifactUrl && (
                <div style={styles.mediaBlock}>
                  <span style={styles.metaLabel}>Результат:</span>{' '}
                  <a
                    href={it.artifactUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.mediaLink}
                  >
                    {it.artifactUrl.slice(0, 70)}
                    {it.artifactUrl.length > 70 ? '…' : ''}
                  </a>
                </div>
              )}

              {it.mediaUrl && (
                <div style={styles.mediaBlock}>
                  <span style={styles.metaLabel}>Медиа:</span>{' '}
                  <a
                    href={it.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.mediaLink}
                  >
                    {it.mediaUrl.slice(0, 60)}
                    {it.mediaUrl.length > 60 ? '…' : ''}
                  </a>
                </div>
              )}

              {it.geolocation && (
                <div style={styles.mediaBlock}>
                  <span style={styles.metaLabel}>Геометка:</span>{' '}
                  <code style={styles.code}>
                    {it.geolocation.lat.toFixed(5)}, {it.geolocation.lon.toFixed(5)}
                  </code>
                </div>
              )}

              <div style={styles.meta}>
                <span style={styles.metaLabel}>Автор:</span>{' '}
                <span style={styles.metaValue}>{it.authorName}</span>
                <span style={styles.dot}>·</span>
                <span style={styles.metaLabel}>Ждёт:</span>{' '}
                <span style={it.hoursWaiting > 24 ? styles.metaWarn : styles.metaValue}>
                  {it.hoursWaiting} ч
                </span>
              </div>

              {acceptingId === it.reportId && (
              <div style={styles.criteriaBlock}>
                <div style={styles.label}>Критерии приёмки *</div>
                {criteriaItems.length === 0 && (
                  <div style={styles.metaValue}>Критерии не заданы</div>
                )}
                {criteriaItems.map((item) => (
                  <label key={item.id} style={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={checks[item.id] === true}
                      onChange={(e) => {
                        setChecks((prev) => ({ ...prev, [item.id]: e.target.checked }));
                      }}
                    />
                    <span>{item.title}{item.required === false ? ' (необязательно)' : ''}</span>
                  </label>
                ))}
                <div style={styles.returnActions}>
                  <Button variant="ghost" size="sm" onClick={() => setAcceptingId(null)}>
                    Отмена
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={criteriaItems.some((i) => i.required !== false && checks[i.id] !== true)}
                    loading={
                      decideMutation.isPending &&
                      decideMutation.variables?.reportId === it.reportId &&
                      decideMutation.variables?.verdict === 'accepted'
                    }
                    onClick={() => void onAcceptConfirm(it.reportId)}
                  >
                    Подтвердить приёмку
                  </Button>
                </div>
              </div>
            )}

            {returningId === it.reportId && (
                <div style={styles.returnBlock}>
                  <div style={styles.label}>Причина возврата *</div>
                  <textarea
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    rows={3}
                    style={styles.textarea}
                    placeholder="Что нужно исправить…"
                  />
                  <div style={styles.returnActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReturningId(null);
                        setReturnReason('');
                      }}
                    >
                      Отмена
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void onReturnSubmit(it.reportId)}
                      loading={
                        decideMutation.isPending &&
                        decideMutation.variables?.reportId === it.reportId &&
                        decideMutation.variables?.verdict === 'returned'
                      }
                    >
                      Подтвердить возврат
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: 900 } as const,
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  count: {
    color: colors.textMuted,
    fontWeight: 400,
    fontSize: fontSize.lg,
    marginLeft: 8,
  } as const,
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: `1px solid ${colors.danger}`,
    color: colors.danger,
    padding: '8px 12px',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  } as const,
  empty: {
    color: colors.textMuted,
    textAlign: 'center' as const,
    padding: 20,
    fontSize: fontSize.sm,
  } as const,
  list: { display: 'flex', flexDirection: 'column' as const } as const,
  itemTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  } as const,
  extId: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.textDim,
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: radius.sm,
  } as const,
  actions: { display: 'flex', gap: spacing.sm } as const,
  taskBlock: {
    background: 'rgba(59, 130, 246, 0.08)',
    borderLeft: `3px solid ${colors.primary}`,
    padding: '8px 12px',
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  } as const,
  taskLabel: {
    fontSize: fontSize.xs,
    color: colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as const,
  taskText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.5,
  } as const,
  commentBlock: {
    background: colors.bg,
    padding: '8px 12px',
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  } as const,
  commentLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as const,
  commentText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  } as const,
  mediaBlock: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    fontSize: fontSize.xs,
    marginBottom: 6,
  } as const,
  mediaLink: {
    color: colors.info,
    textDecoration: 'none',
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
  } as const,
  meta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: fontSize.xs,
  } as const,
  metaLabel: { color: colors.textDim } as const,
  metaValue: { color: colors.text } as const,
  metaWarn: { color: colors.warning, fontWeight: 600 } as const,
  dot: { color: colors.textDim } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    background: colors.bg,
    padding: '1px 5px',
    borderRadius: radius.sm,
    fontSize: fontSize.xs,
  } as const,
  criteriaBlock: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    background: colors.bgSoft,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: '4px 0',
    fontSize: fontSize.sm,
    color: colors.text,
  },
  returnBlock: { marginTop: spacing.md } as const,
  label: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  } as const,
  textarea: {
    width: '100%',
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: '8px 12px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  } as const,
  returnActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  } as const,
};