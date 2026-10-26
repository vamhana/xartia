// F.4.02.29 — Карта ячеек: готовность, ёмкость, сигналы, вопросы.
//
// Одна страница, с которой видно «муравейник»: где дефицит людей,
// какие ячейки не готовы, какие сигналы перестановки открыты и кто ждёт
// ответа наставника.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { apiGet, apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

interface CapacityRow {
  competency: string;
  needed: number;
  available: number;
  gap: number;
  avgLevel: number;
}

interface CellRow {
  id: string;
  level: number;
  number: string;
  profile: string | null;
  membersCount: number;
  status?: string;
}

interface Readiness {
  ready: boolean;
  checks: Array<{ id: string; title: string; passed: boolean; detail: string }>;
  members: number;
  requiredMembers: number;
}

interface SignalRow {
  id: string;
  level: number;
  reason: string;
  status: string;
  cellId: string | null;
  createdAt: string;
}

interface QuestionRow {
  id: string;
  question: string;
  status: string;
  createdAt: string;
  mentorId: string | null;
}

const LEVEL_LABEL: Record<number, string> = {
  0: 'ячейка',
  1: 'группа',
  2: 'дом',
};

export function CellsMapPage(): ReactElement {
  const user = useUser();
  const qc = useQueryClient();
  const directionId = user?.participant.directionId ?? '';

  const capacityQ = useApiQuery<{ rows: CapacityRow[]; totals: { needed: number; available: number; gap: number } }>(
    ['capacity', directionId],
    `/capacity?direction_id=${directionId}`,
    { enabled: Boolean(directionId) },
  );

  const cellsQ = useApiQuery<{ data: CellRow[] }>(
    ['cells', 'map', directionId],
    `/cells?direction_id=${directionId}`,
    { enabled: Boolean(directionId) },
  );

  const cells = cellsQ.data?.data ?? [];

  const readinessQ = useQuery({
    queryKey: ['cells', 'readiness', cells.map((c) => c.id).join(',')],
    queryFn: async () => {
      const result: Record<string, Readiness> = {};
      await Promise.all(cells.slice(0, 50).map(async (c) => {
        try {
          result[c.id] = await apiGet<Readiness>(`/cells/${c.id}/readiness`);
        } catch { /* пропускаем */ }
      }));
      return result;
    },
    enabled: cells.length > 0,
  });

  const signalsQ = useApiQuery<{ data: SignalRow[] }>(
    ['reassignment', 'open'],
    '/reassignment-signals?status=open',
  );
  const questionsQ = useApiQuery<{ data: QuestionRow[] }>(
    ['questions', 'open'],
    '/questions?status=open',
  );

  const raiseMutation = useMutation({
    mutationFn: (cell: CellRow) => {
      const r = readinessQ.data?.[cell.id];
      const failed = r?.checks.filter((c) => !c.passed).map((c) => c.title).join(', ') ?? 'чек-лист';
      return apiPost('/reassignment-signals', {
        level: 0,
        cell_id: cell.id,
        reason: `Ячейка ${cell.number} не готова: ${failed}`,
      });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['reassignment'] }); },
  });

  const escalateMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/reassignment-signals/${id}/escalate`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['reassignment'] }); },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/reassignment-signals/${id}/resolve`, {
      resolution: 'Решение принято на карте ячеек',
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['reassignment'] }); },
  });

  if (cellsQ.isLoading) {return <Spinner label="Загрузка карты…" />;}

  const totals = capacityQ.data?.totals;
  const topDeficit = (capacityQ.data?.rows ?? []).filter((r) => r.gap > 0).slice(0, 8);
  const signals = signalsQ.data?.data ?? [];
  const questions = questionsQ.data?.data ?? [];

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Карта ячеек</h1>

      <Card title="Ёмкость направления" subtitle="Спрос задач против наличия людей">
        {totals ? (
          <div style={styles.metrics}>
            <span>Нужно: <b>{totals.needed}</b></span>
            <span>Есть: <b>{totals.available}</b></span>
            <span style={totals.gap > 0 ? styles.gap : styles.ok}>Дефицит: <b>{totals.gap}</b></span>
          </div>
        ) : (
          <div style={styles.muted}>Нет данных о компетенциях</div>
        )}
        {topDeficit.length > 0 && (
          <div style={styles.deficitList}>
            {topDeficit.map((r) => (
              <div key={r.competency} style={styles.deficitRow}>
                <code>{r.competency}</code>
                <span>{r.needed} нужно</span>
                <span>{r.available} есть</span>
                <span style={styles.gap}>−{r.gap}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Ячейки" subtitle={`${cells.length} в направлении`}>
        {cells.length === 0 && <div style={styles.muted}>Ячеек пока нет</div>}
        {cells.map((cell) => {
          const r = readinessQ.data?.[cell.id];
          return (
            <div key={cell.id} style={styles.cellRow}>
              <div style={styles.cellMain}>
                <b>{cell.number}</b>
                <Badge tone={r?.ready ? 'success' : 'warning'}>
                  {r?.ready ? 'готова' : (cell.status ?? 'forming')}
                </Badge>
                <span style={styles.muted}>
                  {LEVEL_LABEL[cell.level] ?? `уровень ${cell.level}`}
                  {cell.profile ? ` · ${cell.profile}` : ''}
                </span>
                <span style={styles.muted}>{cell.membersCount} чел.</span>
              </div>
              <div style={styles.checks}>
                {(r?.checks ?? []).map((c) => (
                  <span key={c.id} style={c.passed ? styles.checkOk : styles.checkFail} title={c.detail}>
                    {c.passed ? '✓' : '✗'} {c.title}
                  </span>
                ))}
                {!r?.ready && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={raiseMutation.isPending}
                    onClick={() => raiseMutation.mutate(cell)}
                  >
                    Сигнал L0
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      <div style={styles.twoCols}>
        <Card title="Сигналы перестановки" subtitle={`${signals.length} открытых`}>
          {signals.length === 0 && <div style={styles.muted}>Открытых сигналов нет</div>}
          {signals.slice(0, 20).map((s) => (
            <div key={s.id} style={styles.listItem}>
              <Badge tone={s.level >= 2 ? 'danger' : 'warning'}>{`L${s.level}`}</Badge>
              <span style={styles.listText}>{s.reason}</span>
              <Button variant="ghost" size="sm" onClick={() => escalateMutation.mutate(s.id)}>
                Выше
              </Button>
              <Button variant="ghost" size="sm" onClick={() => resolveMutation.mutate(s.id)}>
                Решено
              </Button>
            </div>
          ))}
        </Card>

        <Card title="Вопросы наставнику" subtitle={`${questions.length} открытых`}>
          {questions.length === 0 && <div style={styles.muted}>Открытых вопросов нет</div>}
          {questions.slice(0, 20).map((q) => (
            <div key={q.id} style={styles.listItem}>
              <span style={styles.listText}>{q.question}</span>
              <span style={styles.muted}>{new Date(q.createdAt).toLocaleString('ru-RU')}</span>
            </div>
          ))}
          <a href="/chat" style={styles.link}>Перейти в чат →</a>
        </Card>
      </div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  h1: { margin: 0, fontSize: fontSize.xl, color: colors.text },
  metrics: { display: 'flex', gap: spacing.lg, fontSize: fontSize.sm, color: colors.text },
  gap: { color: colors.danger, fontWeight: 600 },
  ok: { color: colors.success },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  deficitList: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginTop: spacing.sm },
  deficitRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto auto',
    gap: spacing.sm,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  cellRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  cellMain: { display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' as const },
  checks: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap' as const, alignItems: 'center' },
  checkOk: { color: colors.success, fontSize: fontSize.xs },
  checkFail: { color: colors.danger, fontSize: fontSize.xs },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: spacing.md },
  listItem: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  listText: { flex: 1, color: colors.text },
  link: { color: colors.primary, fontSize: fontSize.sm, marginTop: spacing.sm, display: 'inline-block' },
  card: { borderRadius: radius.md },
};
