// F.4.02.23 — Learning page.
/**
 * 6 табов: курсы, цифровой наставник, ПТТ, маршруты, рефреш+модули, интеграторы.
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
import {
  Form, FormInput, FormTextarea,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

//type EnrollmentStatus = 'enrolled' | 'in_progress' | 'completed' | 'dropped';
type PttStatus =
  | 'started' | 'compression' | 'materialization' | 'reintegration'
  | 'completed' | 'cancelled';
type RouteStatus = 'active' | 'completed' | 'cancelled';

interface Course {
  id: string;
  title: string;
  description: string | null;
  modules: Array<Record<string, unknown>>;
  durationDays: number;
  createdAt: string;
}

interface DigitalMentor {
  id: string;
  mentorType: 'ai';
  activeMentees: number;
  algorithmVersion: string;
  createdAt: string;
}

interface Ptt {
  id: string;
  goal: string;
  durationDays: number;
  status: PttStatus;
  startedAt: string;
  finishedAt: string | null;
}

interface CognitiveRoute {
  id: string;
  participantId: string;
  directionId: string;
  mentorId: string;
  startedAt: string;
  finishedAt: string | null;
  status: RouteStatus;
  certificateIssued: boolean;
}

interface IntegratorMentor {
  id: string;
  mentorId: string;
  directionId: string;
  mentees: string[];
  maxMentees: number;
  createdAt: string;
}

type Tab = 'courses' | 'mentor' | 'ptt' | 'routes' | 'refresh' | 'integrators';

// ─── Константы ───────────────────────────────────────────────────



const PTT_STATUS_LABEL: Record<PttStatus, string> = {
  started: 'Начат',
  compression: 'Сжатие',
  materialization: 'Материализация',
  reintegration: 'Реинтеграция',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

const PTT_STATUS_TONE: Record<PttStatus, BadgeTone> = {
  started: 'info',
  compression: 'warning',
  materialization: 'warning',
  reintegration: 'info',
  completed: 'success',
  cancelled: 'default',
};

const PTT_PHASES: PttStatus[] = [
  'started', 'compression', 'materialization', 'reintegration', 'completed',
];

const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = {
  active: 'Активен',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

const ROUTE_STATUS_TONE: Record<RouteStatus, BadgeTone> = {
  active: 'info',
  completed: 'success',
  cancelled: 'default',
};

const TAB_LABEL: Record<Tab, string> = {
  courses: 'Курсы',
  mentor: 'Наставник',
  ptt: 'ПТТ',
  routes: 'Маршруты',
  refresh: 'Рефреш',
  integrators: 'Интеграторы',
};

// ─── Страница ────────────────────────────────────────────────────

export function LearningPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('courses');

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Обучение</h1>

      <div style={styles.tabs}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{ ...styles.tabBtn, ...(tab === t ? styles.tabBtnActive : {}) }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'courses' ? <CoursesSection /> : null}
      {tab === 'mentor' ? <MentorSection /> : null}
      {tab === 'ptt' ? <PttSection /> : null}
      {tab === 'routes' ? <RoutesSection /> : null}
      {tab === 'refresh' ? <RefreshSection /> : null}
      {tab === 'integrators' ? <IntegratorsSection /> : null}
    </div>
  );
}

// ─── Курсы ───────────────────────────────────────────────────────

function CoursesSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const user = useUser();
  const [creating, setCreating] = useState(false);

  const listQ = useApiQuery<{ data: Course[]; meta: { total: number } }>(
    ['learning', 'courses'],
    '/learning/courses?page=1&per_page=50',
  );

  const enrollM = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/learning/courses/${id}/enroll`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['learning', 'courses'] });
      setCreating(false);
    },
  });

  const completeM = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/learning/courses/${id}/complete`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['learning'] }),
  });

  const columns: Column<Course>[] = [
    { key: 'title', title: 'Название', sortable: true },
    {
      key: 'description',
      title: 'Описание',
      render: (r) =>
        r.description ? (
          <span style={styles.truncate}>{r.description.slice(0, 60)}…</span>
        ) : (
          <span style={styles.muted}>—</span>
        ),
    },
    {
      key: 'modules',
      title: 'Модулей',
      width: 100,
      align: 'center',
      render: (r) => String(r.modules?.length ?? 0),
    },
    {
      key: 'durationDays',
      title: 'Дней',
      width: 80,
      align: 'center',
      sortable: true,
    },
    {
      key: 'actions',
      title: '',
      width: 220,
      render: (r) => (
        <div style={styles.rowActions}>
          <Button
            variant="ghost"
            disabled={enrollM.isPending}
            onClick={() => void enrollM.mutateAsync(r.id)}
          >
            Записаться
          </Button>
          <Button
            variant="ghost"
            disabled={completeM.isPending}
            onClick={() => void completeM.mutateAsync(r.id)}
          >
            Завершить
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Курсы"
      subtitle={`Всего ${listQ.data?.meta?.total ?? 0}`}
      actions={
        rights.hasRight('learning', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Создать курс
          </Button>
        ) : undefined
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Course>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Курсов нет"
        />
      )}

      <p style={styles.hint}>
        Participant: {user?.participant.id.slice(0, 8)}…
      </p>

      {creating ? (
        <CreateCourseModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['learning', 'courses'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const courseSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  duration_days: z.coerce.number().int().positive(),
});

type CourseForm = z.infer<typeof courseSchema>;

function CreateCourseModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CourseForm) =>
      apiPost<Course>('/learning/courses', {
        title: data.title,
        ...(data.description ? { description: data.description } : {}),
        modules: [],
        duration_days: data.duration_days,
      }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый курс">
        <Form<CourseForm>
          schema={courseSchema}
          defaultValues={{ title: '', description: '', duration_days: 30 }}
          submitLabel="Создать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="title" label="Название" required />
          <FormTextarea name="description" label="Описание" rows={4} maxLength={5000} />
          <FormInput name="duration_days" label="Длительность (дней)" type="number" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Цифровой наставник ──────────────────────────────────────────

function MentorSection(): ReactElement {
  const qc = useQueryClient();
  const [transferring, setTransferring] = useState(false);

  const dmQ = useApiQuery<DigitalMentor>(
    ['learning', 'mentor'],
    '/learning/digital-mentor',
  );

  return (
    <Card
      title="Цифровой наставник"
      subtitle="До 50 стажёров (I.6.12.2). Не получает Потоков, не имеет голоса"
      actions={
        <Button variant="secondary" onClick={() => setTransferring(true)}>
          Передать человеку
        </Button>
      }
    >
      {dmQ.isLoading ? (
        <Spinner />
      ) : !dmQ.data ? (
        <p style={styles.muted}>Не активирован</p>
      ) : (
        <>
          <div style={styles.metricRow}>
            <div style={styles.metricItem}>
              <div style={styles.metricLabel}>Активных стажёров</div>
              <div style={styles.metricValue}>
                {dmQ.data.activeMentees} / 50
              </div>
            </div>
            <div style={styles.metricItem}>
              <div style={styles.metricLabel}>Версия алгоритма</div>
              <div style={styles.metricValue}>{dmQ.data.algorithmVersion}</div>
            </div>
          </div>
          <ProgressBar
            value={dmQ.data.activeMentees}
            max={50}
            label="Заполненность"
          />
        </>
      )}

      {transferring ? (
        <TransferMentorModal
          onClose={() => setTransferring(false)}
          onTransferred={() => {
            void qc.invalidateQueries({ queryKey: ['learning', 'mentor'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const transferSchema = z.object({
  mentee_id: z.string().uuid('UUID стажёра'),
  human_mentor_id: z.string().uuid('UUID наставника'),
  reason: z.string().min(1).max(2000),
});

type TransferForm = z.infer<typeof transferSchema>;

function TransferMentorModal({
  onClose,
  onTransferred,
}: {
  onClose: () => void;
  onTransferred: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const transferM = useMutation({
    mutationFn: (data: TransferForm) =>
      apiPost<DigitalMentor>('/learning/digital-mentor/transfer', data),
    onSuccess: () => {
      onTransferred();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Передать человека">
        <Form<TransferForm>
          schema={transferSchema}
          defaultValues={{ mentee_id: '', human_mentor_id: '', reason: '' }}
          submitLabel="Передать"
          onCancel={onClose}
          loading={transferM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await transferM.mutateAsync(data);
          }}
        >
          <FormInput name="mentee_id" label="UUID стажёра" required />
          <FormInput name="human_mentor_id" label="UUID человеческого наставника" required />
          <FormTextarea name="reason" label="Причина" rows={3} required maxLength={2000} />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── ПТТ ─────────────────────────────────────────────────────────

function PttSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [starting, setStarting] = useState(false);
  const [lookup, setLookup] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card
      title="ПТТ"
      subtitle="До 90 дней, 1 раз в 5 лет (I.4.6.1). Фазы: started → compression → materialization → reintegration → completed"
      actions={
        rights.hasRight('learning', 'C') ? (
          <Button variant="primary" onClick={() => setStarting(true)}>
            + Начать ПТТ
          </Button>
        ) : undefined
      }
    >
      <div style={styles.openRow}>
        <input
          style={styles.input}
          placeholder="UUID ПТТ (списка нет в API)"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!lookup.trim()}
          onClick={() => setOpenId(lookup.trim())}
        >
          Открыть
        </Button>
      </div>

      {openId ? <PttDetail pttId={openId} onClose={() => setOpenId(null)} /> : null}

      {starting ? (
        <StartPttModal
          onClose={() => setStarting(false)}
          onCreated={(id) => {
            setOpenId(id);
            void qc.invalidateQueries({ queryKey: ['learning'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const pttSchema = z.object({
  goal: z.string().min(1).max(5000),
  duration_days: z.coerce.number().int().min(1).max(90),
});

type PttForm = z.infer<typeof pttSchema>;

function StartPttModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const startM = useMutation({
    mutationFn: (data: PttForm) => apiPost<Ptt>('/learning/ptt', data),
    onSuccess: (p) => {
      onCreated(p.id);
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Начать ПТТ">
        <Form<PttForm>
          schema={pttSchema}
          defaultValues={{ goal: '', duration_days: 90 }}
          submitLabel="Начать"
          onCancel={onClose}
          loading={startM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await startM.mutateAsync(data);
          }}
        >
          <FormTextarea name="goal" label="Цель ПТТ" rows={3} required maxLength={5000} />
          <FormInput name="duration_days" label="Длительность (1–90)" type="number" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

function PttDetail({
  pttId,
  onClose,
}: {
  pttId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [findings, setFindings] = useState<string[] | null>(null);

  const pttQ = useApiQuery<Ptt>(['learning', 'ptt', pttId], `/learning/ptt/${pttId}`);

  const advanceM = useMutation({
    mutationFn: () => apiPost<Ptt>(`/learning/ptt/${pttId}/advance`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['learning', 'ptt', pttId] });
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  const auditM = useMutation({
    mutationFn: () => apiPost<{ findings: string[] }>(`/learning/ptt/${pttId}/audit`, {}),
    onSuccess: (r) => setFindings(r.findings ?? []),
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  if (pttQ.isLoading) {return <Spinner />;}
  if (!pttQ.data) {return <p style={styles.muted}>Не найдено</p>;}

  const p = pttQ.data;
  const phaseIdx = PTT_PHASES.indexOf(p.status);

  return (
    <div style={styles.subBlock}>
      <div style={styles.subBlockTitle}>ПТТ {p.id.slice(0, 8)}…</div>
      <Badge tone={PTT_STATUS_TONE[p.status]}>{PTT_STATUS_LABEL[p.status]}</Badge>
      <p style={styles.muted}>{p.goal}</p>
      <ProgressBar
        value={Math.max(phaseIdx + 1, 0)}
        max={PTT_PHASES.length}
        label={`Фаза ${phaseIdx + 1} из ${PTT_PHASES.length}`}
      />
      <div style={styles.phaseList}>
        {PTT_PHASES.map((phase, i) => (
          <div key={phase} style={styles.phaseRow}>
            <Badge tone={i <= phaseIdx ? 'success' : 'default'}>
              {PTT_STATUS_LABEL[phase]}
            </Badge>
          </div>
        ))}
      </div>

      <div style={styles.rowActions}>
        <Button
          variant="primary"
          disabled={advanceM.isPending || p.status === 'completed' || p.status === 'cancelled'}
          onClick={() => void advanceM.mutateAsync()}
        >
          {advanceM.isPending ? '…' : 'Следующая фаза'}
        </Button>
        <Button
          variant="secondary"
          disabled={auditM.isPending}
          onClick={() => void auditM.mutateAsync()}
        >
          Аудит
        </Button>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>

      {findings ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Результат аудита</div>
          {findings.length === 0 ? (
            <p style={styles.muted}>Находок нет</p>
          ) : (
            findings.map((f, i) => <div key={i}>• {f}</div>)
          )}
        </div>
      ) : null}

      {err ? <div style={styles.error}>{err}</div> : null}
    </div>
  );
}

// ─── Маршруты ────────────────────────────────────────────────────

function RoutesSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const listQ = useApiQuery<{ data: CognitiveRoute[] }>(
    ['learning', 'routes', filterStatus],
    `/cognitive-routes${filterStatus ? `?status=${filterStatus}` : ''}`,
  );

  const completeM = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/cognitive-routes/${id}/complete`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['learning', 'routes'] }),
  });

  const columns: Column<CognitiveRoute>[] = [
    {
      key: 'participantId',
      title: 'Участник',
      render: (r) => <span style={styles.mono}>{r.participantId.slice(0, 8)}…</span>,
    },
    {
      key: 'mentorId',
      title: 'Наставник',
      render: (r) => <span style={styles.mono}>{r.mentorId.slice(0, 8)}…</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: 120,
      render: (r) => (
        <Badge tone={ROUTE_STATUS_TONE[r.status]}>
          {ROUTE_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'certificateIssued',
      title: 'Сертификат',
      width: 110,
      align: 'center',
      render: (r) => (r.certificateIssued ? '✓' : '—'),
    },
    {
      key: 'startedAt',
      title: 'Начат',
      width: 140,
      render: (r) => new Date(r.startedAt).toLocaleDateString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 100,
      render: (r) =>
        r.status === 'active' ? (
          <Button
            variant="ghost"
            disabled={completeM.isPending}
            onClick={() => void completeM.mutateAsync(r.id)}
          >
            Завершить
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title="Когнитивные маршруты"
      subtitle="30 дней, 1% экскурсантов (V.1.3.5)"
      actions={
        <div style={styles.cardActions}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все</option>
            {(Object.keys(ROUTE_STATUS_LABEL) as RouteStatus[]).map((s) => (
              <option key={s} value={s}>{ROUTE_STATUS_LABEL[s]}</option>
            ))}
          </select>
          {rights.hasRight('learning', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Подать заявку
            </Button>
          ) : null}
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<CognitiveRoute>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Маршрутов нет"
        />
      )}

      <RouteQueueLookup />

      {creating ? (
        <CreateRouteModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['learning', 'routes'] });
          }}
        />
      ) : null}
    </Card>
  );
}

function RouteQueueLookup(): ReactElement {
  const [directionId, setDirectionId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const queueQ = useApiQuery<{ queue: string[]; freeSlots: number }>(
    ['learning', 'route-queue', openId ?? ''],
    `/cognitive-routes/queue/${openId}`,
    { enabled: Boolean(openId) },
  );

  return (
    <div style={styles.subBlock}>
      <div style={styles.subBlockTitle}>Очередь направления</div>
      <div style={styles.openRow}>
        <input
          style={styles.input}
          placeholder="UUID направления"
          value={directionId}
          onChange={(e) => setDirectionId(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!directionId.trim()}
          onClick={() => setOpenId(directionId.trim())}
        >
          Показать
        </Button>
      </div>
      {queueQ.data ? (
        <div style={styles.metricRow}>
          <div style={styles.metricItem}>
            <div style={styles.metricLabel}>Активных</div>
            <div style={styles.metricValue}>{queueQ.data.queue.length}</div>
          </div>
          <div style={styles.metricItem}>
            <div style={styles.metricLabel}>Свободных слотов</div>
            <div style={styles.metricValue}>{queueQ.data.freeSlots}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const routeSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  direction_id: z.string().uuid('UUID направления'),
  mentor_id: z.string().uuid('UUID наставника'),
});

type RouteForm = z.infer<typeof routeSchema>;

function CreateRouteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: RouteForm) =>
      apiPost<CognitiveRoute>('/cognitive-routes', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый маршрут">
        <Form<RouteForm>
          schema={routeSchema}
          defaultValues={{ participant_id: '', direction_id: '', mentor_id: '' }}
          submitLabel="Создать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="participant_id" label="UUID участника" required />
          <FormInput name="direction_id" label="UUID направления" required />
          <FormInput name="mentor_id" label="UUID наставника" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Рефреш + модули ─────────────────────────────────────────────

function RefreshSection(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();

  const [refreshOpen, setRefreshOpen] = useState(false);
  const [modulePassing, setModulePassing] = useState<'basic_defense' | 'respect' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshM = useMutation({
    mutationFn: (data: { direction_1_id: string; direction_2_id: string }) =>
      apiPost('/refresh-courses', {
        participant_id: user?.participant.id,
        direction_1_id: data.direction_1_id,
        direction_2_id: data.direction_2_id,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['learning'] });
      setRefreshOpen(false);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  const moduleM = useMutation({
    mutationFn: (module: 'basic_defense' | 'respect') =>
      apiPost(`/modules/${module.replace('_', '-')}`, {
        participant_id: user?.participant.id,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['learning'] });
      setModulePassing(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Card
      title="Рефреш и модули"
      subtitle="Рефреш — раз в 5 лет (V.1.3.3). Модули: «Базовая защита», «Уважение и границы»"
      actions={
        <div style={styles.cardActions}>
          <Button variant="secondary" onClick={() => setRefreshOpen(true)}>
            + Рефреш
          </Button>
          <Button variant="secondary" onClick={() => setModulePassing('basic_defense')}>
            Модуль «Базовая защита»
          </Button>
          <Button variant="secondary" onClick={() => setModulePassing('respect')}>
            Модуль «Уважение»
          </Button>
        </div>
      }
    >
      <p style={styles.muted}>
        Рефреш: 2 направления + 2 модуля. Прохождение отмечается.
        Историю прохождений можно увидеть в БД (`module_passes`, `refresh_courses`).
      </p>
      {err ? <div style={styles.error}>{err}</div> : null}

      {refreshOpen ? (
        <Modal onClose={() => setRefreshOpen(false)}>
          <Card title="Рефреш-курс">
            <RefreshForm
              onSubmit={(d) => void refreshM.mutateAsync(d)}
              onCancel={() => setRefreshOpen(false)}
              busy={refreshM.isPending}
            />
          </Card>
        </Modal>
      ) : null}

      {modulePassing ? (
        <Modal onClose={() => setModulePassing(null)}>
          <Card title={`Отметить прохождение: ${modulePassing === 'basic_defense' ? 'Базовая защита' : 'Уважение'}`}>
            <p style={styles.muted}>
              Модуль будет отмечен для {user?.participant.id.slice(0, 8)}…
            </p>
            <div style={styles.successActions}>
              <Button
                variant="primary"
                onClick={() => void moduleM.mutateAsync(modulePassing)}
                disabled={moduleM.isPending}
              >
                {moduleM.isPending ? '…' : 'Отметить'}
              </Button>
              <Button variant="ghost" onClick={() => setModulePassing(null)}>Отмена</Button>
            </div>
          </Card>
        </Modal>
      ) : null}
    </Card>
  );
}

const refreshFormSchema = z.object({
  direction_1_id: z.string().uuid('UUID направления 1'),
  direction_2_id: z.string().uuid('UUID направления 2'),
});

type RefreshFormData = z.infer<typeof refreshFormSchema>;

function RefreshForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (d: RefreshFormData) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <Form<RefreshFormData>
      schema={refreshFormSchema}
      defaultValues={{ direction_1_id: '', direction_2_id: '' }}
      submitLabel="Создать рефреш"
      onCancel={onCancel}
      loading={busy}
      onSubmit={async (data) => onSubmit(data)}
    >
      <FormInput name="direction_1_id" label="UUID направления 1" required />
      <FormInput name="direction_2_id" label="UUID направления 2" required />
    </Form>
  );
}

// ─── Интеграторы ─────────────────────────────────────────────────

function IntegratorsSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);
  const [addingMentee, setAddingMentee] = useState<string | null>(null);

  const listQ = useApiQuery<{ data: IntegratorMentor[] }>(
    ['learning', 'integrators'],
    '/integration/mentors',
  );

  const columns: Column<IntegratorMentor>[] = [
    {
      key: 'mentorId',
      title: 'Интегратор',
      render: (r) => <span style={styles.mono}>{r.mentorId.slice(0, 8)}…</span>,
    },
    {
      key: 'directionId',
      title: 'Направление',
      render: (r) => <span style={styles.mono}>{r.directionId.slice(0, 8)}…</span>,
    },
    {
      key: 'mentees',
      title: 'Экскурсанты',
      width: 130,
      align: 'center',
      render: (r) => `${r.mentees.length} / ${r.maxMentees}`,
    },
    {
      key: 'actions',
      title: '',
      width: 180,
      render: (r) =>
        rights.hasRight('learning', 'E') ? (
          <Button
            variant="ghost"
            disabled={r.mentees.length >= r.maxMentees}
            onClick={() => setAddingMentee(r.id)}
          >
            + Экскурсант
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title="Интеграторы"
      subtitle="5 маршрутов, 15 лет стажа, до 3 экскурсантов (V.1.12.3)"
      actions={
        rights.hasRight('learning', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Назначить интегратора
          </Button>
        ) : undefined
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<IntegratorMentor>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Интеграторов нет"
        />
      )}

      {creating ? (
        <AddIntegratorModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['learning', 'integrators'] });
          }}
        />
      ) : null}

      {addingMentee ? (
        <AddMenteeModal
          integratorId={addingMentee}
          onClose={() => setAddingMentee(null)}
          onAdded={() => {
            void qc.invalidateQueries({ queryKey: ['learning', 'integrators'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const integratorSchema = z.object({
  mentor_id: z.string().uuid('UUID интегратора'),
  direction_id: z.string().uuid('UUID направления'),
});

type IntegratorForm = z.infer<typeof integratorSchema>;

function AddIntegratorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: IntegratorForm) =>
      apiPost<IntegratorMentor>('/integration/mentors', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый интегратор">
        <Form<IntegratorForm>
          schema={integratorSchema}
          defaultValues={{ mentor_id: '', direction_id: '' }}
          submitLabel="Назначить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="mentor_id" label="UUID интегратора" required />
          <FormInput name="direction_id" label="UUID направления" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const menteeSchema = z.object({
  mentee_id: z.string().uuid('UUID экскурсанта'),
});

type MenteeForm = z.infer<typeof menteeSchema>;

function AddMenteeModal({
  integratorId,
  onClose,
  onAdded,
}: {
  integratorId: string;
  onClose: () => void;
  onAdded: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const addM = useMutation({
    mutationFn: (data: MenteeForm) =>
      apiPost(`/integration/mentors/${integratorId}/mentees`, data),
    onSuccess: () => {
      onAdded();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Добавить экскурсанта">
        <Form<MenteeForm>
          schema={menteeSchema}
          defaultValues={{ mentee_id: '' }}
          submitLabel="Добавить"
          onCancel={onClose}
          loading={addM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await addM.mutateAsync(data);
          }}
        >
          <FormInput name="mentee_id" label="UUID экскурсанта" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Modal ───────────────────────────────────────────────────────

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}): ReactElement {
  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md },
  title: { margin: 0, fontSize: 22, color: colors.text },
  tabs: {
    display: 'flex' as const, gap: 2,
    background: colors.bgSoft, padding: 4, borderRadius: radius.md,
    border: `1px solid ${colors.borderSoft}`,
    width: 'fit-content' as const, flexWrap: 'wrap' as const,
  },
  tabBtn: {
    background: 'transparent', border: 'none', color: colors.textMuted,
    padding: '6px 14px', borderRadius: radius.sm,
    cursor: 'pointer' as const, fontSize: fontSize.sm, fontFamily: 'inherit',
  },
  tabBtnActive: { background: colors.primary, color: '#fff' },
  cardActions: {
    display: 'flex' as const, gap: spacing.sm,
    alignItems: 'center' as const, flexWrap: 'wrap' as const,
  },
  select: {
    background: colors.bgInput, border: `1px solid ${colors.border}`,
    borderRadius: radius.sm, color: colors.text,
    padding: '6px 10px', fontSize: fontSize.sm,
  },
  input: {
    background: colors.bgInput, border: `1px solid ${colors.border}`,
    borderRadius: radius.sm, color: colors.text,
    padding: '6px 10px', fontSize: fontSize.sm, fontFamily: 'inherit',
    minWidth: 220, flex: 1,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: colors.text },
  truncate: {
    display: 'inline-block' as const, maxWidth: 320,
    overflow: 'hidden' as const, textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  rowActions: { display: 'flex' as const, gap: spacing.sm },
  openRow: {
    display: 'flex' as const, gap: spacing.sm,
    alignItems: 'center' as const, flexWrap: 'wrap' as const,
    marginBottom: spacing.sm,
  },
  subBlock: {
    display: 'flex' as const, flexDirection: 'column' as const,
    gap: spacing.sm, padding: spacing.md,
    background: colors.bg, border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md, marginTop: spacing.sm,
  },
  subBlockTitle: {
    color: colors.textMuted, fontSize: fontSize.xs, fontWeight: 600,
    textTransform: 'uppercase' as const, letterSpacing: 0.4,
  },
  metricRow: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: spacing.md, marginBottom: spacing.md,
  },
  metricItem: {
    padding: spacing.md, background: colors.bgInput,
    borderRadius: radius.md,
  },
  metricLabel: {
    color: colors.textMuted, fontSize: fontSize.xs,
    textTransform: 'uppercase' as const, letterSpacing: 0.4,
  },
  metricValue: {
    color: colors.text, fontSize: 20, fontWeight: 600, marginTop: 4,
  },
  phaseList: {
    display: 'flex' as const, gap: spacing.sm, flexWrap: 'wrap' as const,
  },
  phaseRow: { display: 'flex' as const },
  error: {
    color: colors.danger, fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6, padding: '8px 12px',
  },
  hint: {
    color: colors.textDim, fontSize: fontSize.xs,
    marginTop: spacing.sm, fontFamily: 'monospace',
  },
  successActions: {
    display: 'flex' as const, gap: spacing.sm,
    justifyContent: 'flex-end' as const, marginTop: spacing.md,
  },
  modalBackdrop: {
    position: 'fixed' as const, inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    zIndex: 100, padding: spacing.lg,
  },
  modal: {
    width: '100%', maxWidth: 620,
    maxHeight: '90vh', overflowY: 'auto' as const,
  },
};