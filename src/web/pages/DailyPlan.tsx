// F.4.02.25 (неявный) — Дневной план направления (UI для Совета)
// Список задач направления + чекбоксы выбора + утверждение на дату.src\web\pages\DailyPlan.tsx

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { apiPost } from '../api/client';
import { TaskCard } from '../components/tasks/TaskCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { formatDateShort } from '../lib/format';
import { useUser } from '../store';
import { colors, spacing, fontSize, radius } from '../theme';
import type { Task, DailyPlan } from '../types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function DailyPlanPage(): ReactElement {
  const user = useUser();
  const directionId = user?.participant.directionId ?? '';

  const [date, setDate] = useState<string>(tomorrowIso());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Задачи направления — только активные (assigned / in_progress).
  const tasksQuery = useApiQuery<{ data: Task[]; audit_id: string }>(
    ['tasks', 'direction', directionId],
    `/tasks?direction_id=${directionId}&per_page=200`,
    { enabled: !!directionId },
  );

  // Существующий план на выбранную дату.
  const planQuery = useApiQuery<{ data: DailyPlan[]; audit_id: string }>(
    ['daily-plan', 'by-date', directionId, date],
    `/daily-plans?direction_id=${directionId}&date=${date}`,
    { enabled: !!directionId && !!date },
  );

  const qc = useQueryClient();
  const saveMutation = useMutation<DailyPlan, Error, { date: string; taskIds: string[] }>({
    mutationFn: (vars) =>
      apiPost<DailyPlan>('/daily-plans', {
        direction_id: directionId,
        date: vars.date,
        task_ids: vars.taskIds,
      }),
    onSuccess: () => {
      setMsg('Дневной план сохранён');
      setTimeout(() => setMsg(null), 2000);
      void qc.invalidateQueries({ queryKey: ['daily-plan'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => setErr(e.message),
  });

  // Предзаполнение из существующего плана.
  useEffect(() => {
    const plan = planQuery.data?.data?.[0];
    if (plan) {
      setSelected(new Set(plan.tasks.map((t) => t.id)));
    } else {
      setSelected(new Set());
    }
  }, [planQuery.data]);

  const activeTasks = useMemo(() => {
    const all = tasksQuery.data?.data ?? [];
    return all.filter((t) =>
      t.status === 'assigned' || t.status === 'in_progress' || t.status === 'created',
    );
  }, [tasksQuery.data]);

  const existingPlan = planQuery.data?.data?.[0] ?? null;

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {next.delete(id);}
      else {next.add(id);}
      return next;
    });
  };

  const onSave = async (): Promise<void> => {
    setErr(null);
    setMsg(null);
    if (selected.size === 0) {
      setErr('Выберите хотя бы одну задачу');
      return;
    }
    await saveMutation.mutateAsync({ date, taskIds: Array.from(selected) });
  };

  if (tasksQuery.isLoading) {return <Spinner label="Загрузка задач направления…" />;}
  if (tasksQuery.isError) {
    return <Card title="Ошибка"><div style={{ color: colors.danger }}>{tasksQuery.error?.message}</div></Card>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>Дневной план направления</h1>
      </div>

      <Card
        title="Дата и выбор задач"
        subtitle={`Дата: ${formatDateShort(date)} · активных задач в направлении: ${activeTasks.length}`}
        actions={
          <Button
            onClick={() => void onSave()}
            loading={saveMutation.isPending}
          >
            {existingPlan ? 'Обновить план' : 'Утвердить план'}
          </Button>
        }
      >
        <div style={styles.controls}>
          <label style={styles.label}>
            Дата
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={styles.dateInput}
            />
          </label>
          <div style={styles.quickDates}>
            <Button size="sm" variant="ghost" onClick={() => setDate(todayIso())}>
              Сегодня
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDate(tomorrowIso())}>
              Завтра
            </Button>
          </div>
        </div>

        {msg && <div style={styles.success}>{msg}</div>}
        {err && <div style={styles.error}>{err}</div>}
      </Card>

      <Card title="Задачи направления" subtitle={`Выбрано: ${selected.size}`}>
        {activeTasks.length === 0 ? (
          <div style={styles.empty}>Нет активных задач для включения в план</div>
        ) : (
          <div style={styles.list}>
            {activeTasks.map((t) => {
              const isSelected = selected.has(t.id);
              return (
                <label
                  key={t.id}
                  style={{
                    ...styles.item,
                    ...(isSelected ? styles.itemSelected : {}),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(t.id)}
                    style={styles.checkbox}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TaskCard
                      task={t}
                      variant="compact"
                      showActions={false}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

const styles = {
  page: { maxWidth: 900 } as const,
  headerRow: { marginBottom: spacing.md } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  controls: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacing.md,
    flexWrap: 'wrap' as const,
  } as const,
  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  } as const,
  dateInput: {
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  } as const,
  quickDates: { display: 'flex', gap: spacing.xs } as const,
  success: {
    marginTop: spacing.sm,
    background: 'rgba(16, 185, 129, 0.1)',
    color: colors.success,
    padding: '6px 10px',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
  } as const,
  error: {
    marginTop: spacing.sm,
    background: 'rgba(239, 68, 68, 0.1)',
    color: colors.danger,
    padding: '6px 10px',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
  } as const,
  empty: {
    color: colors.textMuted,
    textAlign: 'center' as const,
    padding: 20,
    fontSize: fontSize.sm,
  } as const,
  list: { display: 'flex', flexDirection: 'column' as const, gap: 6 } as const,
  item: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: '10px 12px',
    borderRadius: radius.md,
    border: `1px solid ${colors.borderSoft}`,
    cursor: 'pointer',
  } as const,
  itemSelected: {
    background: 'rgba(59, 130, 246, 0.08)',
    border: `1px solid ${colors.primary}`,
  } as const,
  checkbox: { marginTop: 2, cursor: 'pointer' } as const,
};