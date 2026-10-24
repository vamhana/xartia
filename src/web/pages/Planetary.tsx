// F.4.02.19 — Planetary page.
/**
 * 8 табов: communities, council, bridges, plan, referendum, pulse, reserve, expansion.
 * Backend: A.1.27.01 (готов).
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
import { Chart, MetricCard } from '../components/ui/Chart';
import {
  Form,
  FormInput,
  FormTextarea,
  FormSelect,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type CommunityStatus = 'incubation' | 'active' | 'node' | 'center';
type CouncilMemberType = 'delegate' | 'expert' | 'guardian';
type BridgeStatus = 'active' | 'suspended';
type ReferendumType = 'convergence' | 'gateway_dissolve' | 'core';
type ReferendumStatus = 'initiated' | 'voting' | 'decided';

interface Community {
  id: string;
  code: string;
  name: string;
  status: CommunityStatus;
  level: number;
  motherCommunityId: string | null;
  protocolVersion: string;
  createdAt: string;
}

interface CouncilMember {
  id: string;
  memberId: string;
  communityId: string;
  validFrom: string;
  validTo: string | null;
  type: CouncilMemberType;
}

interface Bridge {
  id: string;
  communityA: string;
  communityB: string;
  coefficient: number;
  status: BridgeStatus;
  establishedAt: string;
  suspendedAt: string | null;
}

interface PlanetaryPlan {
  id: string;
  period: string;
  plan: Record<string, unknown>;
  approvedBy: string | null;
  createdAt: string;
}

interface Pulse {
  id: string;
  communityId: string;
  baseGoodsLevel: number;
  directionLoad: Record<string, number>;
  topSignals: unknown[];
  createdAt: string;
}

interface Reserve {
  totalVolume: number;
  distributed: number;
  available: number;
}

interface ExpansionConditions {
  allowed: boolean;
  reasons: string[];
  coordinationLevel: string;
}

type Tab =
  | 'communities'
  | 'council'
  | 'bridges'
  | 'plan'
  | 'referendum'
  | 'pulse'
  | 'reserve'
  | 'expansion';

// ─── Константы ───────────────────────────────────────────────────

const COMMUNITY_STATUS_LABEL: Record<CommunityStatus, string> = {
  incubation: 'Инкубация',
  active: 'Активна',
  node: 'Узел',
  center: 'Центр',
};

const COMMUNITY_STATUS_TONE: Record<CommunityStatus, BadgeTone> = {
  incubation: 'warning',
  active: 'success',
  node: 'info',
  center: 'master',
};

const COUNCIL_TYPE_LABEL: Record<CouncilMemberType, string> = {
  delegate: 'Делегат',
  expert: 'Эксперт',
  guardian: 'Страж',
};

const BRIDGE_STATUS_TONE: Record<BridgeStatus, BadgeTone> = {
  active: 'success',
  suspended: 'warning',
};

const REFERENDUM_TYPE_LABEL: Record<ReferendumType, string> = {
  convergence: 'Конвергенция',
  gateway_dissolve: 'Роспуск Шлюза',
  core: 'Ядро',
};

const REFERENDUM_STATUS_TONE: Record<ReferendumStatus, BadgeTone> = {
  initiated: 'warning',
  voting: 'info',
  decided: 'success',
};

// ─── Страница ────────────────────────────────────────────────────

export function PlanetaryPage(): ReactElement {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('communities');

  useWSSubscription('pulse', (event) => {
    if (
      event === 'pulse.community_update' ||
      event === 'community.created' ||
      event === 'community.status_changed' ||
      event === 'bridge.established' ||
      event === 'expansion.frozen'
    ) {
      void qc.invalidateQueries({ queryKey: ['planetary'] });
    }
  });

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Планетарный уровень</h1>

      <div style={styles.tabs}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <TabBtn key={t} active={tab === t} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </TabBtn>
        ))}
      </div>

      {tab === 'communities' ? <CommunitiesSection /> : null}
      {tab === 'council' ? <CouncilSection /> : null}
      {tab === 'bridges' ? <BridgesSection /> : null}
      {tab === 'plan' ? <PlanSection /> : null}
      {tab === 'referendum' ? <ReferendumSection /> : null}
      {tab === 'pulse' ? <PulseSection /> : null}
      {tab === 'reserve' ? <ReserveSection /> : null}
      {tab === 'expansion' ? <ExpansionSection /> : null}
    </div>
  );
}

const TAB_LABEL: Record<Tab, string> = {
  communities: 'Общины',
  council: 'Совет',
  bridges: 'Мосты',
  plan: 'План',
  referendum: 'Референдум',
  pulse: 'Пульс',
  reserve: 'Резерв',
  expansion: 'Расширение',
};

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...styles.tabBtn, ...(active ? styles.tabBtnActive : {}) }}
    >
      {children}
    </button>
  );
}

// ─── Общины ──────────────────────────────────────────────────────

function CommunitiesSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const listQ = useApiQuery<{ data: Community[] }>(
    ['planetary', 'communities', filter],
    `/planetary/communities${filter ? `?status=${filter}` : ''}`,
  );

  const columns: Column<Community>[] = [
    { key: 'code', title: 'Код', width: 80 },
    { key: 'name', title: 'Название', sortable: true },
    {
      key: 'status',
      title: 'Статус',
      width: 140,
      render: (r) => (
        <Badge tone={COMMUNITY_STATUS_TONE[r.status]}>
          {COMMUNITY_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    { key: 'level', title: 'Уровень', width: 80, align: 'center', sortable: true },
    {
      key: 'motherCommunityId',
      title: 'Мать',
      width: 140,
      render: (r) =>
        r.motherCommunityId ? (
          <span style={styles.mono}>{r.motherCommunityId.slice(0, 8)}…</span>
        ) : (
          <span style={styles.muted}>—</span>
        ),
    },
    { key: 'protocolVersion', title: 'Протокол', width: 100 },
    {
      key: 'createdAt',
      title: 'Создана',
      width: 140,
      render: (r) => new Date(r.createdAt).toLocaleDateString('ru-RU'),
    },
  ];

  return (
    <Card
      title="Общины"
      subtitle="Рождение общины: ≥500 чел, ≥5000 га, 3% резерва (I.7.1)"
      actions={
        <div style={styles.cardActions}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(COMMUNITY_STATUS_LABEL) as CommunityStatus[]).map((s) => (
              <option key={s} value={s}>
                {COMMUNITY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Создать общину
          </Button>
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Community>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Общин нет"
        />
      )}

      {creating ? (
        <CreateCommunityModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['planetary'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const communitySchema = z.object({
  code: z.string().regex(/^[А-Я]{2}$/, 'Две заглавные кириллические буквы'),
  name: z.string().min(1).max(255),
  mother_community_id: z.string().optional(),
});

type CommunityForm = z.infer<typeof communitySchema>;

function CreateCommunityModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CommunityForm) =>
      apiPost<Community>('/planetary/communities', {
        code: data.code,
        name: data.name,
        ...(data.mother_community_id
          ? { mother_community_id: data.mother_community_id }
          : {}),
      }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новая община">
        <Form<CommunityForm>
          schema={communitySchema}
          defaultValues={{ code: '', name: '', mother_community_id: '' }}
          submitLabel="Создать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="code" label="Код (2 буквы)" placeholder="АБ" required />
          <FormInput name="name" label="Название" required />
          <FormInput
            name="mother_community_id"
            label="UUID материнской общины (опционально)"
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Совет ───────────────────────────────────────────────────────

function CouncilSection(): ReactElement {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const listQ = useApiQuery<{ data: CouncilMember[] }>(
    ['planetary', 'council'],
    '/planetary/council',
  );

  const columns: Column<CouncilMember>[] = [
    {
      key: 'memberId',
      title: 'Участник',
      render: (r) => <span style={styles.mono}>{r.memberId.slice(0, 8)}…</span>,
    },
    {
      key: 'communityId',
      title: 'Община',
      render: (r) => <span style={styles.mono}>{r.communityId.slice(0, 8)}…</span>,
    },
    {
      key: 'type',
      title: 'Тип',
      width: 120,
      render: (r) => (
        <Badge tone="info">{COUNCIL_TYPE_LABEL[r.type]}</Badge>
      ),
    },
    {
      key: 'validFrom',
      title: 'С',
      width: 140,
      render: (r) => new Date(r.validFrom).toLocaleDateString('ru-RU'),
    },
    {
      key: 'validTo',
      title: 'До',
      width: 140,
      render: (r) =>
        r.validTo ? new Date(r.validTo).toLocaleDateString('ru-RU') : '—',
    },
  ];

  return (
    <Card
      title="Совет Протоколов"
      subtitle="Делегат — 3 года, эксперт/страж — 5 лет (I.6.3)"
      actions={
        <Button variant="primary" onClick={() => setAdding(true)}>
          + Назначить
        </Button>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<CouncilMember>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Совет пуст"
        />
      )}

      {adding ? (
        <AddCouncilModal
          onClose={() => setAdding(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['planetary', 'council'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const councilSchema = z.object({
  member_id: z.string().uuid('UUID участника'),
  community_id: z.string().uuid('UUID общины'),
  type: z.enum(['delegate', 'expert', 'guardian']),
});

type CouncilForm = z.infer<typeof councilSchema>;

function AddCouncilModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const addM = useMutation({
    mutationFn: (data: CouncilForm) =>
      apiPost<CouncilMember>('/planetary/council', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Член Совета Протоколов">
        <Form<CouncilForm>
          schema={councilSchema}
          defaultValues={{ member_id: '', community_id: '', type: 'delegate' }}
          submitLabel="Назначить"
          onCancel={onClose}
          loading={addM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await addM.mutateAsync(data);
          }}
        >
          <FormInput name="member_id" label="UUID участника" required />
          <FormInput name="community_id" label="UUID общины" required />
          <FormSelect
            name="type"
            label="Тип"
            required
            options={[
              { value: 'delegate', label: 'Делегат (3 года)' },
              { value: 'expert', label: 'Эксперт (5 лет)' },
              { value: 'guardian', label: 'Страж (5 лет)' },
            ]}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Мосты ───────────────────────────────────────────────────────

function BridgesSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const listQ = useApiQuery<{ data: Bridge[] }>(
    ['planetary', 'bridges'],
    '/planetary/bridges',
  );

  const columns: Column<Bridge>[] = [
    {
      key: 'communityA',
      title: 'A',
      render: (r) => <span style={styles.mono}>{r.communityA.slice(0, 8)}…</span>,
    },
    {
      key: 'communityB',
      title: 'B',
      render: (r) => <span style={styles.mono}>{r.communityB.slice(0, 8)}…</span>,
    },
    {
      key: 'coefficient',
      title: 'Коэф.',
      width: 100,
      align: 'right',
      render: (r) => r.coefficient.toFixed(2),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 130,
      render: (r) => (
        <Badge tone={BRIDGE_STATUS_TONE[r.status]}>{r.status}</Badge>
      ),
    },
    {
      key: 'establishedAt',
      title: 'Установлен',
      width: 140,
      render: (r) => new Date(r.establishedAt).toLocaleDateString('ru-RU'),
    },
  ];

  return (
    <Card
      title="Мосты Потоков"
      subtitle="Задержка > 5 сек блокирует расширение (I.7.3)"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Установить мост
        </Button>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Bridge>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Мостов нет"
        />
      )}

      {creating ? (
        <CreateBridgeModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['planetary', 'bridges'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const bridgeSchema = z.object({
  community_a: z.string().uuid('UUID общины A'),
  community_b: z.string().uuid('UUID общины B'),
  coefficient: z.coerce.number().positive('Положительное число'),
});

type BridgeForm = z.infer<typeof bridgeSchema>;

function CreateBridgeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: BridgeForm) =>
      apiPost<Bridge>('/planetary/bridges', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый мост">
        <Form<BridgeForm>
          schema={bridgeSchema}
          defaultValues={{ community_a: '', community_b: '', coefficient: 1.0 }}
          submitLabel="Установить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="community_a" label="UUID общины A" required />
          <FormInput name="community_b" label="UUID общины B" required />
          <FormInput
            name="coefficient"
            label="Коэффициент"
            type="number"
            required
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── План ────────────────────────────────────────────────────────

function PlanSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const planQ = useApiQuery<{ data: PlanetaryPlan | null }>(
    ['planetary', 'plan'],
    '/planetary/plan',
  );

  return (
    <Card
      title="Пятилетний план"
      subtitle="Энергетика, климат, продовольствие, образование"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          {planQ.data?.data ? 'Обновить план' : 'Создать план'}
        </Button>
      }
    >
      {planQ.isLoading ? (
        <Spinner />
      ) : !planQ.data?.data ? (
        <p style={styles.muted}>План не утверждён</p>
      ) : (
        <>
          <div style={styles.planMeta}>
            <span>Период: {planQ.data.data.period}</span>
            <span>
              Создан: {new Date(planQ.data.data.createdAt).toLocaleString('ru-RU')}
            </span>
            {planQ.data.data.approvedBy ? (
              <Badge tone="success">Утверждён</Badge>
            ) : (
              <Badge tone="warning">Не утверждён</Badge>
            )}
          </div>
          <pre style={styles.pre}>
            {JSON.stringify(planQ.data.data.plan ?? {}, null, 2)}
          </pre>
        </>
      )}

      {creating ? (
        <CreatePlanModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['planetary', 'plan'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const planSchema = z.object({
  period: z
    .string()
    .min(1, 'Укажите период')
    .max(32, 'Максимум 32 символа'),
  plan_text: z.string().min(1, 'Заполните план'),
});

type PlanForm = z.infer<typeof planSchema>;

function CreatePlanModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: PlanForm) => {
      let plan: Record<string, unknown>;
      try {
        plan = JSON.parse(data.plan_text) as Record<string, unknown>;
      } catch {
        plan = { text: data.plan_text };
      }
      return apiPost<PlanetaryPlan>('/planetary/plan', {
        period: data.period,
        plan,
      });
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Пятилетний план">
        <Form<PlanForm>
          schema={planSchema}
          defaultValues={{
            period: '2026-2031',
            plan_text: '{\n  "energy": "solar",\n  "climate": "net-zero"\n}',
          }}
          submitLabel="Сохранить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput
            name="period"
            label="Период (например, 2026-2031)"
            required
            description="До 32 символов"
          />
          <FormTextarea
            name="plan_text"
            label="План (JSON или текст)"
            rows={8}
            required
            maxLength={20000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Референдум ──────────────────────────────────────────────────

function ReferendumSection(): ReactElement {
  const [creating, setCreating] = useState(false);

  return (
    <Card
      title="Референдум"
      subtitle="Пороги 70% (конвергенция), 90% (ядро), 60% (роспуск Шлюза) (I.6.2–I.6.3)"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Создать референдум
        </Button>
      }
    >
      <p style={styles.muted}>
        Результаты и статус голосования отображаются на странице «Режимы» и в
        панели Совета Протоколов. Здесь — только создание.
      </p>

      {creating ? (
        <CreateReferendumModal onClose={() => setCreating(false)} />
      ) : null}
    </Card>
  );
}

const referendumSchema = z.object({
  type: z.enum(['convergence', 'gateway_dissolve', 'core']),
  threshold: z.coerce.number().int().min(0).max(100),
});

type ReferendumForm = z.infer<typeof referendumSchema>;

function CreateReferendumModal({
  onClose,
}: {
  onClose: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    type: ReferendumType;
    threshold: number;
    status: ReferendumStatus;
  } | null>(null);

  const createM = useMutation({
    mutationFn: (data: ReferendumForm) =>
      apiPost<{
        id: string;
        type: ReferendumType;
        threshold: number;
        status: ReferendumStatus;
      }>('/planetary/referendum', data),
    onSuccess: (r) => {
      setCreated(r);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  if (created) {
    return (
      <Modal onClose={onClose}>
        <Card title="Референдум создан">
          <div style={styles.successBlock}>
            ID: <span style={styles.mono}>{created.id}</span>
            <br />
            Тип: {REFERENDUM_TYPE_LABEL[created.type]}
            <br />
            Порог: {created.threshold}%
            <br />
            Статус: <Badge tone={REFERENDUM_STATUS_TONE[created.status]}>
              {created.status}
            </Badge>
          </div>
          <div style={styles.successActions}>
            <Button variant="primary" onClick={onClose}>Понятно</Button>
          </div>
        </Card>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <Card title="Новый референдум">
        <Form<ReferendumForm>
          schema={referendumSchema}
          defaultValues={{ type: 'convergence', threshold: 70 }}
          submitLabel="Создать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormSelect
            name="type"
            label="Тип"
            required
            options={(Object.keys(REFERENDUM_TYPE_LABEL) as ReferendumType[]).map(
              (k) => ({ value: k, label: REFERENDUM_TYPE_LABEL[k] }),
            )}
          />
          <FormInput
            name="threshold"
            label="Порог (%)"
            type="number"
            required
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Пульс ───────────────────────────────────────────────────────

function PulseSection(): ReactElement {
  const [communityId, setCommunityId] = useState('');

  const pulseQ = useApiQuery<{ data: Pulse[] }>(
    ['planetary', 'pulse', communityId],
    `/planetary/pulse${communityId ? `?community_id=${communityId}` : ''}`,
    { refetchInterval: 30_000 },
  );

  const pulses = pulseQ.data?.data ?? [];

  const chartData = pulses.map((p) => ({
    name: p.communityId.slice(0, 6),
    base: p.baseGoodsLevel,
    load: Object.values(p.directionLoad).reduce((s, v) => s + v, 0),
  }));

  return (
    <Card
      title="Пульс общин"
      subtitle="Live-обновление каждые 30 сек (WS: pulse.community_update)"
      actions={
        <div style={styles.cardActions}>
          <input
            style={styles.input}
            placeholder="UUID общины (опционально)"
            value={communityId}
            onChange={(e) => setCommunityId(e.target.value)}
          />
        </div>
      }
    >
      {pulseQ.isLoading ? (
        <Spinner />
      ) : pulses.length === 0 ? (
        <p style={styles.muted}>Нет данных пульса</p>
      ) : (
        <>
          <Chart
            type="bar"
            data={chartData}
            config={{
              xKey: 'name',
              series: [
                { key: 'base', label: 'Базовые блага' },
                { key: 'load', label: 'Суммарная нагрузка' },
              ],
            }}
            height={240}
          />
          <div style={styles.pulseList}>
            {pulses.map((p) => (
              <div key={p.id} style={styles.pulseRow}>
                <span style={styles.mono}>{p.communityId.slice(0, 8)}…</span>
                <span style={styles.muted}>
                  Блага: {p.baseGoodsLevel.toFixed(2)}
                </span>
                <span style={styles.muted}>
                  Загрузка:{' '}
                  {Object.values(p.directionLoad)
                    .reduce((s, v) => s + v, 0)
                    .toFixed(2)}
                </span>
                <span style={styles.muted}>
                  {new Date(p.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Резерв ──────────────────────────────────────────────────────

function ReserveSection(): ReactElement {
  const reserveQ = useApiQuery<Reserve>(['planetary', 'reserve'], '/planetary/reserve');

  return (
    <Card
      title="Планетарный Резерв"
      subtitle="3% от общего объёма Потоков (I.1.6)"
    >
      {reserveQ.isLoading ? (
        <Spinner />
      ) : !reserveQ.data ? (
        <p style={styles.muted}>Нет данных</p>
      ) : (
        <div style={styles.metricRow}>
          <MetricCard value={reserveQ.data.totalVolume} label="Всего" />
          <MetricCard value={reserveQ.data.distributed} label="Распределено" />
          <MetricCard value={reserveQ.data.available} label="Доступно" />
        </div>
      )}
    </Card>
  );
}

// ─── Расширение ──────────────────────────────────────────────────

function ExpansionSection(): ReactElement {
  const qc = useQueryClient();
  const [freezing, setFreezing] = useState(false);

  const condQ = useApiQuery<ExpansionConditions>(
    ['planetary', 'expansion', 'conditions'],
    '/planetary/expansion/conditions',
  );

  const freezeM = useMutation({
    mutationFn: (reason: string) =>
      apiPost('/planetary/expansion/freeze', { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['planetary'] });
      setFreezing(false);
    },
  });

  const unfreezeM = useMutation({
    mutationFn: () => apiPost('/planetary/expansion/unfreeze', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['planetary'] });
    },
  });

  return (
    <Card
      title="Расширение"
      subtitle="Задержка моста > 5 сек или отклонение стандартов > 10% блокируют расширение (I.7.3)"
    >
      {condQ.isLoading ? (
        <Spinner />
      ) : condQ.data ? (
        <>
          <div style={styles.condBlock}>
            <div>
              <strong>Статус:</strong>{' '}
              {condQ.data.allowed ? (
                <Badge tone="success">Разрешено</Badge>
              ) : (
                <Badge tone="danger">Заблокировано</Badge>
              )}
            </div>
            <div>
              <strong>Уровень координации:</strong> {condQ.data.coordinationLevel}
            </div>
            {condQ.data.reasons.length > 0 ? (
              <ul style={styles.reasonsList}>
                {condQ.data.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div style={styles.actions}>
            <Button variant="danger" onClick={() => setFreezing(true)}>
              Заморозить
            </Button>
            <Button
              variant="primary"
              onClick={() => void unfreezeM.mutateAsync()}
              disabled={unfreezeM.isPending}
            >
              Разморозить
            </Button>
          </div>

          {freezing ? (
            <FreezeInline
              onSubmit={(reason) => void freezeM.mutateAsync(reason)}
              onCancel={() => setFreezing(false)}
              busy={freezeM.isPending}
            />
          ) : null}
        </>
      ) : (
        <p style={styles.muted}>Нет данных</p>
      )}
    </Card>
  );
}

const freezeSchema = z.object({
  reason: z.string().min(1).max(2000),
});

type FreezeForm = z.infer<typeof freezeSchema>;

function FreezeInline({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <div style={styles.subBlock}>
      <Form<FreezeForm>
        schema={freezeSchema}
        defaultValues={{ reason: '' }}
        submitLabel="Заморозить"
        cancelLabel="Отмена"
        onCancel={onCancel}
        loading={busy}
        onSubmit={async (data) => onSubmit(data.reason)}
      >
        <FormTextarea
          name="reason"
          label="Причина заморозки"
          rows={3}
          required
          maxLength={2000}
        />
      </Form>
    </div>
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
    display: 'flex' as const,
    gap: 2,
    background: colors.bgSoft,
    padding: 4,
    borderRadius: radius.md,
    border: `1px solid ${colors.borderSoft}`,
    width: 'fit-content' as const,
    flexWrap: 'wrap' as const,
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    padding: '6px 14px',
    borderRadius: radius.sm,
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  },
  tabBtnActive: { background: colors.primary, color: '#fff' },
  cardActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
  },
  select: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
  },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    minWidth: 240,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  mono: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    color: colors.text,
  },
  metricRow: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: spacing.md,
  },
  planMeta: {
    display: 'flex' as const,
    gap: spacing.md,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
  },
  pre: {
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    padding: spacing.sm,
    margin: 0,
    color: colors.text,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    maxHeight: 400,
    overflow: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  pulseList: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    marginTop: spacing.md,
  },
  pulseRow: {
    display: 'grid' as const,
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: spacing.md,
    padding: '4px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
  },
  condBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    padding: spacing.md,
    background: colors.bgInput,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  reasonsList: {
    margin: 0,
    paddingLeft: spacing.lg,
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  actions: {
    display: 'flex' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  subBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    padding: spacing.md,
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    padding: '8px 12px',
  },
  successBlock: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.6,
    padding: spacing.md,
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  successActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    justifyContent: 'flex-end' as const,
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
  modal: { width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' as const },
};