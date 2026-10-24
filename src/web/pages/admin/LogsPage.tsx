// F.4.04.06 — Admin logs.
// Логи аудита в человекочитаемом виде: кто (имя), что (локализованный action),
// над чем (entity с ссылкой), когда (rel + abs), откуда (IP), почему (reason).
//
// Источник: GET /admin/logs (A.1.35.01 → C.0.35.02.listLogsRich).
// Экспорт: GET /admin/logs/export (S.0.01.05).

import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { apiGet, type ApiError } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
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

interface AdminLogRow {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorType: 'participant' | 'ai' | 'system';
  actorName: string | null;
  actorExternalId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  entityExternalId: string | null;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
}

interface ExportResult {
  key: string;
  url: string;
  format: 'csv' | 'json';
  rows: number;
  bytes: number;
}

interface ListEnvelope<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number };
  audit_id: string;
}

// ─────────────────────────────────────────────────────────────────
// Localization maps
// ─────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  // Auth
  'auth.register':            'Регистрация',
  'auth.login':               'Вход в систему',
  'auth.login.failed':        'Неудачный вход',
  'auth.logout':              'Выход',
  'auth.recover.request':     'Заявка на восстановление',
  'auth.recover.approve':     'Одобрено восстановление',
  'auth.recover.reject':      'Отклонено восстановление',
  'auth.recover.used':        'Пароль восстановлен',
  // Participants
  'participants.create':              'Создан участник',
  'participants.update_profile':      'Изменён профиль',
  'participants.welcome_pack':        'Выдан приветственный пакет',
  // Mandates
  'mandates.create':          'Выдан мандат',
  'mandates.rotate':          'Ротация мандата',
  'mandates.revoke':          'Отзыв мандата',
  'delegations.create':       'Делегирование',
  'delegations.revoke':       'Отзыв делегирования',
  // RBAC
  'rbac.assign_role':         'Назначена роль',
  'rbac.revoke_role':         'Отозвана роль',
  // Regimes
  'regimes.activate':                 'Активация режима',
  'regimes.deactivate':               'Деактивация режима',
  'regimes.audit':                    'Аудит режима',
  'regimes.mobilization_start':       'Начало мобилизации',
  'regimes.mobilization_confirm':     'Подтверждение мобилизации',
  'regimes.mobilization_refuse':      'Отказ от мобилизации',
  // Admin
  'admin.bootstrap_architect':        'Bootstrap Архитектора',
  'admin.invalidate_caches':          'Инвалидация кэшей',
  'admin.seed':                       'Seed справочников',
  'admin.participants.update':        'Изменён участник (admin)',
};

const ENTITY_LABEL: Record<string, string> = {
  participant:          'Участник',
  mandate:              'Мандат',
  delegation:           'Делегирование',
  regime:               'Режим',
  crisis_mobilization:  'Мобилизация',
  recovery_request:     'Recovery-заявка',
  registration_request: 'Заявка на регистрацию',
  system:               'Система',
};

const ENTITY_ROUTE: Record<string, string> = {
  participant:      '/admin/participants',
  mandate:          '/admin/mandates',
  recovery_request: '/admin/recovery',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function entityLabel(type: string): string {
  return ENTITY_LABEL[type] ?? type;
}

// ─────────────────────────────────────────────────────────────────
// Time formatting
// ─────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) {return 'только что';}
  const s = Math.floor(ms / 1000);
  if (s < 3600) {return `${Math.floor(s / 60)} мин назад`;}
  const m = Math.floor(s / 60);
  if (m < 1440) {return `${Math.floor(m / 60)} ч назад`;}
  return `${Math.floor(m / 1440)} дн назад`;
}

// ─────────────────────────────────────────────────────────────────
// Entity cell — резолвит название и делает ссылку
// ─────────────────────────────────────────────────────────────────

function EntityCell({ row }: { row: AdminLogRow }): ReactElement {
  const label = entityLabel(row.entityType);
  const route = ENTITY_ROUTE[row.entityType];
  const display = row.entityName ?? row.entityExternalId ?? row.entityId.slice(0, 8) + '…';

  if (route) {
    return (
      <Link
        to={`${route}?selected=${row.entityId}`}
        style={styles.entityLink}
        title={`Открыть ${label.toLowerCase()}`}
      >
        <span style={styles.entityType}>{label}:</span> {display}
      </Link>
    );
  }

  return (
    <span title={row.entityId}>
      <span style={styles.entityType}>{label}:</span> {display}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export function LogsPage(): ReactElement {
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportMeta, setExportMeta] = useState<{ rows: number; bytes: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (entityType) {params.set('entity_type', entityType);}
  if (actorId) {params.set('actor_id', actorId);}
  params.set('page', '1');
  params.set('per_page', '100');

  const q = useApiQuery<ListEnvelope<AdminLogRow>>(
    ['admin', 'logs', entityType, actorId],
    `/admin/logs?${params.toString()}`,
  );

  const onExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    setExportError(null);
    setExportUrl(null);
    setExportMeta(null);
    try {
      const qs = new URLSearchParams();
      qs.set('format', format);
      if (entityType) {qs.set('entity_type', entityType);}
      const result = await apiGet<ExportResult>(`/admin/logs/export?${qs.toString()}`);
      setExportUrl(result.url);
      setExportMeta({ rows: result.rows, bytes: result.bytes });
    } catch (e) {
      const err = e as ApiError;
      setExportError(err.message ?? 'Ошибка экспорта');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AdminLogRow>[] = [
    {
      key: 'createdAt',
      title: 'Когда',
      render: (r) => (
        <span title={formatDateTime(r.createdAt)}>
          {formatRelative(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'actorName',
      title: 'Кто',
      render: (r) => {
        if (r.actorType === 'system') {
          return <span style={styles.muted}>Система</span>;
        }
        if (r.actorType === 'ai') {
          return <Badge tone="info">AI</Badge>;
        }
        if (r.actorName) {
          return (
            <Link
              to={`/admin/participants?selected=${r.actorId}`}
              style={styles.entityLink}
              title={r.actorId ?? ''}
            >
              {r.actorName}
              {r.actorExternalId && (
                <span style={styles.muted}> · {r.actorExternalId}</span>
              )}
            </Link>
          );
        }
        return <code style={styles.code}>{r.actorId?.slice(0, 8) ?? '—'}…</code>;
      },
    },
    {
      key: 'action',
      title: 'Действие',
      render: (r) => <span>{actionLabel(r.action)}</span>,
    },
    {
      key: 'entityId',
      title: 'Над чем',
      render: (r) => <EntityCell row={r} />,
    },
    {
      key: 'ip',
      title: 'IP',
      render: (r) => (r.ip ? <code style={styles.code}>{r.ip}</code> : '—'),
    },
    {
      key: 'reason',
      title: 'Причина',
      render: (r) => (r.reason ? <span>{r.reason}</span> : '—'),
    },
  ];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Логи</h1>
      </header>

      <Card
        title="Логи аудита"
        subtitle={`Всего за 24ч: ${q.data?.meta.total ?? 0}`}
        actions={
          <div style={styles.actionsRow}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onExport('csv')}
              disabled={exporting}
            >
              CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onExport('json')}
              disabled={exporting}
            >
              JSON
            </Button>
          </div>
        }
      >
        <div style={styles.filters}>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            style={styles.select}
          >
            <option value="">Все сущности</option>
            <option value="participant">Участник</option>
            <option value="mandate">Мандат</option>
            <option value="delegation">Делегирование</option>
            <option value="regime">Режим</option>
            <option value="crisis_mobilization">Мобилизация</option>
            <option value="recovery_request">Recovery-заявка</option>
            <option value="registration_request">Заявка на регистрацию</option>
            <option value="system">Система</option>
          </select>

          <div style={styles.pickerWrap}>
            <ParticipantPicker
              value={actorId}
              onChange={setActorId}
              placeholder="Фильтр по автору действия"
            />
          </div>

          {(entityType || actorId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {setEntityType(''); setActorId('');}}
            >
              Сбросить
            </Button>
          )}
        </div>

        {exportError && <p style={styles.error}>{exportError}</p>}
        {exportUrl && exportMeta && (
          <p style={styles.success}>
            Экспорт готов: {exportMeta.rows} строк, {Math.round(exportMeta.bytes / 1024)} КБ.{' '}
            <a href={exportUrl} target="_blank" rel="noreferrer" style={styles.link}>
              скачать
            </a>
          </p>
        )}

        {q.isLoading ? (
          <Spinner label="Загружаем логи…" />
        ) : q.isError || !q.data ? (
          <p style={styles.error}>Не удалось загрузить логи.</p>
        ) : (
          <Table<AdminLogRow>
            data={q.data.data}
            columns={columns}
            getRowId={(r) => r.id}
            emptyMessage="Записей нет за последние 24 часа"
          />
        )}
      </Card>
    </div>
  );
}

export default LogsPage;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: spacing.md, minHeight: '100%' } as const,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text } as const,

  filters: {
    display: 'flex',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
    alignItems: 'center',
  } as const,
  select: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    minWidth: 220,
  } as const,
  pickerWrap: { minWidth: 260, flex: 1 } as const,

  actionsRow: { display: 'flex', gap: 6, flexWrap: 'wrap' } as const,
  entityLink: {
    color: colors.primary,
    textDecoration: 'none',
    fontSize: fontSize.sm,
  } as const,
  entityType: { color: colors.textMuted } as const,
  code: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.xs, color: colors.textMuted } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,

  error: { color: colors.danger, fontSize: fontSize.sm } as const,
  success: { color: colors.success, fontSize: fontSize.sm } as const,
  link: { color: colors.primary, textDecoration: 'underline' } as const,
};