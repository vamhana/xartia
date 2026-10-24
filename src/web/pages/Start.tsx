// F.4.02.28 — Страница «Первый день» (онбординг).
//
// Зачем: новый участник после приёма не должен видеть пустую панель.
// Здесь ровно одно действие — взять welcome-задачу и начать. Задача приходит
// из обычного домена задач (её создаёт API при приёме заявки, C.0.02.03),
// поэтому страница не заводит собственных сущностей.
//
// Маршрут /start — точка входа после логина. Если welcome-задачи нет
// (участник уже в работе), страница молча уводит на /workspace.

import { useState, type ReactElement } from 'react';
import { Navigate, Link } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery, useApiMutation } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';
import type { PassportFull, Task } from '../types';

const WELCOME_PREFIX = 'Первый день';

export function StartPage(): ReactElement {
  const passport = useApiQuery<PassportFull>(['passport', 'me'], '/me/passport');
  const tasks = useApiQuery<{ data: Task[] }>(['tasks', 'my'], '/tasks/my');
  const take = useApiMutation<Task, { id: string }>(
    (v) => `/tasks/${v.id}/take`,
    'POST',
    { invalidateKeys: [['tasks', 'my']] },
  );
  const [taken, setTaken] = useState(false);

  if (passport.isLoading || tasks.isLoading) {
    return <Spinner label="Готовим первый день…" />;
  }

  const welcome = (tasks.data?.data ?? []).find((t) =>
    t.description.startsWith(WELCOME_PREFIX),
  );

  // Участник уже в работе — онбординг не нужен.
  if (!welcome) {
    return <Navigate to="/workspace" replace />;
  }

  const isAssigned = welcome.status === 'assigned';
  const isInProgress = welcome.status === 'in_progress';
  const roles = passport.data?.roles ?? [];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Первый день</h1>
          <p style={styles.subtitle}>
            {passport.data?.name ?? 'Участник'} · {passport.data?.externalId ?? '—'} ·{' '}
            {passport.data?.direction
              ? `#${passport.data.direction.number} ${passport.data.direction.name}`
              : 'направление не задано'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void tasks.refetch()}>
          Обновить
        </Button>
      </header>

      <Card
        title="С чего начать"
        subtitle="Четыре шага, дальше — обычная работа"
        actions={
          <Badge tone={isInProgress || taken ? 'success' : 'info'}>
            {isInProgress || taken ? 'в работе' : 'назначено'}
          </Badge>
        }
      >
        <pre style={styles.taskText}>{welcome.description}</pre>

        <div style={styles.actions}>
          {isAssigned && !taken ? (
            <Button
              loading={take.isPending}
              onClick={() => {
                take.mutate(
                  { id: welcome.id },
                  { onSuccess: () => setTaken(true) },
                );
              }}
            >
              Взять задачу
            </Button>
          ) : (
            <Link to="/tasks" style={styles.linkButton}>
              Открыть мои задачи →
            </Link>
          )}
          <span style={styles.muted}>
            Задача <code style={styles.code}>{welcome.externalId}</code>
          </span>
        </div>

        {take.isError && (
          <div style={styles.error}>Не удалось взять задачу: {take.error.message}</div>
        )}
      </Card>

      <Card title="Кто я в системе" subtitle="Роль выдаётся мандатом и может меняться">
        <div style={styles.grid}>
          <Field label="Внешний ID">
            <code style={styles.code}>{passport.data?.externalId ?? '—'}</code>
          </Field>
          <Field label="Статус">{passport.data?.status ?? '—'}</Field>
          <Field label="Наставник">{passport.data?.mentorExternalId ?? 'не назначен'}</Field>
          <Field label="Роли">
            {roles.length === 0 ? (
              'нет активных'
            ) : (
              <div style={styles.roles}>
                {roles.map((r, i) => (
                  <Badge key={i} tone="info">{r.name}</Badge>
                ))}
              </div>
            )}
          </Field>
        </div>
      </Card>

      <Card title="Где что лежит">
        <ul style={styles.links}>
          <li><Link to="/tasks" style={styles.link}>Задачи</Link> — что делать прямо сейчас</li>
          <li><Link to="/chat" style={styles.link}>Чат</Link> — задать вопрос и представиться</li>
          <li><Link to="/passport" style={styles.link}>Паспорт</Link> — свой ID, направление, роли</li>
          <li><Link to="/workspace" style={styles.link}>Рабочая панель</Link> — виджеты и метрики</li>
        </ul>
        <p style={styles.muted}>
          Хартия: <code style={styles.code}>docs/charter-specs/xartia.md</code>.
          Правило первое: ошибка при соблюдении процедуры — не повод для наказания.
        </p>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{children}</div>
    </div>
  );
}

export default StartPage;

const styles = {
  page: { maxWidth: 900, display: 'flex', flexDirection: 'column', gap: spacing.md } as const,
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  subtitle: { margin: '6px 0 0', color: colors.textMuted, fontSize: fontSize.sm } as const,
  taskText: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    fontSize: fontSize.sm,
    lineHeight: 1.7,
    color: colors.text,
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    padding: spacing.md,
    margin: 0,
  } as const,
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  } as const,
  linkButton: {
    color: colors.primary,
    fontSize: fontSize.sm,
    textDecoration: 'none',
    fontWeight: 500,
  } as const,
  link: { color: colors.primary, textDecoration: 'none' } as const,
  links: {
    margin: 0,
    paddingLeft: 20,
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.9,
  } as const,
  error: { marginTop: spacing.sm, color: colors.danger, fontSize: fontSize.sm } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: 4,
  } as const,
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
  roles: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 } as const,
};
