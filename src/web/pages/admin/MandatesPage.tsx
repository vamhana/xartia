// F.4.04.04 — Admin mandates.
// Список мандатов + фильтры + создание / ротация / отзыв.
//
// Источник:
//   GET  /admin/mandates           — список с резолвом имён (A.1.35.01 → C.0.35.02)
//   POST /admin/delegate           — выдача (обёртка над C.0.05.02)
//   POST /mandates/:id/rotate      — ротация (A.1.05.01)
//   DELETE /mandates/:id?reason=…  — отзыв (A.1.05.01, reason в query, не в body)
//
// Deep link: /admin/mandates?selected=<uuid> открывает side panel.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiDelete, apiPost, type ApiError } from '../../api/client';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { Table, type Column } from '../../components/ui/Table';
import { useApiQuery } from '../../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../../theme';

import { ParticipantPicker } from './ParticipantPicker';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type MandateStatus = 'active' | 'expired' | 'revoked';

interface AdminMandateRow {
  id: string;
  function: string;
  holderId: string;
  holderName: string;
  holderExternalId: string;
  directionId: string | null;
  directionNumber: number | null;
  directionName: string | null;
  grantedBy: string;
  grantedByName: string | null;
  grantedAt: string;
  expiresAt: string;
  status: MandateStatus;
  conditions: Record<string, unknown>;
  scope: Record<string, unknown>;
  daysLeft: number | null;
}

interface ListEnvelope<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number };
  audit_id: string;
}

interface DirectionBrief {
  id: string;
  number: number;
  name: string;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

// Функции мандатов — 8 ролей, которые засеиваются D.2.01.07.
// TODO: вынести в GET /roles или /permissions/roles — тогда не хардкодить.
const FUNCTIONS: readonly string[] = [
  'COUNCIL_MEMBER', 'OTC', 'LIAISON', 'VERIFIER',
  'BALANCER', 'KEEPER', 'PSY', 'OBLIVION',
];

const FUNCTION_LABEL: Record<string, string> = {
  COUNCIL_MEMBER: 'Совет направления',
  OTC:            'ОТК',
  LIAISON:        'Связной',
  VERIFIER:       'Верификатор',
  BALANCER:       'Балансировщик',
  KEEPER:         'Хранитель',
  PSY:            'Психоэколог',
  OBLIVION:       'Инженерия Обнуления',
};

const STATUS_LABEL: Record<MandateStatus, string> = {
  active:  'Активен',
  expired: 'Истёк',
  revoked: 'Отозван',
};

const STATUS_TONE: Record<MandateStatus, BadgeTone> = {
  active:  'success',
  expired: 'default',
  revoked: 'danger',
};

function functionLabel(fn: string): string {
  return FUNCTION_LABEL[fn] ?? fn;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────────
// Filter bar
// ─────────────────────────────────────────────────────────────────

function FilterBar({
  directions, functionFilter, status, directionId, holderId,
  onChange,
}: {
  directions: DirectionBrief[];
  functionFilter: string;
  status: string;
  directionId: string;
  holderId: string;
  onChange: (patch: Partial<{
    functionFilter: string; status: string; directionId: string; holderId: string; page: number;
  }>) => void;
}): ReactElement {
  return (
    <div style={styles.filters}>
      <select
        value={functionFilter}
        onChange={(e) => onChange({ functionFilter: e.target.value, page: 1 })}
        style={styles.select}
      >
        <option value="">Все функции</option>
        {FUNCTIONS.map((f) => (
          <option key={f} value={f}>{functionLabel(f)}</option>
        ))}
      </select>
      <select
        value={directionId}
        onChange={(e) => onChange({ directionId: e.target.value, page: 1 })}
        style={styles.select}
      >
        <option value="">Все направления</option>
        {directions.map((d) => (
          <option key={d.id} value={d.id}>№{d.number} — {d.name}</option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => onChange({ status: e.target.value, page: 1 })}
        style={styles.select}
      >
        <option value="">Все статусы</option>
        <option value="active">Активен</option>
        <option value="expired">Истёк</option>
        <option value="revoked">Отозван</option>
      </select>
      <div style={{ minWidth: 220, flex: 1 }}>
        <ParticipantPicker
          value={holderId}
          onChange={(id) => onChange({ holderId: id, page: 1 })}
          placeholder="Фильтр по держателю"
        />
      </div>
      {(functionFilter || status || directionId || holderId) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({
            functionFilter: '', status: '', directionId: '', holderId: '', page: 1,
          })}
        >
          Сбросить
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Create modal
// ─────────────────────────────────────────────────────────────────

function CreateMandateModal({
  directions,
  onClose,
  onCreated,
}: {
  directions: DirectionBrief[];
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [fn, setFn] = useState(FUNCTIONS[0] ?? 'COUNCIL_MEMBER');
  const [holderId, setHolderId] = useState('');
  const [directionId, setDirectionId] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date(Date.now() + 30 * 86_400_000);
    return d.toISOString().slice(0, 16);  // YYYY-MM-DDTHH:MM для datetime-local
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    setErr(null);
    if (!holderId) {setErr('Укажите holder_id'); return;}
    setBusy(true);
    try {
      await apiPost('/admin/delegate', {
        function: fn,
        holder_id: holderId,
        ...(directionId ? { direction_id: directionId } : {}),
        expires_at: new Date(expiresAt).toISOString(),
      });
      onCreated();
    } catch (e) {
      const err = e as ApiError;
      setErr(err.message ?? 'Ошибка создания мандата');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Выдать мандат</h2>
          <button type="button" onClick={onClose} style={styles.panelClose} aria-label="Закрыть">×</button>
        </div>
        <div style={styles.modalBody}>
          <div style={styles.field}>
            <label style={styles.label}>Функция</label>
            <select value={fn} onChange={(e) => setFn(e.target.value)} style={styles.select} disabled={busy}>
              {FUNCTIONS.map((f) => (
                <option key={f} value={f}>{functionLabel(f)}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Держатель мандата</label>
            <ParticipantPicker
              value={holderId}
              onChange={setHolderId}
              disabled={busy}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Направление (опционально)</label>
            <select
              value={directionId}
              onChange={(e) => setDirectionId(e.target.value)}
              style={styles.select}
              disabled={busy}
            >
              <option value="">— не задано —</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>№{d.number} — {d.name}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Действует до</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={styles.input}
              disabled={busy}
            />
          </div>
          {err && <p style={styles.error}>{err}</p>}
          <div style={styles.panelActions}>
            <Button variant="primary" onClick={onSubmit} disabled={busy}>
              {busy ? 'Создаём…' : 'Создать мандат'}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Side panel — карточка мандата + действия
// ─────────────────────────────────────────────────────────────────

type PanelMode = 'view' | 'rotate' | 'revoke';

function MandatePanel({
  mandate,
  onClose,
  onChanged,
}: {
  mandate: AdminMandateRow;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const [mode, setMode] = useState<PanelMode>('view');
  const [successorId, setSuccessorId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onRotate = async (): Promise<void> => {
    setErr(null);
    if (!successorId) {setErr('Укажите successor_id'); return;}
    setBusy(true);
    try {
      await apiPost(`/mandates/${mandate.id}/rotate`, { successor_id: successorId });
      onChanged();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Ошибка ротации');
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (): Promise<void> => {
    setErr(null);
    if (!reason.trim()) {setErr('Укажите причину'); return;}
    setBusy(true);
    try {
      await apiDelete(`/mandates/${mandate.id}?reason=${encodeURIComponent(reason)}`);
      onChanged();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Ошибка отзыва');
    } finally {
      setBusy(false);
    }
  };

  const isActive = mandate.status === 'active';

  return (
    <aside style={styles.panel}>
      <div style={styles.panelHeader}>
        <h2 style={styles.panelTitle}>Мандат</h2>
        <button type="button" onClick={onClose} style={styles.panelClose} aria-label="Закрыть">×</button>
      </div>

      <div style={styles.panelBody}>
        <div style={styles.metaBlock}>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Функция:</span>
            <span>{functionLabel(mandate.function)}</span>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Статус:</span>
            <Badge tone={STATUS_TONE[mandate.status]}>{STATUS_LABEL[mandate.status]}</Badge>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Держатель:</span>
            <span>{mandate.holderName} <code style={styles.code}>({mandate.holderExternalId})</code></span>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Направление:</span>
            <span>{mandate.directionName ? `№${mandate.directionNumber} — ${mandate.directionName}` : '—'}</span>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Выдан:</span>
            <span>{formatDateTime(mandate.grantedAt)}</span>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Истекает:</span>
            <span>
              {formatDateTime(mandate.expiresAt)}
              {mandate.daysLeft !== null && (
                <span style={styles.muted}> · осталось {mandate.daysLeft} дн.</span>
              )}
            </span>
          </div>
          <div style={styles.kv}>
            <span style={styles.kvKey}>Выдал:</span>
            <span>{mandate.grantedByName ?? mandate.grantedBy}</span>
          </div>
        </div>

        {mode === 'view' && (
          <div style={styles.panelActions}>
            <Button variant="secondary" onClick={() => setMode('rotate')} disabled={!isActive}>
              Ротировать
            </Button>
            <Button variant="danger" onClick={() => setMode('revoke')} disabled={!isActive}>
              Отозвать
            </Button>
          </div>
        )}

        {mode === 'rotate' && (
          <div style={styles.actionBlock}>
            <h3 style={styles.subHeader}>Ротация</h3>
            <div style={styles.field}>
              <label style={styles.label}>Преемник</label>
              <ParticipantPicker
                value={successorId}
                onChange={setSuccessorId}
                disabled={busy}
              />
            </div>
            {err && <p style={styles.error}>{err}</p>}
            <div style={styles.panelActions}>
              <Button variant="primary" onClick={onRotate} disabled={busy}>
                {busy ? 'Ротируем…' : 'Ротировать'}
              </Button>
              <Button variant="ghost" onClick={() => {setMode('view'); setErr(null);}} disabled={busy}>
                Отмена
              </Button>
            </div>
          </div>
        )}

        {mode === 'revoke' && (
          <div style={styles.actionBlock}>
            <h3 style={styles.subHeader}>Отзыв мандата</h3>
            <div style={styles.field}>
              <label style={styles.label}>Причина (1..500)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                style={styles.textarea}
                disabled={busy}
              />
            </div>
            {err && <p style={styles.error}>{err}</p>}
            <div style={styles.panelActions}>
              <Button variant="danger" onClick={onRevoke} disabled={busy}>
                {busy ? 'Отзываем…' : 'Отозвать'}
              </Button>
              <Button variant="ghost" onClick={() => {setMode('view'); setErr(null);}} disabled={busy}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────

export function MandatesPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const functionFilter = params.get('function') ?? '';
  const status         = params.get('status') ?? '';
  const directionId    = params.get('direction_id') ?? '';
  const holderId       = params.get('holder_id') ?? '';
  const page           = Number(params.get('page') ?? '1') || 1;
  const selectedId     = params.get('selected');

  const update = (patch: Partial<{
    functionFilter: string; status: string; directionId: string; holderId: string;
    page: number; selected: string | null;
  }>): void => {
    const next = new URLSearchParams(params);
    const setOrDel = (k: string, v: string | undefined | null): void => {
      if (v) {next.set(k, v);} else {next.delete(k);}
    };
    if (patch.functionFilter !== undefined) {setOrDel('function', patch.functionFilter);}
    if (patch.status !== undefined)         {setOrDel('status', patch.status);}
    if (patch.directionId !== undefined)    {setOrDel('direction_id', patch.directionId);}
    if (patch.holderId !== undefined)       {setOrDel('holder_id', patch.holderId);}
    if (patch.page !== undefined)           {setOrDel('page', patch.page > 1 ? String(patch.page) : null);}
    if (patch.selected !== undefined)       {setOrDel('selected', patch.selected);}
    setParams(next, { replace: true });
  };

  const qs = new URLSearchParams();
  if (functionFilter) {qs.set('function', functionFilter);}
  if (status) {qs.set('status', status);}
  if (directionId) {qs.set('direction_id', directionId);}
  if (holderId) {qs.set('holder_id', holderId);}
  qs.set('page', String(page));
  qs.set('per_page', '50');

  const listQ = useApiQuery<ListEnvelope<AdminMandateRow>>(
    ['admin', 'mandates', functionFilter, status, directionId, holderId, page],
    `/admin/mandates?${qs.toString()}`,
  );

  const dirQ = useApiQuery<{ data: DirectionBrief[] }>(
    ['directions', 'list'],
    '/directions',
  );

  const directions = dirQ.data?.data ?? [];

  const selected = useMemo(() => {
    if (!selectedId || !listQ.data) {return null;}
    return listQ.data.data.find((m) => m.id === selectedId) ?? null;
  }, [selectedId, listQ.data]);

  // При смене фильтров — сбрасываем выбранный мандат, если его нет в новом списке.
  useEffect(() => {
    if (selectedId && listQ.data && !selected) {
      update({ selected: null });
    }
  }, [selectedId, selected, listQ.data]);

  const columns: Column<AdminMandateRow>[] = [
    {
      key: 'function',
      title: 'Функция',
      render: (r) => functionLabel(r.function),
    },
    {
      key: 'holderName',
      title: 'Держатель',
      render: (r) => (
        <>
          {r.holderName}
          <span style={styles.muted}> · {r.holderExternalId}</span>
        </>
      ),
    },
    {
      key: 'directionName',
      title: 'Направление',
      render: (r) => (r.directionName ? `№${r.directionNumber} — ${r.directionName}` : '—'),
    },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'expiresAt',
      title: 'Истекает',
      render: (r) => (
        <>
          {formatDate(r.expiresAt)}
          {r.daysLeft !== null && r.daysLeft < 30 && (
            <span style={styles.muted}> · {r.daysLeft} дн.</span>
          )}
        </>
      ),
    },
  ];

  const total = listQ.data?.meta.total ?? 0;
  const perPage = listQ.data?.meta.per_page ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div style={styles.page}>
      <div style={styles.pageHead}>
        <h1 style={styles.h1}>Мандаты</h1>
        <div style={styles.headActions}>
          <span style={styles.totalLabel}>Всего: {total}</span>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            + Выдать мандат
          </Button>
        </div>
      </div>

      <FilterBar
        directions={directions}
        functionFilter={functionFilter}
        status={status}
        directionId={directionId}
        holderId={holderId}
        onChange={update}
      />

      <div style={styles.body}>
        <div style={styles.listCol}>
          {listQ.isLoading ? (
            <Spinner label="Загружаем мандаты…" />
          ) : listQ.isError || !listQ.data ? (
            <Card title="Ошибка"><p style={styles.error}>Не удалось загрузить мандаты</p></Card>
          ) : (
            <>
              <Table<AdminMandateRow>
                data={listQ.data.data}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={(r) => update({ selected: r.id })}
                emptyMessage="Мандатов нет"
              />
              {totalPages > 1 && (
                <div style={styles.pager}>
                  <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
                    ← Назад
                  </Button>
                  <span style={styles.pagerLabel}>{page} / {totalPages}</span>
                  <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => update({ page: page + 1 })}>
                    Вперёд →
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {selected && (
          <MandatePanel
            mandate={selected}
            onClose={() => update({ selected: null })}
            onChanged={() => {void listQ.refetch();}}
          />
        )}
      </div>

      {creating && (
        <CreateMandateModal
          directions={directions}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void listQ.refetch();
          }}
        />
      )}
    </div>
  );
}

export default MandatesPage;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' } as const,
  pageHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  headActions: { display: 'flex', gap: spacing.sm, alignItems: 'center' } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text } as const,
  totalLabel: { color: colors.textMuted, fontSize: fontSize.sm } as const,

  filters: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' } as const,
  input: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 220,
    flex: 1,
  } as const,
  textarea: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical',
  } as const,
  select: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 160,
  } as const,

  body: { display: 'flex', gap: spacing.md, flex: 1, minHeight: 0 } as const,
  listCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.sm } as const,

  panel: {
    width: 380,
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
  kvKey: { color: colors.textMuted, minWidth: 100 } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs, color: colors.textMuted } as const,

  field: { display: 'flex', flexDirection: 'column', gap: 4 } as const,
  label: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 } as const,
  subHeader: { fontSize: fontSize.sm, fontWeight: 600, margin: '0 0 6px', color: colors.text } as const,
  actionBlock: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
  } as const,

  pager: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: spacing.sm } as const,
  pagerLabel: { color: colors.textMuted, fontSize: fontSize.sm } as const,

  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  error: { color: colors.danger, fontSize: fontSize.sm } as const,

  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as const,
  modal: {
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    minWidth: 420,
    maxWidth: 560,
    width: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as const,
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  modalTitle: { fontSize: fontSize.md, fontWeight: 600, margin: 0, color: colors.text } as const,
  modalBody: { padding: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm, overflowY: 'auto' } as const,
};