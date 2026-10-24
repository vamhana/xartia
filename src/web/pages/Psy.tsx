// src/web/pages/Psy.tsx
/**
 * F.4.02.15 — Панель Психоэкологии.
 *
 * 8 табов: sessions / observers / crisis / discharge / mood / resonance /
 * wellbeing / hygiene.
 * Психоэкология не лечит — работает на уровне гигиены смыслов (I.4.12).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost, apiDelete } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/Chart';
import {
  Form,
  FormInput,
  FormSelect,
  FormTextarea,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type Tab =
  | 'sessions'
  | 'observers'
  | 'crisis'
  | 'discharge'
  | 'mood'
  | 'resonance'
  | 'wellbeing'
  | 'hygiene';

type SessionType = 'onboarding' | 'crisis' | 'discharge' | 'resonance';
type SessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

interface PsySession {
  id: string;
  participantId: string;
  psychologistId: string;
  type: SessionType;
  notes: string | null;
  status: SessionStatus;
  scheduledAt: string;
  completedAt: string | null;
  createdAt: string;
}

interface PsyObserver {
  id: string;
  participantId: string;
  directionId: string;
  validFrom: string;
  validTo: string | null;
}

interface PsyCrisis {
  id: string;
  participantId: string;
  status: 'open' | 'in_progress' | 'closed';
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
}

interface PsyDischarge {
  id: string;
  participantId: string;
  days: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  createdAt: string;
  completedAt: string | null;
}

interface MoodMetric {
  id: string;
  directionId: string;
  metric: string;
  value: number;
  period: string;
  hasData: boolean;
  createdAt: string;
}

interface Wellbeing {
  id: string;
  participantId: string;
  score: number;
  trend: 'up' | 'stable' | 'down';
  createdAt: string;
}

interface Hygiene {
  id: string;
  directionId: string;
  measure: string;
  status: 'proposed' | 'applied';
  createdAt: string;
  appliedAt: string | null;
}

// ─── Константы ───────────────────────────────────────────────────

const TAB_LABEL: Record<Tab, string> = {
  sessions: 'Сессии',
  observers: 'Наблюдатели',
  crisis: 'Кризисы',
  discharge: 'Разгрузка',
  mood: 'Настроения',
  resonance: 'Резонанс',
  wellbeing: 'Благополучие',
  hygiene: 'Гигиена смыслов',
};

const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  onboarding: 'Адаптация',
  crisis: 'Кризис',
  discharge: 'Разгрузка',
  resonance: 'Резонанс',
};

const SESSION_STATUS_TONE: Record<SessionStatus, BadgeTone> = {
  scheduled: 'info',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'default',
};

const CRISIS_STATUS_TONE: Record<PsyCrisis['status'], BadgeTone> = {
  open: 'critical',
  in_progress: 'warning',
  closed: 'success',
};

const TREND_TONE: Record<Wellbeing['trend'], BadgeTone> = {
  up: 'success',
  stable: 'info',
  down: 'danger',
};

const TREND_LABEL: Record<Wellbeing['trend'], string> = {
  up: '↑ рост',
  stable: '→ стабильно',
  down: '↓ спад',
};

// ─── Схемы ───────────────────────────────────────────────────────

const createSessionSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  type: z.enum(['onboarding', 'crisis', 'discharge', 'resonance']),
  scheduled_at: z.string().min(1, 'Укажите дату'),
});

const createObserverSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  direction_id: z.string().uuid('UUID направления'),
});

const crisisSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  notes: z.string().max(10000).optional(),
});

const dischargeSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  days: z.coerce.number().int().min(3).max(5),
});

const wellbeingSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  score: z.coerce.number().int().min(1).max(10),
});

const resonanceSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
});

const hygieneSchema = z.object({
  direction_id: z.string().uuid('UUID направления'),
  measure: z.string().min(1).max(2000),
});

// ─── Страница ────────────────────────────────────────────────────

export function PsyPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('sessions');
  const qc = useQueryClient();

  useWSSubscription('psy', (event) => {
    // Сессии
    if (
      event === 'psy.session.scheduled' ||
      event === 'psy.session.completed'
    ) {
      void qc.invalidateQueries({ queryKey: ['psy', 'sessions'] });
    }
    // Наблюдатели
    if (
      event === 'psy.observer.assigned' ||
      event === 'psy.observer.removed'
    ) {
      void qc.invalidateQueries({ queryKey: ['psy', 'observers'] });
    }
    // Кризисы
    if (
      event === 'psy.crisis.started' ||
      event === 'psy.crisis.closed'
    ) {
      void qc.invalidateQueries({ queryKey: ['psy', 'crisis'] });
    }
    // Разгрузка / резонанс
    if (
      event === 'psy.discharge.started' ||
      event === 'psy.discharge.completed'
    ) {
      void qc.invalidateQueries({ queryKey: ['psy', 'discharge'] });
    }
    // Благополучие
    if (event === 'psy.wellbeing.recorded') {
      void qc.invalidateQueries({ queryKey: ['psy', 'wellbeing'] });
      void qc.invalidateQueries({ queryKey: ['psy', 'mood'] });
    }
    // Гигиена
    if (
      event === 'psy.hygiene.proposed' ||
      event === 'psy.hygiene.applied'
    ) {
      void qc.invalidateQueries({ queryKey: ['psy', 'hygiene'] });
    }
    // Настроения (cron-пересчёт)
    if (event === 'psy.mood.updated') {
      void qc.invalidateQueries({ queryKey: ['psy', 'mood'] });
    }
    // Систематическое насилие — громкое событие.
    if (event === 'psy.systemic_violence.detected') {
      void qc.invalidateQueries({ queryKey: ['psy'] });
      // При желании — toast/window.alert, но клиент сам решает.
    }
  });

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Психоэкология</h1>
        <span style={styles.subtitle}>
          Не лечит. Гигиена смыслов, эмоциональная экология, коллективные настроения (I.4.12)
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

      {tab === 'sessions' && <SessionsTab />}
      {tab === 'observers' && <ObserversTab />}
      {tab === 'crisis' && <CrisisTab />}
      {tab === 'discharge' && <DischargeTab />}
      {tab === 'mood' && <MoodTab />}
      {tab === 'resonance' && <ResonanceTab />}
      {tab === 'wellbeing' && <WellbeingTab />}
      {tab === 'hygiene' && <HygieneTab />}
    </div>
  );
}

// ─── Sessions ────────────────────────────────────────────────────

function SessionsTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  const q = useApiQuery<{ data: PsySession[] }>(
    ['psy', 'sessions'],
    '/psy/sessions',
  );

  const sessions = q.data?.data ?? [];

  const columns: Column<PsySession>[] = [
    {
      key: 'type',
      title: 'Тип',
      render: (r) => <Badge tone="info">{SESSION_TYPE_LABEL[r.type]}</Badge>,
    },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => (
        <Badge tone={SESSION_STATUS_TONE[r.status]}>{r.status}</Badge>
      ),
    },
    {
      key: 'participant',
      title: 'Участник',
      render: (r) => <span style={styles.mono}>{r.participantId.slice(0, 8)}…</span>,
    },
    {
      key: 'scheduledAt',
      title: 'Назначено',
      render: (r) => new Date(r.scheduledAt).toLocaleString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 140,
      render: (r) =>
        r.status === 'scheduled' || r.status === 'in_progress' ? (
          <Button variant="ghost" onClick={() => setCompleting(r.id)}>
            Завершить
          </Button>
        ) : (
          <span style={styles.muted}>—</span>
        ),
    },
  ];

  return (
    <Card
      title="Сессии"
      subtitle={`Всего ${sessions.length}`}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Назначить сессию
        </Button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<PsySession>
          data={sessions}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Сессий нет"
        />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Новая сессия">
          <Form<z.infer<typeof createSessionSchema>>
            schema={createSessionSchema}
            defaultValues={{
              participant_id: user?.participant.id ?? '',
              type: 'onboarding',
              scheduled_at: new Date().toISOString().slice(0, 16),
            }}
            submitLabel="Назначить"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/sessions', {
                participant_id: data.participant_id,
                type: data.type,
                scheduled_at: new Date(data.scheduled_at).toISOString(),
              });
              void qc.invalidateQueries({ queryKey: ['psy', 'sessions'] });
              setCreating(false);
            }}
          >
            <FormInput name="participant_id" label="UUID участника" required />
            <FormSelect
              name="type"
              label="Тип"
              options={(Object.keys(SESSION_TYPE_LABEL) as SessionType[]).map(
                (t) => ({ value: t, label: SESSION_TYPE_LABEL[t] }),
              )}
              required
            />
            <FormInput
              name="scheduled_at"
              label="Дата (YYYY-MM-DDTHH:MM)"
              placeholder="2026-10-20T14:00"
              required
            />
          </Form>
        </Modal>
      ) : null}

      {completing ? (
        <Modal onClose={() => setCompleting(null)} title="Завершить сессию">
          <Form<{ notes: string }>
            schema={z.object({ notes: z.string().max(10000) })}
            defaultValues={{ notes: '' }}
            submitLabel="Завершить"
            onCancel={() => setCompleting(null)}
            onSubmit={async (data) => {
              await apiPost(`/psy/sessions/${completing}/complete`, {
                notes: data.notes,
              });
              void qc.invalidateQueries({ queryKey: ['psy', 'sessions'] });
              setCompleting(null);
            }}
          >
            <FormTextarea name="notes" label="Заметки" rows={4} />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Observers ───────────────────────────────────────────────────

function ObserversTab(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const q = useApiQuery<{ data: PsyObserver[] }>(
    ['psy', 'observers'],
    '/psy/observers',
  );
  const observers = q.data?.data ?? [];

  const removeM = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/psy/observers/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['psy', 'observers'] }),
  });

  const columns: Column<PsyObserver>[] = [
    {
      key: 'participantId',
      title: 'Наблюдатель',
      render: (r) => <span style={styles.mono}>{r.participantId.slice(0, 12)}…</span>,
    },
    {
      key: 'directionId',
      title: 'Направление',
      render: (r) => <span style={styles.mono}>{r.directionId.slice(0, 12)}…</span>,
    },
    {
      key: 'validFrom',
      title: 'С',
      render: (r) => new Date(r.validFrom).toLocaleDateString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 80,
      render: (r) => (
        <Button
          variant="ghost"
          onClick={() => void removeM.mutateAsync(r.id)}
          disabled={removeM.isPending}
        >
          Снять
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Наблюдатели"
      subtitle={`Активных: ${observers.length} (один на направление, I.4.12)`}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Назначить
        </Button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<PsyObserver>
          data={observers}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Наблюдателей нет"
        />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Наблюдатель">
          <Form<z.infer<typeof createObserverSchema>>
            schema={createObserverSchema}
            defaultValues={{ participant_id: '', direction_id: '' }}
            submitLabel="Назначить"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/observers', data);
              void qc.invalidateQueries({ queryKey: ['psy', 'observers'] });
              setCreating(false);
            }}
          >
            <FormInput name="participant_id" label="UUID участника" required />
            <FormInput name="direction_id" label="UUID направления" required />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Crisis ──────────────────────────────────────────────────────

function CrisisTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);

  const q = useApiQuery<{ data: PsyCrisis[] }>(
    ['psy', 'crises'],
    '/psy/crises',
  );
  const crises = q.data?.data ?? [];

  const columns: Column<PsyCrisis>[] = [
    {
      key: 'participantId',
      title: 'Участник',
      render: (r) => <span style={styles.mono}>{r.participantId.slice(0, 12)}…</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => <Badge tone={CRISIS_STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: 'createdAt',
      title: 'Создан',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
    {
      key: 'closedAt',
      title: 'Закрыт',
      render: (r) =>
        r.closedAt ? new Date(r.closedAt).toLocaleString('ru-RU') : '—',
    },
    { key: 'notes', title: 'Заметки', render: (r) => r.notes ?? '—' },
  ];

  return (
    <Card
      title="Кризисы"
      subtitle={`Всего ${crises.length}`}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Открыть кризис
        </Button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<PsyCrisis>
          data={crises}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Кризисов нет"
        />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Новый кризис">
          <Form<z.infer<typeof crisisSchema>>
            schema={crisisSchema}
            defaultValues={{
              participant_id: user?.participant.id ?? '',
              notes: '',
            }}
            submitLabel="Открыть"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/crisis', data);
              void qc.invalidateQueries({ queryKey: ['psy', 'crises'] });
              setCreating(false);
            }}
          >
            <FormInput name="participant_id" label="UUID участника" required />
            <FormTextarea name="notes" label="Заметки" rows={3} />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Discharge ───────────────────────────────────────────────────

function DischargeTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);

  const q = useApiQuery<{ data: PsyDischarge[] }>(
    ['psy', 'discharges'],
    '/psy/discharges',
  );
  const discharges = q.data?.data ?? [];

  const columns: Column<PsyDischarge>[] = [
    {
      key: 'participantId',
      title: 'Участник',
      render: (r) => <span style={styles.mono}>{r.participantId.slice(0, 12)}…</span>,
    },
    { key: 'days', title: 'Дней', render: (r) => String(r.days) },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => <Badge tone="info">{r.status}</Badge>,
    },
    {
      key: 'createdAt',
      title: 'Назначено',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
    {
      key: 'completedAt',
      title: 'Завершено',
      render: (r) =>
        r.completedAt ? new Date(r.completedAt).toLocaleString('ru-RU') : '—',
    },
  ];

  return (
    <Card
      title="Рефлексивная разгрузка"
      subtitle="3–5 дней: 3 — пост-ПТТ, 5 — пост-Стальной Колокол (I.2.6)"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Назначить разгрузку
        </Button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<PsyDischarge>
          data={discharges}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Разгрузок нет"
        />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Разгрузка">
          <Form<z.infer<typeof dischargeSchema>>
            schema={dischargeSchema}
            defaultValues={{
              participant_id: user?.participant.id ?? '',
              days: 3,
            }}
            submitLabel="Назначить"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/reflective-discharge', data);
              void qc.invalidateQueries({ queryKey: ['psy', 'discharges'] });
              setCreating(false);
            }}
          >
            <FormInput name="participant_id" label="UUID участника" required />
            <FormInput
              name="days"
              label="Дней (3–5)"
              type="number"
              required
              description="Пост-ПТТ 3 дня, пост-Стальной Колокол 5 дней"
            />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Mood ────────────────────────────────────────────────────────

function MoodTab(): ReactElement {
  const [directionId, setDirectionId] = useState('');

  const collectiveQ = useApiQuery<{ data: MoodMetric[] }>(
    ['psy', 'mood', 'collective'],
    '/psy/mood/collective',
  );
  const singleQ = useApiQuery<MoodMetric>(
    ['psy', 'mood', directionId],
    `/psy/mood?direction_id=${directionId}`,
    { enabled: Boolean(directionId) },
  );

  return (
    <Card title="Коллективные настроения">
      <div style={styles.row}>
        <input
          style={styles.input}
          placeholder="UUID направления"
          value={directionId}
          onChange={(e) => setDirectionId(e.target.value)}
        />
      </div>

      {singleQ.data ? (
        <div style={styles.moodBox}>
          <div style={styles.moodLabel}>Метрика направления</div>
          {singleQ.data.hasData ? (
            <>
              <div style={styles.moodValue}>
                {(singleQ.data.value * 100).toFixed(1)}%
              </div>
              <ProgressBar value={singleQ.data.value * 100} max={100} />
              <div style={styles.moodHint}>
                Период: {singleQ.data.period}
              </div>
            </>
          ) : (
            <div style={styles.noData}>Нет данных за окно агрегации</div>
          )}
        </div>
      ) : null}

      <div style={styles.moodBox}>
        <div style={styles.moodLabel}>Все направления</div>
        {collectiveQ.isLoading ? (
          <Spinner />
        ) : (
          (collectiveQ.data?.data ?? []).map((m) => (
            <div key={m.id} style={styles.moodRow}>
              <span style={styles.mono}>{m.directionId.slice(0, 12)}…</span>
              {m.hasData ? (
                <span>{(m.value * 100).toFixed(1)}%</span>
              ) : (
                <span style={styles.muted}>нет данных</span>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ─── Resonance ───────────────────────────────────────────────────

function ResonanceTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);

  return (
    <Card
      title="Поиск резонанса"
      subtitle="Программа для участников на базовом поддерживающем уровне (V.1.6.2)"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Запустить
        </Button>
      }
    >
      <p style={styles.muted}>
        Программа длится 3 дня, интегрируется с разгрузкой. Назначение — только
        участникам, находящимся на базовом уровне.
      </p>

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Резонанс">
          <Form<z.infer<typeof resonanceSchema>>
            schema={resonanceSchema}
            defaultValues={{ participant_id: user?.participant.id ?? '' }}
            submitLabel="Запустить"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/resonance', data);
              void qc.invalidateQueries({ queryKey: ['psy'] });
              setCreating(false);
            }}
          >
            <FormInput name="participant_id" label="UUID участника" required />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Wellbeing ───────────────────────────────────────────────────

function WellbeingTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);
  const [directionId, setDirectionId] = useState('');

  const aggregateQ = useApiQuery<Wellbeing>(
    ['psy', 'wellbeing', 'aggregate', directionId],
    `/psy/wellbeing/aggregate${directionId ? `?direction_id=${directionId}` : ''}`,
  );

  return (
    <Card
      title="Благополучие"
      subtitle="Шкала 1–10, тренд по последним записям"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Записать
        </Button>
      }
    >
      <div style={styles.row}>
        <input
          style={styles.input}
          placeholder="UUID направления (опционально)"
          value={directionId}
          onChange={(e) => setDirectionId(e.target.value)}
        />
      </div>

      {aggregateQ.data ? (
        <div style={styles.wellbeingBox}>
          <div style={styles.wellbeingScore}>{aggregateQ.data.score}</div>
          <div style={styles.wellbeingLabel}>Средний балл</div>
          <Badge tone={TREND_TONE[aggregateQ.data.trend]}>
            {TREND_LABEL[aggregateQ.data.trend]}
          </Badge>
        </div>
      ) : null}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Записать состояние">
          <Form<z.infer<typeof wellbeingSchema>>
            schema={wellbeingSchema}
            defaultValues={{
              participant_id: user?.participant.id ?? '',
              score: 7,
            }}
            submitLabel="Записать"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/wellbeing', data);
              void qc.invalidateQueries({ queryKey: ['psy'] });
              setCreating(false);
            }}
          >
            <FormInput name="participant_id" label="UUID участника" required />
            <FormInput
              name="score"
              label="Оценка (1–10)"
              type="number"
              required
            />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Hygiene ─────────────────────────────────────────────────────

function HygieneTab(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const q = useApiQuery<{ data: Hygiene[] }>(['psy', 'hygiene'], '/psy/hygiene');
  const hygiene = q.data?.data ?? [];

  const columns: Column<Hygiene>[] = [
    {
      key: 'directionId',
      title: 'Направление',
      render: (r) => <span style={styles.mono}>{r.directionId.slice(0, 12)}…</span>,
    },
    { key: 'measure', title: 'Мера' },
    {
      key: 'status',
      title: 'Статус',
      render: (r) => <Badge tone="info">{r.status}</Badge>,
    },
    {
      key: 'createdAt',
      title: 'Предложено',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
  ];

  return (
    <Card
      title="Гигиена смыслов"
      subtitle="Предложения уровня направления (согласуется с Ноологией)"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Предложить меру
        </Button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<Hygiene>
          data={hygiene}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Предложений нет"
        />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Мера гигиены">
          <Form<z.infer<typeof hygieneSchema>>
            schema={hygieneSchema}
            defaultValues={{ direction_id: '', measure: '' }}
            submitLabel="Предложить"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/psy/hygiene', data);
              void qc.invalidateQueries({ queryKey: ['psy', 'hygiene'] });
              setCreating(false);
            }}
          >
            <FormInput name="direction_id" label="UUID направления" required />
            <FormTextarea name="measure" label="Мера" rows={4} required />
          </Form>
        </Modal>
      ) : null}
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
  },
  header: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
  },
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
  row: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    marginBottom: spacing.sm,
  },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    minWidth: 280,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: colors.textDim },
  moodBox: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 6,
    padding: spacing.md,
    background: colors.bgSoft,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  moodLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  moodValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 600,
  },
  moodRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  wellbeingBox: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 4,
    padding: spacing.lg,
    background: colors.bgSoft,
    borderRadius: radius.md,
  },
  wellbeingScore: {
    fontSize: 42,
    fontWeight: 700,
    color: colors.primary,
  },
  wellbeingLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
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
    maxWidth: 560,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
  },
  noData: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontStyle: 'italic' as const,
    padding: `${spacing.sm}px 0`,
  },
  moodHint: {
    color: colors.textDim,
    fontSize: fontSize.xs,
    marginTop: 4,
  },
};