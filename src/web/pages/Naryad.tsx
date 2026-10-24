// F.4.02.32 — Наряд ячейки.
//
// Наряд приходит на ячейку (5 человек), координатор распределяет задачи по
// людям. Вышестоящий координатор распределяет по ячейкам — тогда наряд
// составляется в каждой ячейке из её задач.
//
// Экран отвечает на два вопроса: «что в наряде на сегодня» и «кто это делает».

import { useMemo, useState, type ReactElement } from 'react';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { colors, fontSize, radius, spacing } from '../theme';

interface Cell { id: string; number: string; level: number; directionId: string | null }
interface CellMember { participantId: string }
interface PlanTask {
  taskId: string;
  externalId: string;
  description: string;
  status: string;
  assignedTo: string | null;
  assignedName: string | null;
}
interface Candidate { id: string; externalId: string; description: string; status: string }
interface Participant { id: string; name: string; externalId: string }

const STATUS_LABEL: Record<string, string> = {
  created: 'Создана',
  assigned: 'Назначена',
  in_progress: 'В работе',
  submitted: 'На проверке',
  accepted: 'Принята',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NaryadPage(): ReactElement {
  const [cellId, setCellId] = useState('');
  const date = today();

  const cellsQ = useApiQuery<{ data: Cell[] }>(['cells', 'naryad'], '/cells');
  const cells = cellsQ.data?.data ?? [];
  const activeCell = cellId || cells[0]?.id || '';

  const planQ = useApiQuery<{ planId: string | null; tasks: PlanTask[] }>(
    ['cell-plan', activeCell, date],
    `/cells/${activeCell}/daily-plan?date=${date}`,
    { enabled: !!activeCell },
  );
  const candidatesQ = useApiQuery<{ data: Candidate[] }>(
    ['cell-candidates', activeCell],
    `/cells/${activeCell}/daily-plan/candidates`,
    { enabled: !!activeCell },
  );
  const membersQ = useApiQuery<{ data: CellMember[] }>(
    ['cell-members', activeCell],
    `/cells/${activeCell}/members`,
    { enabled: !!activeCell },
  );
  const peopleQ = useApiQuery<{ data: Participant[] }>(
    ['participants', 'naryad'],
    '/participants?per_page=100',
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of peopleQ.data?.data ?? []) {map.set(p.id, p.name);}
    return map;
  }, [peopleQ.data]);

  const memberIds = (membersQ.data?.data ?? []).map((m) => m.participantId);
  const planTasks = planQ.data?.tasks ?? [];

  const reload = (): void => {
    setVersion((v) => v + 1);
    void planQ.refetch();
    void candidatesQ.refetch();
  };

  const addToPlan = async (taskId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/cells/${activeCell}/daily-plan`, {
        date,
        task_ids: [...planTasks.map((t) => t.taskId), taskId],
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const assign = async (taskId: string, participantId: string): Promise<void> => {
    if (!participantId) {return;}
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/cells/${activeCell}/daily-plan/${taskId}/assign`, {
        date,
        participant_id: participantId,
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  if (cellsQ.isLoading) {return <Spinner label="Загружаем ячейки…" />;}

  return (
    <div style={styles.page}>
      <Card
        title="Наряд ячейки"
        subtitle="Координатор распределяет задачи наряда по людям"
      >
        {cells.length === 0 ? (
          <p style={styles.muted}>
            Ячеек нет. Сначала соберите ячейку (раздел «Ячейки») — наряд
            приходит на ячейку, а не на человека.
          </p>
        ) : (
          <>
            <div style={styles.controls}>
              <label style={styles.label}>
                Ячейка
                <select
                  style={styles.select}
                  value={activeCell}
                  onChange={(e) => setCellId(e.target.value)}
                >
                  {cells.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.level}·{c.number}
                    </option>
                  ))}
                </select>
              </label>
              <div style={styles.meta}>
                участников: {memberIds.length} · задач в наряде: {planTasks.length}
                <span style={styles.version} data-v={version} />
              </div>
            </div>

            {planQ.isLoading ? (
              <Spinner />
            ) : planTasks.length === 0 ? (
              <p style={styles.muted}>
                Наряд на {date} не составлен. Добавьте задачи из списка ниже.
              </p>
            ) : (
              <div style={styles.rows}>
                {planTasks.map((t) => (
                  <div key={t.taskId} style={styles.row}>
                    <span style={styles.extId}>{t.externalId}</span>
                    <span style={styles.desc}>{t.description}</span>
                    <Badge tone={t.status === 'accepted' ? 'success' : 'info'}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                    <select
                      style={styles.select}
                      value={t.assignedTo ?? ''}
                      onChange={(e) => void assign(t.taskId, e.target.value)}
                      disabled={busy}
                    >
                      <option value="">— назначить —</option>
                      {memberIds.map((id) => (
                        <option key={id} value={id}>
                          {nameById.get(id) ?? id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                    <span style={styles.assignee}>
                      {t.assignedName ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {error && <p style={styles.error}>{error}</p>}
          </>
        )}
      </Card>

      {cells.length > 0 && (
        <Card title="Задачи направления" subtitle="Что можно добавить в наряд">
          {candidatesQ.isLoading ? (
            <Spinner />
          ) : (candidatesQ.data?.data ?? []).length === 0 ? (
            <p style={styles.muted}>Свободных задач нет.</p>
          ) : (
            <div style={styles.rows}>
              {(candidatesQ.data?.data ?? []).slice(0, 50).map((c) => {
                const already = planTasks.some((t) => t.taskId === c.id);
                return (
                  <div key={c.id} style={styles.row}>
                    <span style={styles.extId}>{c.externalId}</span>
                    <span style={styles.desc}>{c.description}</span>
                    <Badge tone="default">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || already}
                      onClick={() => void addToPlan(c.id)}
                    >
                      {already ? 'в наряде' : 'В наряд'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  label: { display: 'flex', alignItems: 'center', gap: 8, fontSize: fontSize.sm, color: colors.textMuted },
  select: {
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  },
  meta: { color: colors.textMuted, fontSize: fontSize.sm },
  version: { display: 'none' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
  rows: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '8px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  extId: { color: colors.textDim, fontSize: fontSize.xs, width: 130 },
  desc: { flex: 1, fontSize: fontSize.sm },
  assignee: { width: 140, color: colors.textMuted, fontSize: fontSize.xs },
};
