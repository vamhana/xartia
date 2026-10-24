// src/web/pages/Convergence.tsx
/**
 * F.4.02.20 — Панель Convergence.
 *
 * 4 таба: Планы / Обязательства / Культура / Аудит.
 * Master-detail в «Планах» по образцу Quanta.tsx / Signals.tsx.
 * Timeline этапов 0..5 (I.7.2, максимум 60 месяцев).
 *
 * Жизненный цикл: draft → declared → in_progress → completed.
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
import { Form, FormInput, FormSelect, FormTextarea } from '../components/ui/Form';
import { Map } from '../components/ui/Map';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type Tab = 'plans' | 'conversions' | 'culture' | 'audit';

type ConvergenceStatus =
  | 'draft' | 'declared' | 'in_progress' | 'completed' | 'failed';

type DebtType = 'external' | 'internal';
type DebtAction = 'annul' | 'convert';
type WeaponAction = 'utilize' | 'reserve' | 'energy';

interface ConvergencePlan {
  id: string;
  stateName: string;
  stage: number;
  status: ConvergenceStatus;
  coordinatorId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface ConvergenceCouncil {
  id: string;
  planId: string;
  members: Array<Record<string, unknown>>;
}

interface DebtConversion {
  id: string;
  planId: string;
  type: DebtType;
  amount: number;
  action: DebtAction;
  coefficient: number | null;
  createdAt: string;
}

interface AssetConversion {
  id: string;
  planId: string;
  assetType: string;
  value: number;
  destinationDirectionId: string;
  createdAt: string;
}

interface WeaponConversion {
  id: string;
  planId: string;
  weaponType: string;
  action: WeaponAction;
  verifiedBy: string | null;
  createdAt: string;
}

interface CulturalCenter {
  id: string;
  planId: string;
  location: { lat: number; lon: number };
  status: 'planned' | 'open' | 'closed';
  createdAt: string;
}

interface StageCriteriaResponse {
  canAdvance: boolean;
  missing: string[];
  nextStage: number;
}

// ─── Константы ───────────────────────────────────────────────────

const TAB_LABEL: Record<Tab, string> = {
  plans: 'Планы',
  conversions: 'Обязательства',
  culture: 'Культура',
  audit: 'Аудит',
};

const STATUS_LABEL: Record<ConvergenceStatus, string> = {
  draft: 'Черновик',
  declared: 'Декларация',
  in_progress: 'В работе',
  completed: 'Завершён',
  failed: 'Провален',
};

const STATUS_TONE: Record<ConvergenceStatus, BadgeTone> = {
  draft: 'default',
  declared: 'info',
  in_progress: 'warning',
  completed: 'success',
  failed: 'critical',
};

const STAGE_LABEL: Record<number, string> = {
  0: 'Декларация',
  1: 'Шлюз',
  2: 'Цифровизация',
  3: 'Социальная интеграция',
  4: 'Технологии',
  5: 'Роспуск Шлюза',
};

// ─── Схемы ───────────────────────────────────────────────────────

const createPlanSchema = z.object({
  state_name: z.string().min(1, 'Название обязательно').max(255),
});

const declarationSchema = z.object({
  signed_by: z.string().uuid('UUID подписанта'),
});

const councilSchema = z.object({
  members_json: z.string().min(2, 'Укажите JSON-массив участников'),
});

const debtsSchema = z.object({
  type: z.enum(['external', 'internal']),
  amount: z.coerce.number().positive('> 0'),
});

const assetsSchema = z.object({
  asset_type: z.string().min(1).max(64),
  value: z.coerce.number().positive('> 0'),
  destination_direction_id: z.string().uuid('UUID направления'),
});

const weaponsSchema = z.object({
  weapon_type: z.string().min(1).max(64),
  action: z.enum(['utilize', 'reserve', 'energy']),
});

const cultureSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

// ─── Страница ────────────────────────────────────────────────────

export function ConvergencePage(): ReactElement {
  const [tab, setTab] = useState<Tab>('plans');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Конвергенция</h1>
        <span style={styles.subtitle}>
          Переход внешнего государства (V.7). 5 этапов, максимум 60 месяцев.
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

      {tab === 'plans' && (
        <PlansTab
          selectedPlanId={selectedPlanId}
          onSelect={setSelectedPlanId}
        />
      )}
      {tab === 'conversions' && (
        <ConversionsTab
          selectedPlanId={selectedPlanId}
          onSelect={setSelectedPlanId}
        />
      )}
      {tab === 'culture' && (
        <CultureTab
          selectedPlanId={selectedPlanId}
          onSelect={setSelectedPlanId}
        />
      )}
      {tab === 'audit' && (
        <AuditTab
          selectedPlanId={selectedPlanId}
          onSelect={setSelectedPlanId}
        />
      )}
    </div>
  );
}

// ─── Хелпер выбора плана ────────────────────────────────────────

function PlanSelector({
  selectedPlanId,
  onSelect,
}: {
  selectedPlanId: string | null;
  onSelect: (id: string | null) => void;
}): ReactElement {
  const q = useApiQuery<{ data: ConvergencePlan[] }>(
    ['convergence', 'plans', 'for-select'],
    '/convergence/plans?page=1&per_page=100',
  );
  const plans = q.data?.data ?? [];

  return (
    <div style={styles.selectorRow}>
      <span style={styles.muted}>План:</span>
      <select
        value={selectedPlanId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        style={styles.select}
      >
        <option value="">— выберите —</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.stateName} · L{p.stage} · {STATUS_LABEL[p.status]}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Таб «Планы» (master-detail) ────────────────────────────────

function PlansTab({
  selectedPlanId,
  onSelect,
}: {
  selectedPlanId: string | null;
  onSelect: (id: string | null) => void;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const q = useApiQuery<{ data: ConvergencePlan[]; meta: { total: number } }>(
    ['convergence', 'plans', 'list', filterStatus],
    `/convergence/plans?page=1&per_page=100${filterStatus ? `&status=${filterStatus}` : ''}`,
  );
  const plans = q.data?.data ?? [];

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
            {(Object.keys(STATUS_LABEL) as ConvergenceStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          {rights.hasRight('convergence', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Создать план
            </Button>
          ) : null}
        </div>

        {q.isLoading ? (
          <Spinner />
        ) : plans.length === 0 ? (
          <div style={styles.empty}>Планов нет</div>
        ) : (
          plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => onSelect(plan.id)}
              style={{
                ...styles.listItem,
                ...(plan.id === selectedPlanId ? styles.listItemActive : {}),
              }}
            >
              <div style={styles.listItemTop}>
                <Badge tone={STATUS_TONE[plan.status]}>
                  {STATUS_LABEL[plan.status]}
                </Badge>
                <Badge tone="info">Этап {plan.stage}/5</Badge>
              </div>
              <div style={styles.listItemDesc}>{plan.stateName}</div>
              <div style={styles.listItemMeta}>
                <span style={styles.dim}>
                  {new Date(plan.startedAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
            </button>
          ))
        )}
      </aside>

      <section style={styles.detail}>
        {creating ? (
          <Modal onClose={() => setCreating(false)} title="Новый план конвергенции">
            <Form<z.infer<typeof createPlanSchema>>
              schema={createPlanSchema}
              defaultValues={{ state_name: '' }}
              submitLabel="Создать"
              onCancel={() => setCreating(false)}
              onSubmit={async (data) => {
                const created = await apiPost<ConvergencePlan>(
                  '/convergence/plans',
                  data,
                );
                void qc.invalidateQueries({ queryKey: ['convergence'] });
                setCreating(false);
                onSelect(created.id);
              }}
            >
              <FormInput
                name="state_name"
                label="Название государства"
                required
              />
            </Form>
          </Modal>
        ) : selectedPlanId ? (
          <ConvergenceStages planId={selectedPlanId} />
        ) : (
          <Card>
            <div style={styles.empty}>
              Выберите план слева или создайте новый
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

// ─── ConvergenceStages (timeline + действия) ───────────────────

export function ConvergenceStages({
  planId,
}: {
  planId: string;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [declaring, setDeclaring] = useState(false);
  const [creatingCouncil, setCreatingCouncil] = useState(false);
  const [completing, setCompleting] = useState(false);

  const planQ = useApiQuery<ConvergencePlan>(
    ['convergence', 'plan', planId],
    `/convergence/plans/${planId}`,
  );
  const criteriaQ = useApiQuery<StageCriteriaResponse>(
    ['convergence', 'plan', planId, 'criteria'],
    `/convergence/plans/${planId}/criteria`,
  );
  const councilQ = useApiQuery<{ council: ConvergenceCouncil | null }>(
    ['convergence', 'plan', planId, 'council'],
    `/convergence/plans/${planId}/council`,
  );
  const validationQ = useApiQuery<{ canComplete: boolean; reasons: string[] }>(
    ['convergence', 'plan', planId, 'validate'],
    `/convergence/plans/${planId}/validate-completion`,
  );

  const advanceM = useMutation({
    mutationFn: (stage: number) =>
      apiPost(`/convergence/plans/${planId}/stage/${stage}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['convergence'] }),
  });

  const plan = planQ.data;
  const criteria = criteriaQ.data;
  const council = councilQ.data?.council ?? null;
  const validation = validationQ.data;

  if (planQ.isLoading) {return <Spinner />;}
  if (!plan) {return <Card><div style={styles.empty}>План не найден</div></Card>;}

  const nextStage = plan.stage + 1;
  const canAdvance = criteria?.canAdvance ?? false;

  return (
    <>
      <Card
        title={
          <div style={styles.detailHeader}>
            <Badge tone={STATUS_TONE[plan.status]}>
              {STATUS_LABEL[plan.status]}
            </Badge>
            <Badge tone="info">Этап {plan.stage}/5</Badge>
          </div>
        }
        subtitle={`${plan.stateName} · начало ${new Date(plan.startedAt).toLocaleDateString('ru-RU')}`}
      >
        <StageTimeline currentStage={plan.stage} />

        <div style={styles.actions}>
          {plan.status === 'draft' && rights.hasRight('convergence', 'E') ? (
            <Button variant="primary" onClick={() => setDeclaring(true)}>
              Подписать декларацию
            </Button>
          ) : null}
          {!council && rights.hasRight('convergence', 'C') ? (
            <Button variant="secondary" onClick={() => setCreatingCouncil(true)}>
              Создать Совет (11)
            </Button>
          ) : null}
          {plan.stage < 5 && rights.hasRight('convergence', 'E') ? (
            <Button
              variant="primary"
              onClick={() => void advanceM.mutateAsync(nextStage)}
              disabled={!canAdvance || advanceM.isPending}
            >
              {advanceM.isPending
                ? '…'
                : `Перейти к этапу ${nextStage}: ${STAGE_LABEL[nextStage] ?? ''}`}
            </Button>
          ) : null}
          {validation?.canComplete && rights.hasRight('convergence', 'E') ? (
            <Button variant="primary" onClick={() => setCompleting(true)}>
              Завершить
            </Button>
          ) : null}
        </div>

        {!canAdvance && criteria?.missing && criteria.missing.length > 0 ? (
          <div style={styles.warningBox}>
            <div style={styles.warningLabel}>Не выполнено:</div>
            <ul style={styles.warningList}>
              {criteria.missing.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {validation && !validation.canComplete && validation.reasons.length > 0 ? (
          <div style={styles.warningBox}>
            <div style={styles.warningLabel}>Для завершения:</div>
            <ul style={styles.warningList}>
              {validation.reasons.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {council ? (
          <div style={styles.councilBox}>
            <div style={styles.councilLabel}>
              Совет конвергенции: {council.members.length} участников
            </div>
          </div>
        ) : null}
      </Card>

      {declaring ? (
        <Modal onClose={() => setDeclaring(false)} title="Подписать декларацию">
          <Form<z.infer<typeof declarationSchema>>
            schema={declarationSchema}
            defaultValues={{ signed_by: '' }}
            submitLabel="Подписать"
            onCancel={() => setDeclaring(false)}
            onSubmit={async (data) => {
              await apiPost(`/convergence/plans/${planId}/declaration`, data);
              void qc.invalidateQueries({ queryKey: ['convergence'] });
              setDeclaring(false);
            }}
          >
            <FormInput name="signed_by" label="UUID подписанта" required />
          </Form>
        </Modal>
      ) : null}

      {creatingCouncil ? (
        <Modal onClose={() => setCreatingCouncil(false)} title="Совет конвергенции">
          <Form<z.infer<typeof councilSchema>>
            schema={councilSchema}
            defaultValues={{
              members_json:
                '[\n  {"role":"SP-1"},\n  {"role":"SP-2"},\n  {"role":"SP-3"},\n  {"role":"DIR-1"},\n  {"role":"DIR-2"},\n  {"role":"DIR-3"},\n  {"role":"STATE-1"},\n  {"role":"STATE-2"},\n  {"role":"STATE-3"},\n  {"role":"AUDITOR-1"},\n  {"role":"AUDITOR-2"}\n]',
            }}
            submitLabel="Создать Совет"
            onCancel={() => setCreatingCouncil(false)}
            onSubmit={async (data) => {
              let members: Array<Record<string, unknown>>;
              try {
                members = JSON.parse(data.members_json) as Array<
                  Record<string, unknown>
                >;
              } catch {
                throw new Error('Некорректный JSON');
              }
              await apiPost(`/convergence/plans/${planId}/council`, {
                members,
              });
              void qc.invalidateQueries({ queryKey: ['convergence'] });
              setCreatingCouncil(false);
            }}
          >
            <FormTextarea
              name="members_json"
              label="Участники (JSON-массив, минимум 11)"
              rows={8}
              required
            />
          </Form>
        </Modal>
      ) : null}

      {completing ? (
        <Modal onClose={() => setCompleting(false)} title="Завершить конвергенцию">
          <p style={styles.muted}>
            Все 5 этапов пройдены. Подтвердите завершение.
          </p>
          <div style={styles.actions}>
            <Button
              variant="primary"
              onClick={async () => {
                await apiPost(`/convergence/plans/${planId}/complete`, {});
                void qc.invalidateQueries({ queryKey: ['convergence'] });
                setCompleting(false);
              }}
            >
              Завершить
            </Button>
            <Button variant="secondary" onClick={() => setCompleting(false)}>
              Отмена
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function StageTimeline({ currentStage }: { currentStage: number }): ReactElement {
  const stages = [0, 1, 2, 3, 4, 5];
  const percent = (currentStage / 5) * 100;
  return (
    <div style={styles.timeline}>
      <div style={styles.timelineBar}>
        {stages.map((s) => {
          const done = s < currentStage;
          const active = s === currentStage;
          return (
            <div key={s} style={styles.timelineNode}>
              <div
                style={{
                  ...styles.timelineDot,
                  ...(done ? styles.timelineDotDone : {}),
                  ...(active ? styles.timelineDotActive : {}),
                }}
              >
                {s}
              </div>
              <div style={styles.timelineLabel}>
                {STAGE_LABEL[s] ?? `Этап ${s}`}
              </div>
            </div>
          );
        })}
      </div>
      <ProgressBar value={percent} max={100} label={`Прогресс: ${currentStage}/5`} />
    </div>
  );
}

// ─── Таб «Обязательства» ────────────────────────────────────────

function ConversionsTab({
  selectedPlanId,
  onSelect,
}: {
  selectedPlanId: string | null;
  onSelect: (id: string | null) => void;
}): ReactElement {
  if (!selectedPlanId) {
    return (
      <Card title="Обязательства">
        <PlanSelector selectedPlanId={selectedPlanId} onSelect={onSelect} />
        <div style={styles.empty}>Выберите план для работы с конверсиями</div>
      </Card>
    );
  }
  return (
    <>
      <Card title="План">
        <PlanSelector selectedPlanId={selectedPlanId} onSelect={onSelect} />
      </Card>
      <ConversionPanel planId={selectedPlanId} />
    </>
  );
}

export function ConversionPanel({
  planId,
}: {
  planId: string;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [innerTab, setInnerTab] = useState<'debts' | 'assets' | 'weapons'>(
    'debts',
  );
  const [creating, setCreating] = useState(false);

  const debtsQ = useApiQuery<{ data: DebtConversion[] }>(
    ['convergence', 'plan', planId, 'debts'],
    `/convergence/plans/${planId}/debts`,
  );
  const assetsQ = useApiQuery<{ data: AssetConversion[] }>(
    ['convergence', 'plan', planId, 'assets'],
    `/convergence/plans/${planId}/assets`,
  );
  const weaponsQ = useApiQuery<{ data: WeaponConversion[] }>(
    ['convergence', 'plan', planId, 'weapons'],
    `/convergence/plans/${planId}/weapons`,
  );

  const debts = debtsQ.data?.data ?? [];
  const assets = assetsQ.data?.data ?? [];
  const weapons = weaponsQ.data?.data ?? [];

  const canCreate = rights.hasRight('convergence', 'C');

  const debtColumns: Column<DebtConversion>[] = [
    { key: 'type', title: 'Тип', width: 100, render: (r) => r.type },
    { key: 'amount', title: 'Сумма', width: 140, render: (r) => r.amount.toFixed(2) },
    { key: 'action', title: 'Действие', width: 120, render: (r) => r.action },
    {
      key: 'createdAt',
      title: 'Создано',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
  ];

  const assetColumns: Column<AssetConversion>[] = [
    { key: 'assetType', title: 'Тип актива', width: 160, render: (r) => r.assetType },
    { key: 'value', title: 'Стоимость', width: 140, render: (r) => r.value.toFixed(2) },
    {
      key: 'destinationDirectionId',
      title: 'Направление',
      render: (r) => <span style={styles.mono}>{r.destinationDirectionId.slice(0, 8)}…</span>,
    },
    {
      key: 'createdAt',
      title: 'Создано',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
  ];

  const weaponColumns: Column<WeaponConversion>[] = [
    { key: 'weaponType', title: 'Тип', width: 160, render: (r) => r.weaponType },
    { key: 'action', title: 'Действие', width: 120, render: (r) => r.action },
    {
      key: 'createdAt',
      title: 'Создано',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
  ];

  return (
    <Card
      title="Обязательства"
      subtitle="Конверсия долгов, активов и вооружений"
      actions={
        canCreate ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + {innerTab === 'debts' ? 'Долг' : innerTab === 'assets' ? 'Актив' : 'Вооружение'}
          </Button>
        ) : null
      }
    >
      <div style={styles.innerTabs}>
        {(['debts', 'assets', 'weapons'] as const).map((t) => (
          <button
            key={t}
            type="button"
            style={{
              ...styles.innerTab,
              ...(innerTab === t ? styles.innerTabActive : {}),
            }}
            onClick={() => setInnerTab(t)}
          >
            {t === 'debts' ? 'Долги' : t === 'assets' ? 'Активы' : 'Вооружения'}
          </button>
        ))}
      </div>

      {innerTab === 'debts' ? (
        <Table<DebtConversion>
          data={debts}
          columns={debtColumns}
          getRowId={(r) => r.id}
          emptyMessage="Конверсий долгов нет"
        />
      ) : null}
      {innerTab === 'assets' ? (
        <Table<AssetConversion>
          data={assets}
          columns={assetColumns}
          getRowId={(r) => r.id}
          emptyMessage="Конверсий активов нет"
        />
      ) : null}
      {innerTab === 'weapons' ? (
        <Table<WeaponConversion>
          data={weapons}
          columns={weaponColumns}
          getRowId={(r) => r.id}
          emptyMessage="Конверсий вооружений нет"
        />
      ) : null}

      {creating ? (
        <Modal
          onClose={() => setCreating(false)}
          title={
            innerTab === 'debts'
              ? 'Конверсия долга'
              : innerTab === 'assets'
                ? 'Конверсия актива'
                : 'Конверсия вооружения'
          }
        >
          {innerTab === 'debts' ? (
            <Form<z.infer<typeof debtsSchema>>
              schema={debtsSchema}
              defaultValues={{ type: 'external', amount: 0 }}
              submitLabel="Конвертировать"
              onCancel={() => setCreating(false)}
              onSubmit={async (data) => {
                await apiPost(`/convergence/plans/${planId}/debts`, data);
                void qc.invalidateQueries({ queryKey: ['convergence'] });
                setCreating(false);
              }}
            >
              <FormSelect
                name="type"
                label="Тип"
                options={[
                  { value: 'external', label: 'Внешний (аннулирование)' },
                  { value: 'internal', label: 'Внутренний (конвертация)' },
                ]}
                required
              />
              <FormInput name="amount" label="Сумма" type="number" required />
            </Form>
          ) : null}
          {innerTab === 'assets' ? (
            <Form<z.infer<typeof assetsSchema>>
              schema={assetsSchema}
              defaultValues={{
                asset_type: '',
                value: 0,
                destination_direction_id: '',
              }}
              submitLabel="Конвертировать"
              onCancel={() => setCreating(false)}
              onSubmit={async (data) => {
                await apiPost(`/convergence/plans/${planId}/assets`, data);
                void qc.invalidateQueries({ queryKey: ['convergence'] });
                setCreating(false);
              }}
            >
              <FormInput name="asset_type" label="Тип актива" required />
              <FormInput name="value" label="Стоимость" type="number" required />
              <FormInput
                name="destination_direction_id"
                label="UUID направления-получателя"
                required
              />
            </Form>
          ) : null}
          {innerTab === 'weapons' ? (
            <Form<z.infer<typeof weaponsSchema>>
              schema={weaponsSchema}
              defaultValues={{ weapon_type: '', action: 'utilize' }}
              submitLabel="Конвертировать"
              onCancel={() => setCreating(false)}
              onSubmit={async (data) => {
                await apiPost(`/convergence/plans/${planId}/weapons`, data);
                void qc.invalidateQueries({ queryKey: ['convergence'] });
                setCreating(false);
              }}
            >
              <FormInput name="weapon_type" label="Тип вооружения" required />
              <FormSelect
                name="action"
                label="Действие"
                options={[
                  { value: 'utilize', label: 'Утилизировать' },
                  { value: 'reserve', label: 'В резерв' },
                  { value: 'energy', label: 'В энергию' },
                ]}
                required
              />
            </Form>
          ) : null}
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Таб «Культура» ────────────────────────────────────────────

function CultureTab({
  selectedPlanId,
  onSelect,
}: {
  selectedPlanId: string | null;
  onSelect: (id: string | null) => void;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);

  const centersQ = useApiQuery<{ data: CulturalCenter[] }>(
    ['convergence', 'plan', selectedPlanId ?? '', 'culture'],
    `/convergence/plans/${selectedPlanId ?? ''}/culture`,
    { enabled: Boolean(selectedPlanId) },
  );
  const centers = centersQ.data?.data ?? [];

  if (!selectedPlanId) {
    return (
      <Card title="Культурные центры">
        <PlanSelector selectedPlanId={selectedPlanId} onSelect={onSelect} />
        <div style={styles.empty}>Выберите план для работы с культурой</div>
      </Card>
    );
  }

  const markers = centers.map((c) => ({
    id: c.id,
    lat: c.location.lat,
    lon: c.location.lon,
    label: `Центр ${c.id.slice(0, 6)} · ${c.status}`,
    type: 'community' as const,
  }));

  return (
    <>
      <Card title="План">
        <PlanSelector selectedPlanId={selectedPlanId} onSelect={onSelect} />
      </Card>

      <Card
        title="Культурные центры"
        subtitle={`Всего ${centers.length}`}
        actions={
          rights.hasRight('convergence', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Создать центр
            </Button>
          ) : null
        }
      >
        {centers.length === 0 ? (
          <div style={styles.empty}>Центров нет</div>
        ) : (
          <Map
            center={
              centers[0]
                ? [centers[0].location.lat, centers[0].location.lon]
                : [55.7558, 37.6173]
            }
            zoom={5}
            markers={markers}
            height={400}
            showUserLocation={false}
          />
        )}
      </Card>

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Новый культурный центр">
          <Form<z.infer<typeof cultureSchema>>
            schema={cultureSchema}
            defaultValues={{ lat: 55.7558, lon: 37.6173 }}
            submitLabel="Создать"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost(
                `/convergence/plans/${selectedPlanId}/culture`,
                data,
              );
              void qc.invalidateQueries({ queryKey: ['convergence'] });
              setCreating(false);
            }}
          >
            <FormInput name="lat" label="Широта (-90..90)" type="number" required />
            <FormInput name="lon" label="Долгота (-180..180)" type="number" required />
          </Form>
        </Modal>
      ) : null}
    </>
  );
}

// ─── Таб «Аудит» ────────────────────────────────────────────────

function AuditTab({
  selectedPlanId,
  onSelect,
}: {
  selectedPlanId: string | null;
  onSelect: (id: string | null) => void;
}): ReactElement {
  const rights = useRights();
  const [auditResult, setAuditResult] = useState<string[] | null>(null);

  const auditM = useMutation({
    mutationFn: (planId: string) =>
      apiPost<{ findings: string[] }>(
        `/convergence/plans/${planId}/audit`,
        {},
      ),
    onSuccess: (data) => setAuditResult(data.findings),
  });

  if (!selectedPlanId) {
    return (
      <Card title="Аудит">
        <PlanSelector selectedPlanId={selectedPlanId} onSelect={onSelect} />
        <div style={styles.empty}>Выберите план для аудита</div>
      </Card>
    );
  }

  return (
    <>
      <Card title="План">
        <PlanSelector selectedPlanId={selectedPlanId} onSelect={onSelect} />
      </Card>

      <Card
        title="Аудит прогресса"
        subtitle="Политическая процедура (I.7.7.4), запускается вручную Советом"
        actions={
          rights.hasRight('convergence', 'A') ? (
            <Button
              variant="primary"
              onClick={() => {
                setAuditResult(null);
                void auditM.mutateAsync(selectedPlanId);
              }}
              disabled={auditM.isPending}
            >
              {auditM.isPending ? '…' : 'Запустить аудит'}
            </Button>
          ) : null
        }
      >
        {auditM.isPending ? (
          <Spinner label="Аудит выполняется…" />
        ) : auditResult === null ? (
          <div style={styles.empty}>
            Нажмите «Запустить аудит», чтобы получить findings
          </div>
        ) : auditResult.length === 0 ? (
          <div style={styles.successBox}>Находок нет</div>
        ) : (
          <ul style={styles.warningList}>
            {auditResult.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
      </Card>
    </>
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
  innerTabs: {
    display: 'flex' as const,
    gap: 4,
    marginBottom: spacing.md,
  },
  innerTab: {
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    color: colors.textMuted,
    padding: '4px 12px',
    cursor: 'pointer' as const,
    fontSize: fontSize.sm,
    borderRadius: radius.sm,
    fontFamily: 'inherit',
  },
  innerTabActive: {
    background: colors.primary,
    color: '#fff',
    border: `1px solid ${colors.primary}`,
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
    fontWeight: 500,
  },
  listItemMeta: {
    display: 'flex' as const,
    gap: 6,
    fontSize: fontSize.xs,
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
  actions: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    marginTop: spacing.md,
  },
  filters: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    marginBottom: spacing.sm,
  },
  selectorRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
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
    minWidth: 220,
  },
  timeline: {
    marginBottom: spacing.md,
    padding: spacing.md,
    background: colors.bgSoft,
    borderRadius: radius.md,
  },
  timelineBar: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    marginBottom: spacing.md,
    gap: 4,
  },
  timelineNode: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 4,
    flex: 1,
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    background: colors.bgInput,
    color: colors.textMuted,
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    fontWeight: 600,
    fontSize: fontSize.sm,
  },
  timelineDotDone: {
    background: colors.success,
    color: '#fff',
  },
  timelineDotActive: {
    background: colors.primary,
    color: '#fff',
    boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)',
  },
  timelineLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  warningBox: {
    padding: spacing.sm,
    background: 'rgba(234, 179, 8, 0.1)',
    border: `1px solid ${colors.warning ?? '#eab308'}`,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  warningLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  warningList: {
    margin: 0,
    paddingLeft: 20,
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.6,
  },
  successBox: {
    padding: spacing.md,
    background: 'rgba(34, 197, 94, 0.1)',
    border: `1px solid ${colors.success}`,
    borderRadius: radius.sm,
    color: colors.success,
    fontSize: fontSize.sm,
    textAlign: 'center' as const,
  },
  councilBox: {
    padding: spacing.sm,
    background: 'rgba(59, 130, 246, 0.08)',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  councilLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: colors.textDim },
  dim: { color: colors.textDim, fontSize: fontSize.xs },
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