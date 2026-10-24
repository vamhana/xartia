// F.4.04.03 — Admin participants.
// Список + фильтры + side panel с карточкой и редактированием.
// Deep link: /admin/participants?selected=<uuid> открывает side panel.
// Состояние фильтров в URL: ?direction_id=&status=&search=&page=

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiPatch, apiPost, setTokens } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { Table, type Column } from '../../components/ui/Table';
import { useApiQuery } from '../../hooks/useApi';
import { saveDevReturn } from '../../lib/dev';
import { colors, fontSize, radius, spacing } from '../../theme';

interface ParticipantRow {
  id: string;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: string;
  profileRisk: string;
  directionId: string | null;
  directionNumber: number | null;
  directionName: string | null;
  mentorId: string | null;
  cellId: string | null;
  enteredAt: string;
  welcomePackGiven: boolean;
  isFirstArchitect: boolean;
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

const STATUS_OPTIONS: readonly string[] = [
  'associated', 'compatible', 'conditionally_compatible', 'full',
  'paused', 'outside_trust_network', 'master', 'integrator',
  'pioneer', 'excluded',
];

/** Человекочитаемые подписи статусов (синхронизировано с C.0.01.04). */
const STATUS_LABEL: Record<string, string> = {
  associated:                 'Ассоциированный',
  compatible:                 'Совместимый',
  conditionally_compatible:   'Условно совместимый',
  full:                       'Полный',
  paused:                     'На паузе',
  outside_trust_network:      'Вне сети доверия',
  master:                     'Мастер',
  integrator:                 'Интегратор',
  pioneer:                    'Пионер',
  excluded:                   'Отчуждён',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function statusTone(status: string): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'master' {
  switch (status) {
    case 'master':                      return 'master';
    case 'full':
    case 'compatible':                  return 'success';
    case 'associated':                  return 'info';
    case 'conditionally_compatible':
    case 'paused':                      return 'warning';
    case 'outside_trust_network':
    case 'excluded':                    return 'danger';
    default:                            return 'default';
  }
}

/** Человекочитаемые подписи профиля риска (синхронизировано с C.0.01.04). */
const RISK_LABEL: Record<string, string> = {
  compatible:                 'Совместимый',
  conditionally_compatible:   'Условно совместимый',
  incompatible:               'Несовместимый',
};

function riskLabel(risk: string): string {
  return RISK_LABEL[risk] ?? risk;
}

// ─── Filter bar ──────────────────────────────────────────────────

function FilterBar({
  directions,
  search, status, directionId,
  onChange,
}: {
  directions: DirectionBrief[];
  search: string;
  status: string;
  directionId: string;
  onChange: (patch: Partial<{ search: string; status: string; directionId: string; page: number }>) => void;
}): ReactElement {
  return (
    <div style={styles.filters}>
      <input
        type="text"
        placeholder="Поиск по имени / external_id / псевдониму"
        value={search}
        onChange={(e) => onChange({ search: e.target.value, page: 1 })}
        style={styles.input}
      />
      <select
        value={directionId}
        onChange={(e) => onChange({ directionId: e.target.value, page: 1 })}
        style={styles.select}
      >
        <option value="">Все направления</option>
        {directions.map((d) => (
          <option key={d.id} value={d.id}>
            №{d.number} — {d.name}
          </option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => onChange({ status: e.target.value, page: 1 })}
        style={styles.select}
      >
        <option value="">Все статусы</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{statusLabel(s)}</option>
        ))}
      </select>
      {(search || status || directionId) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ search: '', status: '', directionId: '', page: 1 })}
        >
          Сбросить
        </Button>
      )}
    </div>
  );
}

// ─── Side panel ──────────────────────────────────────────────────

function ParticipantPanel({
  participantId,
  directions,
  onClose,
  onSaved,
}: {
  participantId: string;
  directions: DirectionBrief[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const q = useApiQuery<ParticipantRow>(
    ['admin', 'participant', participantId],
    `/admin/participants/${participantId}`,
  );

  const [name, setName] = useState('');
  const [pseudonym, setPseudonym] = useState('');
  const [status, setStatus] = useState('');
  const [directionId, setDirectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) {return;}
    setName(q.data.name);
    setPseudonym(q.data.pseudonym ?? '');
    setStatus(q.data.status);
    setDirectionId(q.data.directionId ?? '');
    setErr(null);
    setOk(null);
  }, [q.data]);

  const dirty = useMemo(() => {
    if (!q.data) {return false;}
    return (
      name !== q.data.name ||
      (pseudonym || null) !== q.data.pseudonym ||
      status !== q.data.status ||
      (directionId || null) !== q.data.directionId
    );
  }, [q.data, name, pseudonym, status, directionId]);

  const onSave = async (): Promise<void> => {
    if (!q.data) {return;}
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const patch: Record<string, unknown> = {};
      if (name !== q.data.name) {patch['name'] = name.trim();}
      if ((pseudonym || null) !== q.data.pseudonym) {patch['pseudonym'] = pseudonym || null;}
      if (status !== q.data.status) {patch['status'] = status;}
      if ((directionId || null) !== q.data.directionId) {
        if (directionId) {patch['direction_id'] = directionId;}
      }
      await apiPatch(`/admin/participants/${participantId}`, patch);
      setOk('Сохранено');
      onSaved();
    } catch (e) {
      const err = e as { message?: string };
      setErr(err.message ?? 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  // Dev-вход под тестовым ником: сохраняем свою сессию, получаем токен
  // участника и перезагружаем приложение от его имени.
  const [devBusy, setDevBusy] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  const impersonate = async (): Promise<void> => {
    setDevBusy(true);
    setDevError(null);
    try {
      const res = await apiPost<{ access_token: string; refresh_token: string }>(
        `/dev/impersonate/${participantId}`,
      );
      saveDevReturn();
      setTokens({
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      window.location.href = '/';
    } catch (e) {
      const err = e as { message?: string };
      setDevError(err.message ?? 'Не удалось войти под тестовым ником');
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <aside style={styles.panel}>
      <div style={styles.panelHeader}>
        <h2 style={styles.panelTitle}>Карточка участника</h2>
        <button type="button" onClick={onClose} style={styles.panelClose} aria-label="Закрыть">×</button>
      </div>

      {q.isLoading ? (
        <Spinner label="Загружаем…" />
      ) : q.isError || !q.data ? (
        <p style={styles.error}>Не удалось загрузить</p>
      ) : (
        <div style={styles.panelBody}>
          <div style={styles.metaBlock}>
            <div style={styles.kv}>
              <span style={styles.kvKey}>External ID:</span>
              <code style={styles.code}>{q.data.externalId}</code>
            </div>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Профиль:</span>
              <span>{riskLabel(q.data.profileRisk)}</span>
            </div>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Вошёл:</span>
              <span>{new Date(q.data.enteredAt).toLocaleString('ru-RU')}</span>
            </div>
            <div style={styles.kv}>
              <span style={styles.kvKey}>Welcome pack:</span>
              <Badge tone={q.data.welcomePackGiven ? 'success' : 'default'}>
                {q.data.welcomePackGiven ? 'выдан' : 'не выдан'}
              </Badge>
            </div>
            {q.data.isFirstArchitect && (
              <div style={styles.kv}><Badge tone="master">FIRST_ARCHITECT</Badge></div>
            )}
          </div>

          {q.data.isFirstArchitect && (
            <p style={styles.warning}>
              Первого Архитектора нельзя изменять через admin-панель.
              Используйте /me/profile.
            </p>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Имя</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={q.data.isFirstArchitect || busy}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Псевдоним</label>
            <input
              type="text"
              value={pseudonym}
              onChange={(e) => setPseudonym(e.target.value)}
              disabled={q.data.isFirstArchitect || busy}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Статус</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={q.data.isFirstArchitect || busy}
              style={styles.select}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Направление</label>
            <select
              value={directionId}
              onChange={(e) => setDirectionId(e.target.value)}
              disabled={q.data.isFirstArchitect || busy}
              style={styles.select}
            >
              <option value="">— не назначено —</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>№{d.number} — {d.name}</option>
              ))}
            </select>
          </div>

          {err && <p style={styles.error}>{err}</p>}
          {ok && <p style={styles.success}>{ok}</p>}

          <div style={styles.panelActions}>
            <Button
              variant="primary"
              onClick={onSave}
              disabled={!dirty || busy || q.data.isFirstArchitect}
            >
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          </div>

          {/* Dev-вход под тестовым ником: проверить продукт глазами участника.
              В production кнопки нет (import.meta.env.DEV), а маршруты /dev/*
              сервер не регистрирует. */}
          {import.meta.env.DEV && (
            <div style={styles.devBlock}>
              <div style={styles.devHint}>
                Тестовый вход: сессия переключится на этого участника.
                Вернуться можно кнопкой «← Вернуться» в шапке.
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={devBusy}
                onClick={() => void impersonate()}
              >
                Войти как {q.data.externalId}
              </Button>
              {devError && <div style={styles.error}>{devError}</div>}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── Main page ───────────────────────────────────────────────────

export function ParticipantsPage(): ReactElement {
  const [params, setParams] = useSearchParams();

  const search       = params.get('search') ?? '';
  const status       = params.get('status') ?? '';
  const directionId  = params.get('direction_id') ?? '';
  const page         = Number(params.get('page') ?? '1') || 1;
  const selectedId   = params.get('selected');

  const update = (patch: Partial<{
    search: string; status: string; directionId: string; page: number; selected: string | null;
  }>): void => {
    const next = new URLSearchParams(params);

    if (patch.search !== undefined) {
      if (patch.search) {
        next.set('search', patch.search);
      } else {
        next.delete('search');
      }
    }
    if (patch.status !== undefined) {
      if (patch.status) {
        next.set('status', patch.status);
      } else {
        next.delete('status');
      }
    }
    if (patch.directionId !== undefined) {
      if (patch.directionId) {
        next.set('direction_id', patch.directionId);
      } else {
        next.delete('direction_id');
      }
    }
    if (patch.page !== undefined) {
      if (patch.page > 1) {
        next.set('page', String(patch.page));
      } else {
        next.delete('page');
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

  const qs = new URLSearchParams();
  if (search) {qs.set('search', search);}
  if (status) {qs.set('status', status);}
  if (directionId) {qs.set('direction_id', directionId);}
  qs.set('page', String(page));
  qs.set('per_page', '50');

  const listQ = useApiQuery<ListEnvelope<ParticipantRow>>(
    ['admin', 'participants', search, status, directionId, page],
    `/admin/participants?${qs.toString()}`,
  );

  const dirQ = useApiQuery<{ data: DirectionBrief[] }>(
    ['directions', 'list'],
    '/directions',
  );

  const directions = dirQ.data?.data ?? [];

  const columns: Column<ParticipantRow>[] = [
    {
      key: 'externalId',
      title: 'ID',
      render: (r) => <code style={styles.code}>{r.externalId}</code>,
    },
    { key: 'name', title: 'Имя' },
    {
      key: 'pseudonym',
      title: 'Псевдоним',
      render: (r) => r.pseudonym ?? '—',
    },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>,
    },
    {
      key: 'directionName',
      title: 'Направление',
      render: (r) =>
        r.directionName ? `№${r.directionNumber} — ${r.directionName}` : '—',
    },
    {
      key: 'enteredAt',
      title: 'Вошёл',
      render: (r) => new Date(r.enteredAt).toLocaleDateString('ru-RU'),
    },
  ];

  const total = listQ.data?.meta.total ?? 0;
  const perPage = listQ.data?.meta.per_page ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div style={styles.page}>
      <div style={styles.pageHead}>
        <h1 style={styles.h1}>Участники</h1>
        <span style={styles.totalLabel}>Всего: {total}</span>
      </div>

      <FilterBar
        directions={directions}
        search={search}
        status={status}
        directionId={directionId}
        onChange={update}
      />

      <div style={styles.body}>
        <div style={styles.listCol}>
          {listQ.isLoading ? (
            <Spinner label="Загружаем участников…" />
          ) : listQ.isError || !listQ.data ? (
            <Card title="Ошибка"><p style={styles.error}>Не удалось загрузить список</p></Card>
          ) : (
            <>
              {/* Список прокручивается отдельно от карточки участника:
                  иначе при сотне строк нижние строки и пагинация недоступны. */}
              <div style={styles.listScroll}>
                <Table<ParticipantRow>
                  data={listQ.data.data}
                  columns={columns}
                  getRowId={(r) => r.id}
                  onRowClick={(r) => update({ selected: r.id })}
                  emptyMessage="Участников нет"
                />
              </div>
              {totalPages > 1 && (
                <div style={styles.pager}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => update({ page: page - 1 })}
                  >
                    ← Назад
                  </Button>
                  <span style={styles.pagerLabel}>{page} / {totalPages}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => update({ page: page + 1 })}
                  >
                    Вперёд →
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {selectedId && (
          <ParticipantPanel
            participantId={selectedId}
            directions={directions}
            onClose={() => update({ selected: null })}
            onSaved={() => {void listQ.refetch();}}
          />
        )}
      </div>
    </div>
  );
}

export default ParticipantsPage;

// ─── Styles ──────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, minHeight: '100%' } as const,
  pageHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0 } as const,
  totalLabel: { color: colors.textMuted, fontSize: fontSize.sm } as const,

  filters: {
    display: 'flex',
    gap: spacing.sm,
    flexWrap: 'wrap',
    alignItems: 'center',
  } as const,
  input: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 240,
    flex: 1,
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
  listScroll: { flex: 1, minHeight: 0, overflowY: 'auto' as const, paddingRight: 4 } as const,
  listCol: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  } as const,

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
  panelTitle: { fontSize: fontSize.md, fontWeight: 600, margin: 0 } as const,
  panelClose: {
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
  } as const,
  panelBody: { padding: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm, overflowY: 'auto' } as const,
  devBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTop: `1px dashed `,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  } as const,
  devHint: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 1.5 } as const,
  panelActions: { display: 'flex', gap: spacing.sm, marginTop: spacing.sm } as const,

  metaBlock: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: spacing.sm } as const,
  kv: { display: 'flex', gap: spacing.sm, alignItems: 'baseline', fontSize: fontSize.sm } as const,
  kvKey: { color: colors.textMuted, minWidth: 100 } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs, color: colors.text } as const,

  field: { display: 'flex', flexDirection: 'column', gap: 4 } as const,
  label: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 } as const,

  pager: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  } as const,
  pagerLabel: { color: colors.textMuted, fontSize: fontSize.sm } as const,

  error: { color: colors.danger, fontSize: fontSize.sm } as const,
  warning: { color: colors.warning, fontSize: fontSize.sm } as const,
  success: { color: colors.success, fontSize: fontSize.sm } as const,
};