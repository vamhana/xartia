// F.4.02.03 — Мои задачи + дневной план направления на сегодня.src\web\pages\Tasks.tsx

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiPost } from '../api/client';
import { TaskCard } from '../components/tasks/TaskCard';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  formatDateShort,
} from '../lib/format';
import { useUser } from '../store';
import { colors, spacing, fontSize, radius } from '../theme';
import type { Task, DailyPlan } from '../types';

const PRIORITY_ORDER: Record<Task['priority'], number> = {
  critical: 0,
  high: 1,
  standard: 2,
  background: 3,
};

function sortTasks(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER[a.priority];
  const pb = PRIORITY_ORDER[b.priority];
  if (pa !== pb) {return pa - pb;}
  const da = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
  const db = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
  return da - db;
}

export function TasksPage(): ReactElement {
  const navigate = useNavigate();
  const user = useUser();
  const directionId = user?.participant.directionId;

  const [searchParams] = useSearchParams();
  const selectedFromUrl = searchParams.get('selected');
  const planIdFromUrl = searchParams.get('plan_id');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFromUrl) {
      setHighlightedId(selectedFromUrl);
    }
  }, [selectedFromUrl]);

  const myTasksQuery = useApiQuery<{ data: Task[]; audit_id: string }>(
    ['tasks', 'my'],
    '/tasks/my',
    { refetchInterval: 30_000 },
  );

  // Задачи конкретного плана: сюда ведёт «сигнал → план → задачи».
  const planTasksQuery = useApiQuery<{ data: Task[]; meta: { total: number } }>(
    ['tasks', 'plan', planIdFromUrl ?? ''],
    `/tasks?plan_id=${planIdFromUrl ?? ''}&per_page=200`,
    { enabled: !!planIdFromUrl },
  );

  const dailyPlanQuery = useApiQuery<{ data: DailyPlan | null; audit_id: string }>(
    ['daily-plan', 'current', directionId ?? ''],
    `/daily-plans/current?direction_id=${directionId ?? ''}`,
    { enabled: !!directionId, refetchInterval: 60_000 },
  );

  const qc = useQueryClient();

  const takeMutation = useMutation<Task, Error, string>({
    mutationFn: (taskId) => apiPost<Task>(`/tasks/${taskId}/take`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks', 'my'] });
      void qc.invalidateQueries({ queryKey: ['daily-plan'] });
    },
  });



  const [actionError, setActionError] = useState<string | null>(null);

  const tasks = useMemo(() => {
    const source = planIdFromUrl
      ? (planTasksQuery.data?.data ?? [])
      : (myTasksQuery.data?.data ?? []);
    const list = [...source];
    list.sort(sortTasks);
    return list;
  }, [myTasksQuery.data, planTasksQuery.data, planIdFromUrl]);

  // Прокрутка к выделенной задаче (после загрузки списка).
  useEffect(() => {
    if (!highlightedId) {return;}
    const el = document.querySelector(`[data-task-id="${highlightedId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedId, tasks]);

  const dailyPlan = dailyPlanQuery.data?.data ?? null;

  const onAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const loading = planIdFromUrl ? planTasksQuery.isLoading : myTasksQuery.isLoading;
  if (loading) {return <Spinner label="Загрузка задач…" />;}
  if (myTasksQuery.isError) {
    return (
      <Card title="Ошибка" variant="outlined">
        <div style={{ color: colors.danger }}>{myTasksQuery.error?.message}</div>
      </Card>
    );
  }

  return (
    <div style={styles.page}>
      {dailyPlan && dailyPlan.tasks.length > 0 && (
        <DailyPlanSection plan={dailyPlan} currentUserId={user?.participant.id ?? ''} />
      )}

      <div style={styles.headerRow}>
        <h1 style={styles.h1}>
          {planIdFromUrl ? 'Задачи плана' : 'Мои задачи'}
          {tasks.length > 0 && <span style={styles.count}>({tasks.length})</span>}
        </h1>
        {planIdFromUrl && (
          <Button variant="ghost" onClick={() => navigate('/tasks')}>
            Все мои задачи
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => void (planIdFromUrl ? planTasksQuery.refetch() : myTasksQuery.refetch())}
          loading={planIdFromUrl ? planTasksQuery.isFetching : myTasksQuery.isFetching}
        >
          Обновить
        </Button>
      </div>

      {actionError && <div style={styles.actionError}>{actionError}</div>}

      {tasks.length === 0 ? (
        <Card>
          <div style={styles.empty}>Нет активных задач</div>
        </Card>
      ) : (
        <div style={styles.list}>
          {tasks.map((t) => (
            <div
              key={t.id}
              data-task-id={t.id}
              style={t.id === highlightedId ? styles.highlightWrapper : undefined}
            >
              <TaskCard
                task={t}
                variant="full"
                showActions={true}
                onTake={() => onAction(() => takeMutation.mutateAsync(t.id))}
                onSubmit={() => navigate(`/tasks/${t.id}/report`)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- Дневной план --------

function DailyPlanSection({
  plan,
  currentUserId,
}: {
  plan: DailyPlan;
  currentUserId: string;
}): ReactElement {
  return (
    <Card
      title={`Дневной план на ${formatDateShort(plan.date)}`}
      subtitle={`Направление · ${plan.tasks.length} задач · ${plan.status}`}
    >
      <div style={styles.dailyList}>
        {plan.tasks.map((t) => {
          const isMine = t.assignedTo === currentUserId;
          return (
            <div
              key={t.id}
              style={{
                ...styles.dailyItem,
                ...(isMine ? styles.dailyItemMine : {}),
              }}
            >
              <div style={styles.dailyLeft}>
                <Badge tone={PRIORITY_TONE[t.priority]}>
                  {PRIORITY_LABEL[t.priority]}
                </Badge>
                <Badge tone={TASK_STATUS_TONE[t.status]}>
                  {TASK_STATUS_LABEL[t.status]}
                </Badge>
                {isMine && <Badge tone="info">Моя</Badge>}
              </div>
              <div style={styles.dailyDesc}>{t.description}</div>
              <code style={styles.extId}>{t.externalId}</code>
            </div>
          );
        })}
      </div>
    </Card>
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
  count: {
    color: colors.textMuted,
    fontWeight: 400,
    fontSize: fontSize.lg,
    marginLeft: 8,
  } as const,
  actionError: {
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
  highlightWrapper: {
    outline: `2px solid ${colors.primary}`,
    outlineOffset: 4,
    borderRadius: radius.sm,
    transition: 'outline-color 0.25s ease',
  } as const,

  dailyList: { display: 'flex', flexDirection: 'column' as const, gap: 4 } as const,
  dailyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px 10px',
    borderRadius: radius.sm,
    background: colors.bg,
  } as const,
  dailyItemMine: {
    borderLeft: `3px solid ${colors.primary}`,
  } as const,
  dailyLeft: { display: 'flex', gap: 6, flexShrink: 0 } as const,
  dailyDesc: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.sm,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as const,

  extId: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.textDim,
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: radius.sm,
  } as const,
};