// src/web/pages/Experiments.tsx
/**
 * F.4.02.22 — Панель Experiments.
 *
 * 3 таба: Протоколы / Диссидентские / Мои.
 * Эксперименты (VIII.1): до 5 лет, утверждение 75%.
 * Диссидентские (I.1.8.10): 1% подписей, отчёты 60 дней, пересмотр 2 года.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/Chart';
import { Form, FormInput, FormTextarea } from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type Tab = 'protocols' | 'dissidents' | 'my';

type ExperimentStatus =
  | 'filed' | 'approved' | 'active' | 'completed' | 'cancelled';

type DissidentStatus =
  | 'filed' | 'active' | 'suspended' | 'reviewed' | 'closed';

type DissidentResourceSource = 'deferred_flow' | 'freedom_reserve';

interface Experiment {
  id: string;
  externalId: string;
  goal: string;
  termDays: number;
  participants: string[];
  criteria: Record<string, unknown>;
  status: ExperimentStatus;
  approvedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface ExperimentResults {
  id: string;
  protocolId: string;
  successes: string[];
  failures: string[];
  stats: Record<string, unknown>;
  published: boolean;
  createdAt: string;
}

interface DissidentProject {
  id: string;
  initiatorId: string;
  description: string;
  petitionCount: number;
  requiredPercent: number;
  resourceSource: DissidentResourceSource;
  status: DissidentStatus;
  reportIntervalDays: number;
  lastReportAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface ApproveResult {
  experiment: Experiment;
  progress: {
    responded: number;
    total: number;
    percent: number;
    approvalRunId: string | null;
  };
}

// ─── Константы ───────────────────────────────────────────────────

const TAB_LABEL: Record<Tab, string> = {
  protocols: 'Протоколы',
  dissidents: 'Диссидентские',
  my: 'Мои',
};

const EXP_STATUS_LABEL: Record<ExperimentStatus, string> = {
  filed: 'Подан',
  approved: 'Утверждён',
  active: 'Активен',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

const EXP_STATUS_TONE: Record<ExperimentStatus, BadgeTone> = {
  filed: 'info',
  approved: 'info',
  active: 'success',
  completed: 'default',
  cancelled: 'danger',
};

const DISS_STATUS_LABEL: Record<DissidentStatus, string> = {
  filed: 'Подан',
  active: 'Активен',
  suspended: 'Приостановлен',
  reviewed: 'Пересмотрен',
  closed: 'Закрыт',
};

const DISS_STATUS_TONE: Record<DissidentStatus, BadgeTone> = {
  filed: 'info',
  active: 'success',
  suspended: 'warning',
  reviewed: 'default',
  closed: 'default',
};

const RESOURCE_LABEL: Record<DissidentResourceSource, string> = {
  deferred_flow: 'Отложенный Поток',
  freedom_reserve: 'Резерв свободы',
};

// ─── Схемы ───────────────────────────────────────────────────────

const createExpSchema = z.object({
  goal: z.string().min(1, 'Цель обязательна').max(5000),
  term_days: z.coerce.number().int().min(1).max(1825),
  criteria_text: z
    .string()
    .min(2, 'JSON-объект критериев')
    .default('{"criteria": "success"}'),
});

const resultsSchema = z.object({
  successes_text: z.string().default(''),
  failures_text: z.string().default(''),
  stats_text: z.string().default('{}'),
});

const createDissSchema = z.object({
  description: z.string().min(1, 'Описание обязательно').max(5000),
});

const reportDissSchema = z.object({
  content: z.string().min(1, 'Отчёт обязателен').max(10000),
});

// ─── Страница ────────────────────────────────────────────────────

export function ExperimentsPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('protocols');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Эксперименты</h1>
        <span style={styles.subtitle}>
          VIII.1 — протоколы до 5 лет, утверждение 75%.
          I.1.8.10 — диссидентские проекты.
        </span>
      </div>

      <div style={styles.tabs}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'protocols' && <ProtocolsTab />}
      {tab === 'dissidents' && <DissidentProjects />}
      {tab === 'my' && <MyExperimentsTab />}
    </div>
  );
}

// ─── Протоколы (master-detail) ──────────────────────────────────

function ProtocolsTab(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const q = useApiQuery<{ data: Experiment[] }>(
    ['experiments', 'list', filterStatus],
    `/experiments?page=1&per_page=100${filterStatus ? `&status=${filterStatus}` : ''}`,
  );

  const experiments = q.data?.data ?? [];

  return (
    <div style={styles.split}>
      <aside style={styles.list}>
        <div style={styles.filters}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(EXP_STATUS_LABEL) as ExperimentStatus[]).map((s) => (
              <option key={s} value={s}>{EXP_STATUS_LABEL[s]}</option>
            ))}
          </select>
          {rights.hasRight('experiment', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Подать протокол
            </Button>
          ) : null}
        </div>

        {q.isLoading ? (
          <Spinner />
        ) : experiments.length === 0 ? (
          <div style={styles.empty}>Протоколов нет</div>
        ) : (
          experiments.map((exp) => (
            <button
              key={exp.id}
              type="button"
              onClick={() => setSelectedId(exp.id)}
              style={{
                ...styles.listItem,
                ...(exp.id === selectedId ? styles.listItemActive : {}),
              }}
            >
              <div style={styles.listItemTop}>
                <Badge tone={EXP_STATUS_TONE[exp.status]}>
                  {EXP_STATUS_LABEL[exp.status]}
                </Badge>
                <span style={styles.mono}>{exp.externalId}</span>
              </div>
              <div style={styles.listItemDesc}>{exp.goal}</div>
              <div style={styles.listItemMeta}>
                <span style={styles.dim}>{exp.termDays} дн.</span>
                <span style={styles.dim}>
                  Участников: {exp.participants.length}
                </span>
              </div>
            </button>
          ))
        )}
      </aside>

      <section style={styles.detail}>
        {creating ? (
          <Modal onClose={() => setCreating(false)} title="Новый эксперимент">
            <Form<z.infer<typeof createExpSchema>>
              schema={createExpSchema}
              defaultValues={{
                goal: '',
                term_days: 30,
                criteria_text: '{"criteria": "success"}',
              }}
              submitLabel="Подать"
              onCancel={() => setCreating(false)}
              onSubmit={async (data) => {
                let criteria: Record<string, unknown>;
                try {
                  criteria = JSON.parse(data.criteria_text) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  throw new Error('Некорректный JSON критериев');
                }
                const created = await apiPost<Experiment>('/experiments', {
                  goal: data.goal,
                  term_days: data.term_days,
                  criteria,
                });
                void qc.invalidateQueries({ queryKey: ['experiments'] });
                setCreating(false);
                setSelectedId(created.id);
              }}
            >
              <FormTextarea name="goal" label="Цель" rows={3} required />
              <FormInput
                name="term_days"
                label="Срок (дней, 1..1825)"
                type="number"
                required
              />
              <FormTextarea
                name="criteria_text"
                label="Критерии (JSON)"
                rows={4}
                required
              />
            </Form>
          </Modal>
        ) : selectedId ? (
          <ExperimentDetail
            experimentId={selectedId}
            onChange={() => void qc.invalidateQueries({ queryKey: ['experiments'] })}
          />
        ) : (
          <Card>
            <div style={styles.empty}>
              Выберите протокол слева или подайте новый
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

// ─── Детали эксперимента ────────────────────────────────────────

function ExperimentDetail({
  experimentId,
  onChange,
}: {
  experimentId: string;
  onChange: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [completing, setCompleting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [approveInfo, setApproveInfo] = useState<ApproveResult['progress'] | null>(null);

  const expQ = useApiQuery<Experiment>(
    ['experiments', 'detail', experimentId],
    `/experiments/${experimentId}`,
  );
  const resultsQ = useApiQuery<{ results: ExperimentResults | null }>(
    ['experiments', 'results', experimentId],
    `/experiments/${experimentId}/results`,
  );

  const approveM = useMutation({
    mutationFn: () =>
      apiPost<ApproveResult>(`/experiments/${experimentId}/approve`, {}),
    onSuccess: (data) => {
      setApproveInfo(data.progress);
      void qc.invalidateQueries({ queryKey: ['experiments'] });
      onChange();
    },
  });

  const joinM = useMutation({
    mutationFn: () => apiPost(`/experiments/${experimentId}/join`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['experiments'] });
      onChange();
    },
  });

  const leaveM = useMutation({
    mutationFn: () => apiPost(`/experiments/${experimentId}/leave`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['experiments'] });
      onChange();
    },
  });

  const exp = expQ.data;
  const results = resultsQ.data?.results ?? null;

  if (expQ.isLoading) {return <Spinner />;}
  if (!exp) {return <Card><div style={styles.empty}>Протокол не найден</div></Card>;}

  return (
    <>
      <Card
        title={
          <div style={styles.detailHeader}>
            <Badge tone={EXP_STATUS_TONE[exp.status]}>
              {EXP_STATUS_LABEL[exp.status]}
            </Badge>
            <span style={styles.mono}>{exp.externalId}</span>
          </div>
        }
        subtitle={`${exp.termDays} дней · создан ${new Date(exp.createdAt).toLocaleDateString('ru-RU')}`}
      >
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Цель</div>
          <div style={styles.fieldText}>{exp.goal}</div>
        </div>

        <div style={styles.field}>
          <div style={styles.fieldLabel}>Участники ({exp.participants.length})</div>
          <div style={styles.fieldText}>
            {exp.participants.map((p) => (
              <span key={p} style={styles.mono}>{p.slice(0, 8)}… </span>
            ))}
          </div>
        </div>

        <div style={styles.field}>
          <div style={styles.fieldLabel}>Критерии</div>
          <pre style={styles.json}>{JSON.stringify(exp.criteria, null, 2)}</pre>
        </div>

        {approveInfo ? (
          <div style={styles.approveBox}>
            <div style={styles.fieldLabel}>
              Утверждение: {approveInfo.responded} / {approveInfo.total} ({approveInfo.percent}%)
            </div>
            <ProgressBar
              value={approveInfo.percent}
              max={100}
              label="Порог — 75%"
            />
          </div>
        ) : null}

        <div style={styles.actions}>
          {rights.hasRight('experiment', 'A') ? (
            <Button
              variant="primary"
              onClick={() => void approveM.mutateAsync()}
              disabled={approveM.isPending || exp.status === 'completed'}
            >
              {approveM.isPending ? '…' : 'Утвердить'}
            </Button>
          ) : null}
          {exp.status === 'filed' || exp.status === 'active' ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void joinM.mutateAsync()}
                disabled={joinM.isPending}
              >
                {joinM.isPending ? '…' : 'Присоединиться'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void leaveM.mutateAsync()}
                disabled={leaveM.isPending}
              >
                {leaveM.isPending ? '…' : 'Выйти'}
              </Button>
            </>
          ) : null}
          {exp.status === 'active' && rights.hasRight('experiment', 'E') ? (
            <Button variant="secondary" onClick={() => setRecording(true)}>
              Записать результаты
            </Button>
          ) : null}
          {exp.status === 'active' && rights.hasRight('experiment', 'E') ? (
            <Button variant="primary" onClick={() => setCompleting(true)}>
              Завершить
            </Button>
          ) : null}
        </div>
      </Card>

      {results ? (
        <Card
          title="Результаты"
          subtitle={`Опубликовано: ${results.published ? 'да' : 'нет'}`}
        >
          <div style={styles.field}>
            <div style={styles.fieldLabel}>
              Успехи ({results.successes.length})
            </div>
            <ul style={styles.list_}>
              {results.successes.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
          <div style={styles.field}>
            <div style={styles.fieldLabel}>
              Провалы ({results.failures.length})
            </div>
            <ul style={styles.list_}>
              {results.failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
          <div style={styles.field}>
            <div style={styles.fieldLabel}>Статистика</div>
            <pre style={styles.json}>{JSON.stringify(results.stats, null, 2)}</pre>
          </div>
        </Card>
      ) : null}

      {completing ? (
        <Modal onClose={() => setCompleting(false)} title="Завершить эксперимент">
        <>
          <p style={styles.muted}>
            Эксперимент будет помечен как завершённый. Результаты будут
            опубликованы в архив (best-effort).
          </p>
          <div style={styles.actions}>
            <Button
              variant="primary"
              onClick={async () => {
                await apiPost(`/experiments/${experimentId}/complete`, {});
                void qc.invalidateQueries({ queryKey: ['experiments'] });
                setCompleting(false);
                onChange();
              }}
            >
              Завершить
            </Button>
            <Button variant="secondary" onClick={() => setCompleting(false)}>
              Отмена
            </Button>
          </div>
        </>
        </Modal>
      ) : null}

      {recording ? (
        <Modal onClose={() => setRecording(false)} title="Результаты эксперимента">
          <Form<z.infer<typeof resultsSchema>>
            schema={resultsSchema}
            defaultValues={{
              successes_text: '',
              failures_text: '',
              stats_text: '{}',
            }}
            submitLabel="Записать"
            onCancel={() => setRecording(false)}
            onSubmit={async (data) => {
              let stats: Record<string, unknown>;
              try {
                stats = JSON.parse(data.stats_text) as Record<string, unknown>;
              } catch {
                throw new Error('Некорректный JSON статистики');
              }
              const successes = data.successes_text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              const failures = data.failures_text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              await apiPost(`/experiments/${experimentId}/results`, {
                successes,
                failures,
                stats,
              });
              void qc.invalidateQueries({ queryKey: ['experiments'] });
              setRecording(false);
            }}
          >
            <FormTextarea
              name="successes_text"
              label="Успехи (по одному в строке)"
              rows={4}
            />
            <FormTextarea
              name="failures_text"
              label="Провалы (по одному в строке)"
              rows={4}
            />
            <FormTextarea
              name="stats_text"
              label="Статистика (JSON)"
              rows={3}
            />
          </Form>
        </Modal>
      ) : null}
    </>
  );
}

// ─── Диссидентские проекты ─────────────────────────────────────

export function DissidentProjects(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);

  const q = useApiQuery<{ data: DissidentProject[] }>(
    ['experiments', 'dissidents'],
    '/dissident-projects?page=1&per_page=100',
  );
  const projects = q.data?.data ?? [];

  const petitionM = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/dissident-projects/${id}/petition`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['experiments'] }),
  });

  const reviewM = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/dissident-projects/${id}/review`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['experiments'] }),
  });

  const columns: Column<DissidentProject>[] = [
    {
      key: 'description',
      title: 'Проект',
      render: (r) => (
        <div style={{ maxWidth: 320 }}>
          {r.description.slice(0, 120)}
          {r.description.length > 120 ? '…' : ''}
        </div>
      ),
    },
    {
      key: 'petitionCount',
      title: 'Подписей',
      width: 110,
      render: (r) => (
        <div style={{ minWidth: 100 }}>
          <div>{r.petitionCount}</div>
          <ProgressBar value={r.petitionCount} max={14} label="к 1%" />
        </div>
      ),
    },
    {
      key: 'resourceSource',
      title: 'Источник',
      width: 160,
      render: (r) => (
        <Badge tone={r.resourceSource === 'freedom_reserve' ? 'warning' : 'info'}>
          {RESOURCE_LABEL[r.resourceSource]}
        </Badge>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 130,
      render: (r) => (
        <Badge tone={DISS_STATUS_TONE[r.status]}>
          {DISS_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'lastReportAt',
      title: 'Отчёт',
      width: 140,
      render: (r) =>
        r.lastReportAt
          ? new Date(r.lastReportAt).toLocaleDateString('ru-RU')
          : '—',
    },
    {
      key: 'actions',
      title: '',
      width: 260,
      render: (r) => (
        <div style={styles.rowActions}>
          {r.status !== 'closed' && r.status !== 'reviewed' && rights.hasRight('experiment', 'C') ? (
            <Button
              variant="ghost"
              onClick={() => void petitionM.mutateAsync(r.id)}
              disabled={petitionM.isPending}
            >
              Подписать
            </Button>
          ) : null}
          {rights.hasRight('experiment', 'E') ? (
            <Button variant="ghost" onClick={() => setReporting(r.id)}>
              Отчёт
            </Button>
          ) : null}
          {rights.hasRight('experiment', 'A') ? (
            <Button
              variant="ghost"
              onClick={() => void reviewM.mutateAsync(r.id)}
              disabled={reviewM.isPending || r.status === 'closed' || r.status === 'reviewed'}
            >
              Пересмотр
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Диссидентские проекты"
      subtitle="1% подписей (I.1.8.10). Отчёты каждые 60 дней. Пересмотр через 2 года."
      actions={
        rights.hasRight('experiment', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Создать проект
          </Button>
        ) : null
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<DissidentProject>
          data={projects}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Проектов нет"
        />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Новый диссидентский проект">
          <Form<z.infer<typeof createDissSchema>>
            schema={createDissSchema}
            defaultValues={{ description: '' }}
            submitLabel="Создать"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/dissident-projects', data);
              void qc.invalidateQueries({ queryKey: ['experiments'] });
              setCreating(false);
            }}
          >
            <FormTextarea
              name="description"
              label="Описание проекта"
              rows={4}
              required
            />
          </Form>
        </Modal>
      ) : null}

      {reporting ? (
        <Modal onClose={() => setReporting(null)} title="Отчёт по проекту">
          <Form<z.infer<typeof reportDissSchema>>
            schema={reportDissSchema}
            defaultValues={{ content: '' }}
            submitLabel="Отправить"
            onCancel={() => setReporting(null)}
            onSubmit={async (data) => {
              await apiPost(`/dissident-projects/${reporting}/report`, data);
              void qc.invalidateQueries({ queryKey: ['experiments'] });
              setReporting(null);
            }}
          >
            <FormTextarea
              name="content"
              label="Содержание отчёта"
              rows={6}
              required
            />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Мои эксперименты ───────────────────────────────────────────

function MyExperimentsTab(): ReactElement {
  const q = useApiQuery<{ data: Experiment[] }>(
    ['experiments', 'my'],
    '/experiments/my',
  );
  const experiments = q.data?.data ?? [];

  const columns: Column<Experiment>[] = [
    {
      key: 'externalId',
      title: 'ID',
      width: 140,
      render: (r) => <span style={styles.mono}>{r.externalId}</span>,
    },
    {
      key: 'goal',
      title: 'Цель',
      render: (r) => r.goal.slice(0, 100),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 130,
      render: (r) => (
        <Badge tone={EXP_STATUS_TONE[r.status]}>
          {EXP_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'termDays',
      title: 'Срок',
      width: 90,
      render: (r) => `${r.termDays} дн.`,
    },
  ];

  return (
    <Card title="Мои эксперименты" subtitle="Протоколы, где я участник">
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<Experiment>
          data={experiments}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Я не участвую ни в одном эксперименте"
        />
      )}
    </Card>
  );
}

// ─── Modal ───────────────────────────────────────────────────────

function Modal({
  children,
  title,
  onClose,
}: {
  children: ReactElement;
  title: string;
  onClose: () => void;
}): ReactElement {
  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title={title}>{children}</Card>
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
    height: '100%',
    minHeight: 0,
  },
  header: { display: 'flex' as const, flexDirection: 'column' as const, gap: 4 },
  title: { margin: 0, fontSize: 22, color: colors.text },
  subtitle: { color: colors.textMuted, fontSize: fontSize.sm },
  tabs: {
    display: 'flex' as const,
    gap: 4,
    flexWrap: 'wrap' as const,
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  tab: {
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    padding: '8px 14px',
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    borderRadius: `${radius.sm}px ${radius.sm}px 0 0`,
    fontFamily: 'inherit',
  },
  tabActive: {
    background: colors.bgSoft,
    color: colors.text,
    borderBottom: `2px solid ${colors.primary}`,
  },
  split: {
    display: 'grid' as const,
    gridTemplateColumns: '340px 1fr',
    gap: spacing.md,
    flex: 1,
    minHeight: 0,
  },
  list: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    overflowY: 'auto' as const,
    paddingRight: 4,
  },
  list_: {
    margin: 0,
    paddingLeft: 20,
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.6,
  },
  listItem: {
    textAlign: 'left' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    padding: '10px 12px',
    cursor: 'pointer',
    color: colors.text,
    fontFamily: 'inherit',
    fontSize: fontSize.sm,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
  listItemActive: {
    border: `1px solid ${colors.primary}`,
    background: 'rgba(59, 130, 246, 0.08)',
  },
  listItemTop: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  listItemDesc: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.35,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box' as const,
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  },
  listItemMeta: {
    display: 'flex' as const,
    gap: 8,
    fontSize: fontSize.xs,
    justifyContent: 'space-between' as const,
  },
  detail: {
    overflowY: 'auto' as const,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  detailHeader: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  },
  json: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.textMuted,
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  actions: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    marginTop: spacing.sm,
  },
  rowActions: {
    display: 'flex' as const,
    gap: spacing.xs,
    flexWrap: 'wrap' as const,
  },
  approveBox: {
    padding: spacing.md,
    background: colors.bgSoft,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  filters: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    marginBottom: spacing.sm,
  },
  select: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  },
  mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: colors.textDim },
  dim: { color: colors.textDim, fontSize: fontSize.xs },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center' as const,
    padding: 20,
  },
  modalBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 100,
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
  },
};
