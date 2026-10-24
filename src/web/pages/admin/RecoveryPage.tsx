// F.4.04.05 — Admin recovery queue.
// Список + side panel с approve / reject.
//
// Источник:
//   GET  /admin/recovery/queue                  — список
//   POST /admin/recovery/:id/approve            — одобрить (A.1.35.01)
//   POST /admin/recovery/:id/reject             — отклонить (A.1.35.01)
//
// Deep link: /admin/recovery?selected=<request_id>

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiPost, type ApiError } from '../../api/client';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { Table, type Column } from '../../components/ui/Table';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../../theme';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type RecoveryStatus = 'pending' | 'approved' | 'used' | 'rejected' | 'expired';

interface RecoveryQueueItem {
  requestId: string;
  participantId: string;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: RecoveryStatus;
  requestedAt: string;
  requestedIp: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  tokenExpiresAt: string | null;
  usedAt: string | null;
  rejectReason: string | null;
}

interface ListEnvelope<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number };
  audit_id: string;
}

interface ApproveResult {
  request_id: string;
  expires_at: string;
  delivered_via: string[];
  warning?: string;
  dev_token?: string;
}

const RECOVERY_STATUS_LABEL: Record<RecoveryStatus, string> = {
  pending:  'Ожидает',
  approved: 'Одобрена',
  used:     'Использована',
  rejected: 'Отклонена',
  expired:  'Истекла',
};

const RECOVERY_STATUS_TONE: Record<RecoveryStatus, BadgeTone> = {
  pending:  'warning',
  approved: 'info',
  used:     'success',
  rejected: 'danger',
  expired:  'default',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────────
// Side panel
// ─────────────────────────────────────────────────────────────────

type PanelMode = 'view' | 'reject' | 'approved';

function RecoveryPanel({
  item,
  onClose,
  onChanged,
}: {
  item: RecoveryQueueItem;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const [mode, setMode] = useState<PanelMode>('view');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);

  const isPending = item.status === 'pending';

  const onApprove = async (): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      const r = await apiPost<ApproveResult>(
        `/admin/recovery/${item.requestId}/approve`,
        {},
      );
      setApproveResult(r);
      setMode('approved');
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Ошибка одобрения');
    } finally {
      setBusy(false);
    }
  };

  const onReject = async (): Promise<void> => {
    setErr(null);
    if (!reason.trim()) {setErr('Укажите причину'); return;}
    setBusy(true);
    try {
      await apiPost(`/admin/recovery/${item.requestId}/reject`, {
        reason: reason.trim(),
      });
      onChanged();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Ошибка отклонения');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside style={styles.panel}>
      <div style={styles.panelHeader}>
        <h2 style={styles.panelTitle}>Заявка на восстановление</h2>
        <button type="button" onClick={onClose} style={styles.panelClose} aria-label="Закрыть">×</button>
      </div>

      <div style={styles.panelBody}>
        <div style={styles.metaBlock}>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Участник:</span>
            <span>{item.name}{item.pseudonym ? ` (${item.pseudonym})` : ''}</span>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>External ID:</span>
            <code style={styles.code}>{item.externalId}</code>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Статус:</span>
            <Badge tone={RECOVERY_STATUS_TONE[item.status]}>
              {RECOVERY_STATUS_LABEL[item.status]}
            </Badge>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Заявка:</span>
            <span>{formatDateTime(item.requestedAt)}</span>
          </div>
          {item.requestedIp && (
            <div style={styles.kv}>
              <span style={styles.kvKey}>IP:</span>
              <code style={styles.code}>{item.requestedIp}</code>
            </div>
          )}
          {item.approvedAt && (
            <div style={styles.kv}>
              <span style={styles.kvKey}>Одобрена:</span>
              <span>{formatDateTime(item.approvedAt)}</span>
            </div>
          )}
          {item.tokenExpiresAt && (
            <div style={styles.kv}>
              <span style={styles.kvKey}>Токен до:</span>
              <span>{formatDateTime(item.tokenExpiresAt)}</span>
            </div>
          )}
          {item.usedAt && (
            <div style={styles.kv}>
              <span style={styles.kvKey}>Использована:</span>
              <span>{formatDateTime(item.usedAt)}</span>
            </div>
          )}
          {item.rejectReason && (
            <div style={styles.kv}>
              <span style={styles.kvKey}>Причина отказа:</span>
              <span>{item.rejectReason}</span>
            </div>
          )}
        </div>

        {mode === 'view' && isPending && (
          <div style={styles.panelActions}>
            <Button variant="primary" onClick={onApprove} disabled={busy}>
              {busy ? 'Одобряем…' : 'Одобрить'}
            </Button>
            <Button variant="danger" onClick={() => setMode('reject')} disabled={busy}>
              Отклонить
            </Button>
          </div>
        )}

        {mode === 'view' && !isPending && (
          <p style={styles.muted}>
            Действий нет — заявка в терминальном статусе.
          </p>
        )}

        {mode === 'reject' && (
          <div style={styles.actionBlock}>
            <h3 style={styles.subHeader}>Отклонить заявку</h3>
            <div style={styles.field}>
              <label style={styles.label}>Причина (1..1000)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                style={styles.textarea}
                disabled={busy}
                placeholder="Например: заявка подана не самим участником"
              />
            </div>
            {err && <p style={styles.error}>{err}</p>}
            <div style={styles.panelActions}>
              <Button variant="danger" onClick={onReject} disabled={busy}>
                {busy ? 'Отклоняем…' : 'Отклонить'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {setMode('view'); setErr(null);}}
                disabled={busy}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}

        {mode === 'approved' && approveResult && (
          <div style={styles.actionBlock}>
            <h3 style={styles.subHeader}>Токен отправлен</h3>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Истекает:</span>
              <span>{formatDateTime(approveResult.expires_at)}</span>
            </div>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Каналы:</span>
              <span>
                {approveResult.delivered_via.length > 0
                  ? approveResult.delivered_via.join(', ')
                  : '— нет —'}
              </span>
            </div>
            {approveResult.warning && (
              <p style={styles.warning}>{approveResult.warning}</p>
            )}
            {approveResult.dev_token && (
              <div style={styles.devBlock}>
                <p style={styles.warnDev}>
                  DEV-ONLY (ALLOW_DEV_TOKEN=true). В prod не отдаётся.
                </p>
                <code style={styles.devToken}>{approveResult.dev_token}</code>
              </div>
            )}
            <div style={styles.panelActions}>
              <Button variant="ghost" onClick={onClose}>Закрыть</Button>
            </div>
          </div>
        )}

        {mode === 'view' && err && <p style={styles.error}>{err}</p>}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────

export function RecoveryPage(): ReactElement {
  const [params, setParams] = useSearchParams();

  const statusFilter = params.get('statuses') ?? 'pending,approved';
  const selectedId   = params.get('selected');

  const update = (patch: Partial<{ statuses: string; selected: string | null }>): void => {
    const next = new URLSearchParams(params);
    if (patch.statuses !== undefined) {
      if (patch.statuses && patch.statuses !== 'pending,approved') {
        next.set('statuses', patch.statuses);
      } else {
        next.delete('statuses');
      }
    }
    if (patch.selected !== undefined) {
      if (patch.selected) {
        next.set('selected', patch.selected);
      } else {
        next.delete('selected');
      }
    }
    setParams(next, { replace: true });
  };

  const q = useApiQuery<ListEnvelope<RecoveryQueueItem>>(
    ['admin', 'recovery', statusFilter],
    `/admin/recovery/queue?statuses=${encodeURIComponent(statusFilter)}&page=1&per_page=100`,
  );

  const selected = useMemo(() => {
    if (!selectedId || !q.data) {return null;}
    return q.data.data.find((r) => r.requestId === selectedId) ?? null;
  }, [selectedId, q.data]);

  useEffect(() => {
    if (selectedId && q.data && !selected) {
      update({ selected: null });
    }
  }, [selectedId, selected, q.data]);

  const columns: Column<RecoveryQueueItem>[] = [
    { key: 'externalId', title: 'External ID' },
    { key: 'name', title: 'Имя' },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => (
        <Badge tone={RECOVERY_STATUS_TONE[r.status]}>
          {RECOVERY_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    { key: 'requestedAt', title: 'Заявка', render: (r) => formatDateTime(r.requestedAt) },
    { key: 'requestedIp', title: 'IP', render: (r) => r.requestedIp ?? '—' },
    {
      key: 'approvedAt',
      title: 'Одобрено',
      render: (r) => (r.approvedAt ? formatDateTime(r.approvedAt) : '—'),
    },
    {
      key: 'tokenExpiresAt',
      title: 'Токен до',
      render: (r) => (r.tokenExpiresAt ? formatDateTime(r.tokenExpiresAt) : '—'),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.pageHead}>
        <h1 style={styles.h1}>Recovery-очередь</h1>
        <span style={styles.totalLabel}>Всего: {q.data?.meta.total ?? 0}</span>
      </div>

      <div style={styles.filters}>
        <select
          value={statusFilter}
          onChange={(e) => update({ statuses: e.target.value })}
          style={styles.select}
        >
          <option value="pending,approved">Активные (ожидают, одобрены)</option>
          <option value="pending">Только ожидающие</option>
          <option value="approved">Только одобренные</option>
          <option value="used">Использованные</option>
          <option value="rejected">Отклонённые</option>
          <option value="expired">Истёкшие</option>
          <option value="pending,approved,used,rejected,expired">Все</option>
        </select>
      </div>

      <div style={styles.body}>
        <div style={styles.listCol}>
          {q.isLoading ? (
            <Spinner label="Загружаем очередь…" />
          ) : q.isError || !q.data ? (
            <Card title="Ошибка"><p style={styles.error}>Не удалось загрузить очередь</p></Card>
          ) : (
            <Table<RecoveryQueueItem>
              data={q.data.data}
              columns={columns}
              getRowId={(r) => r.requestId}
              onRowClick={(r) => update({ selected: r.requestId })}
              emptyMessage="Заявок нет"
            />
          )}
        </div>

        {selected && (
          <RecoveryPanel
            item={selected}
            onClose={() => update({ selected: null })}
            onChanged={() => {void q.refetch();}}
          />
        )}
      </div>
    </div>
  );
}

export default RecoveryPage;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' } as const,
  pageHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text } as const,
  totalLabel: { color: colors.textMuted, fontSize: fontSize.sm } as const,

  filters: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' } as const,
  select: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 260,
  } as const,

  body: { display: 'flex', gap: spacing.md, flex: 1, minHeight: 0 } as const,
  listCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.sm } as const,

  panel: {
    width: 400,
    flexShrink: 0,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as const,
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  panelTitle: { fontSize: fontSize.md, fontWeight: 600, margin: 0, color: colors.text } as const,
  panelClose: {
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
  } as const,
  panelBody: { padding: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm, overflowY: 'auto' } as const,
  panelActions: { display: 'flex', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' } as const,

  metaBlock: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: spacing.sm } as const,
  kv: { display: 'flex', gap: spacing.sm, alignItems: 'baseline', fontSize: fontSize.sm, color: colors.text } as const,
  kvKey: { color: colors.textMuted, minWidth: 110 } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs, color: colors.textMuted } as const,

  field: { display: 'flex', flexDirection: 'column', gap: 4 } as const,
  label: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 } as const,
  subHeader: { fontSize: fontSize.sm, fontWeight: 600, margin: '0 0 6px', color: colors.text } as const,
  textarea: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical',
  } as const,
  actionBlock: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  } as const,

  devBlock: {
    padding: spacing.sm,
    border: `1px dashed ${colors.warning}`,
    borderRadius: radius.sm,
    background: 'rgba(251,191,36,0.05)',
  } as const,
  warnDev: { color: colors.warning, fontSize: fontSize.xs, margin: '0 0 6px' } as const,
  devToken: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.text,
    wordBreak: 'break-all',
    display: 'block',
  } as const,

  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  warning: { color: colors.warning, fontSize: fontSize.sm } as const,
  error: { color: colors.danger, fontSize: fontSize.sm } as const,
};