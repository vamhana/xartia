// F.4.02.01 — Страница Паспорт
// Данные из GET /me/passport: ID, направление, профессия, роли, статус,
// дата входа, гео, контакты. Кнопка «Обновить» + copy ID.

import { useState, type ReactElement } from 'react';

import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, spacing, fontSize, radius } from '../theme';
import type { PassportFull } from '../types';

// -------- Утилиты --------

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = d.getUTCFullYear();
  return `${dd}.${mm}.${yy}`;
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'master': return 'master';
    case 'full': return 'success';
    case 'compatible': return 'success';
    case 'conditionally_compatible': return 'warning';
    case 'associated': return 'info';
    case 'paused': return 'warning';
    case 'outside_trust_network': return 'danger';
    case 'excluded': return 'danger';
    default: return 'default';
  }
}

const STATUS_LABEL: Record<string, string> = {
  compatible: 'Совместим',
  conditionally_compatible: 'Условно совместим',
  associated: 'Ассоциирован',
  full: 'Полный',
  paused: 'На паузе',
  outside_trust_network: 'Вне сети доверия',
  master: 'Мастер',
  integrator: 'Интегратор',
  pioneer: 'Пионер',
  excluded: 'Отчуждён',
};

const ROLE_LABEL: Record<string, string> = {
  FIRST_ARCHITECT: 'Первый Архитектор',
  COUNCIL_MEMBER: 'Совет направления',
  OTC: 'ОТК',
  KEEPER: 'Хранитель',
  LIAISON: 'Связной',
  BALANCER: 'Балансировщик',
  VERIFIER: 'Верификатор',
  PSY: 'Психоэколог',
};

// -------- Компонент --------

export function PassportPage(): ReactElement {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useApiQuery<PassportFull>(['passport', 'me'], '/me/passport');

  const [copied, setCopied] = useState(false);

  const onCopyId = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (isLoading) {return <Spinner label="Загрузка паспорта…" />;}
  if (isError) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>
          Не удалось загрузить паспорт: {error?.message ?? 'неизвестно'}
        </div>
      </Card>
    );
  }
  if (!data) {return <Spinner />;}

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>Паспорт участника</h1>
        <Button variant="secondary" onClick={() => void refetch()} loading={isFetching}>
          Обновить
        </Button>
      </div>

      <Card
        title={data.name}
        subtitle={data.pseudonym ? `Псевдоним: ${data.pseudonym}` : undefined}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onCopyId(data.externalId)}
          >
            {copied ? '✓ Скопировано' : 'Копировать ID'}
          </Button>
        }
      >
        <div style={styles.grid}>
          <Field label="Внешний ID">
            <code style={styles.code}>{data.externalId}</code>
          </Field>
          <Field label="Статус">
            <Badge tone={statusTone(data.status)}>
              {STATUS_LABEL[data.status] ?? data.status}
            </Badge>
          </Field>
          <Field label="Направление">
            {data.direction
              ? `#${data.direction.number} — ${data.direction.name}`
              : '—'}
          </Field>
          <Field label="Профессия">
            {data.profession?.name ?? '—'}
          </Field>
          <Field label="Дата входа">{formatDate(data.enteredAt)}</Field>
          <Field label="Геолокация">
            {data.geoEnabled
              ? data.geolocation
                ? `${data.geolocation.lat.toFixed(3)}, ${data.geolocation.lon.toFixed(3)}`
                : 'Включена'
              : 'Выключена'}
          </Field>
          <Field label="Наставник">
            {data.mentorExternalId ?? '—'}
          </Field>
          <Field label="Приветственный пакет">
            {data.welcomePackGiven ? 'Получен' : 'Не получен'}
          </Field>
        </div>
      </Card>

      <Card title="Роли" subtitle={`${data.roles.length} активных`}>
        {data.roles.length === 0 ? (
          <div style={styles.muted}>Нет активных ролей</div>
        ) : (
          <div style={styles.roles}>
            {data.roles.map((r, i) => (
              <div key={i} style={styles.roleChip}>
                <Badge tone={r.name === 'FIRST_ARCHITECT' ? 'master' : 'info'}>
                  {ROLE_LABEL[r.name] ?? r.name}
                </Badge>
                {r.validTo && (
                  <span style={styles.roleExpiry}>до {formatDate(r.validTo)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Контакты">
        <div style={styles.grid}>
          <Field label="Телефон">
            <code style={styles.code}>{data.phone}</code>
          </Field>
          <Field label="Мессенджеры">
            {Object.entries(data.messengers ?? {}).length === 0
              ? '—'
              : Object.entries(data.messengers).map(([k, v]) => (
                  <div key={k} style={styles.messenger}>
                    <span style={styles.muted}>{k}:</span> <code style={styles.code}>{v}</code>
                  </div>
                ))}
          </Field>
        </div>
      </Card>

      <div style={styles.footer}>
        <span style={styles.muted}>
          ID в системе: <code style={styles.code}>{data.id}</code>
        </span>
      </div>
    </div>
  );
}

// -------- Field --------

function Field({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{children}</div>
    </div>
  );
}

// -------- Стили --------

const styles = {
  page: { maxWidth: 900 } as const,
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: spacing.md,
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
    fontFamily: 'ui-monospace, "Cascadia Code", monospace',
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: radius.sm,
    fontSize: fontSize.xs,
  } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  roles: { display: 'flex', flexWrap: 'wrap' as const, gap: spacing.sm } as const,
  roleChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as const,
  roleExpiry: { fontSize: fontSize.xs, color: colors.textDim } as const,
  messenger: { display: 'flex', gap: 6, alignItems: 'center' } as const,
  footer: { marginTop: spacing.md, paddingTop: spacing.md } as const,
};