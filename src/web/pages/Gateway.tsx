// F.4.02.16 — Gateway page.
/**
 * 8 табов: совет, сделки, активы, гарант, свидетели, оборона, самодостаточность, роспуск.
 * Все эндпоинты проходят через gatewayGuard (при info_blockade → 451).
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
import {
  Form, FormInput, FormTextarea, FormSelect,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useRights } from '../hooks/useRights';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type TxType = 'purchase' | 'sale' | 'diplomacy' | 'migration';
type TxStatus = 'pending' | 'approved' | 'completed' | 'rejected';
type AssetType = 'real_estate' | 'business' | 'finance';
type AssetStatus = 'accepted' | 'converting' | 'converted';
type GuarantorStatus = 'active' | 'expired' | 'removed';
type WitnessStatus = 'active' | 'inactive';


interface CouncilMember {
  id: string;
  memberId: string;
  validFrom: string;
  validTo: string;
  termNumber: number;
  createdAt: string;
}

interface Transaction {
  id: string;
  type: TxType;
  description: string;
  amountExternal: number | null;
  resourceType: string | null;
  approvedBy: string | null;
  auditedBy: string | null;
  classifiedUntil: string | null;
  status: TxStatus;
  createdAt: string;
  completedAt: string | null;
}

interface Asset {
  id: string;
  type: AssetType;
  value: number;
  status: AssetStatus;
  sourceParticipantId: string | null;
  verifiedBy: string | null;
  createdAt: string;
  convertedAt: string | null;
}

interface Guarantor {
  id: string;
  participantId: string;
  validFrom: string;
  validTo: string;
  diagnosis: Record<string, unknown>;
  status: GuarantorStatus;
  createdAt: string;
}

interface Witness {
  id: string;
  communityId: string;
  status: WitnessStatus;
  since: string;
  createdAt: string;
}

type Tab =
  | 'overview'
  | 'council'
  | 'transactions'
  | 'assets'
  | 'guarantor'
  | 'witnesses'
  | 'defense'
  | 'self'
  | 'dissolve';

// ─── Константы ───────────────────────────────────────────────────

const TX_TYPE_LABEL: Record<TxType, string> = {
  purchase: 'Закупка',
  sale: 'Продажа',
  diplomacy: 'Дипломатия',
  migration: 'Миграция',
};

const TX_STATUS_LABEL: Record<TxStatus, string> = {
  pending: 'Ожидает',
  approved: 'Одобрено',
  completed: 'Завершено',
  rejected: 'Отклонено',
};

const TX_STATUS_TONE: Record<TxStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'info',
  completed: 'success',
  rejected: 'danger',
};

const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  real_estate: 'Недвижимость',
  business: 'Бизнес',
  finance: 'Финансы',
};

const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  accepted: 'Принят',
  converting: 'Конвертируется',
  converted: 'Конвертирован',
};

const ASSET_STATUS_TONE: Record<AssetStatus, BadgeTone> = {
  accepted: 'info',
  converting: 'warning',
  converted: 'success',
};

const GUARANTOR_STATUS_LABEL: Record<GuarantorStatus, string> = {
  active: 'Активен',
  expired: 'Истёк',
  removed: 'Снят',
};

const GUARANTOR_STATUS_TONE: Record<GuarantorStatus, BadgeTone> = {
  active: 'success',
  expired: 'default',
  removed: 'warning',
};

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Обзор',
  council: 'Совет',
  transactions: 'Сделки',
  assets: 'Активы',
  guarantor: 'Гарант',
  witnesses: 'Свидетели',
  defense: 'Оборона',
  self: 'Самодостаточность',
  dissolve: 'Роспуск',
};

// ─── Страница ────────────────────────────────────────────────────

export function GatewayPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Шлюз</h1>
        <Badge tone="warning">Изолированный контур</Badge>
      </div>

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

      {tab === 'overview' ? <OverviewSection onOpenTab={setTab} /> : null}
      {tab === 'council' ? <CouncilSection /> : null}
      {tab === 'transactions' ? <TransactionsSection /> : null}
      {tab === 'assets' ? <AssetsSection /> : null}
      {tab === 'guarantor' ? <GuarantorSection /> : null}
      {tab === 'witnesses' ? <WitnessesSection /> : null}
      {tab === 'defense' ? <DefenseSection /> : null}
      {tab === 'self' ? <SelfSufficiencySection /> : null}
      {tab === 'dissolve' ? <DissolveSection /> : null}
    </div>
  );
}

// ─── Обзор ───────────────────────────────────────────────────────

function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Обзор Шлюза — первое, что должен видеть человек, открывший раздел.
 * Считается на клиенте из уже существующих списков: отдельный endpoint
 * «сводка» дублировал бы данные и расходился бы с ними.
 */
function OverviewSection({
  onOpenTab,
}: {
  onOpenTab: (t: Tab) => void;
}): ReactElement {
  const txQ = useApiQuery<{ data: Transaction[] }>(
    ['gateway', 'transactions', 'overview'],
    '/gateway/transactions',
  );
  const assetsQ = useApiQuery<{ data: Asset[] }>(
    ['gateway', 'assets', 'overview'],
    '/gateway/assets',
  );
  const selfQ = useApiQuery<{ canDissolve: boolean; reasons: string[] }>(
    ['gateway', 'self-sufficiency'],
    '/gateway/self-sufficiency',
  );

  const loading = txQ.isLoading || assetsQ.isLoading || selfQ.isLoading;
  const transactions = txQ.data?.data ?? [];
  const assets = assetsQ.data?.data ?? [];

  const total = (type: TxType): number =>
    transactions
      .filter(
        (t) =>
          t.type === type &&
          (t.status === 'approved' || t.status === 'completed'),
      )
      .reduce((acc, t) => acc + (t.amountExternal ?? 0), 0);

  const income = total('sale');
  const expense = total('purchase');
  const balance = income - expense;
  const pending = transactions.filter((t) => t.status === 'pending').length;
  const assetsValue = assets
    .filter((a) => a.status !== 'converted')
    .reduce((acc, a) => acc + a.value, 0);
  const converted = assets
    .filter((a) => a.status === 'converted')
    .reduce((acc, a) => acc + a.value, 0);

  const isEmpty = transactions.length === 0 && assets.length === 0;
  const canDissolve = selfQ.data?.canDissolve ?? false;

  return (
    <div style={styles.overview}>
      <div style={styles.banner}>
        <div style={styles.bannerTitle}>Что такое Шлюз</div>
        <div style={styles.bannerText}>
          Единственная точка контакта с внешним миром. Деньги и ресурсы не входят
          во внутренний контур напрямую: сначала сделка (продажа или закупка),
          затем одобрение, аудит и только потом — активы и Потоки. Поэтому здесь
          видны внешние суммы, а не внутренние балансы.
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div style={styles.kpiGrid}>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Доход</div>
              <div style={styles.kpiValue}>{money(income)}</div>
              <div style={styles.kpiHint}>продажи, одобренные и завершённые</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Расход</div>
              <div style={styles.kpiValue}>{money(expense)}</div>
              <div style={styles.kpiHint}>закупки, одобренные и завершённые</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Баланс</div>
              <div
                style={{
                  ...styles.kpiValue,
                  color: balance < 0 ? colors.danger : colors.text,
                }}
              >
                {money(balance)}
              </div>
              <div style={styles.kpiHint}>доход минус расход</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Активы</div>
              <div style={styles.kpiValue}>{money(assetsValue)}</div>
              <div style={styles.kpiHint}>
                приняты в контур{converted > 0 ? `, конвертировано ${money(converted)}` : ''}
              </div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Ждут решения</div>
              <div style={styles.kpiValue}>{pending}</div>
              <div style={styles.kpiHint}>сделки в статусе «Ожидает»</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Самодостаточность</div>
              <div style={styles.kpiValue}>
                <Badge tone={canDissolve ? 'success' : 'warning'}>
                  {canDissolve ? 'Готов' : 'Не готов'}
                </Badge>
              </div>
              <div style={styles.kpiHint}>
                условие роспуска: импорт &lt; 5% × 3 года (I.5.4.4)
              </div>
            </div>
          </div>

          {isEmpty ? (
            <Card
              title="Внешний контур пуст"
              subtitle="Продуктов наружу пока нет — Шлюз ждёт первую сделку"
            >
              <p style={styles.muted}>
                Это нормальное состояние на старте: контур есть, денег в нём ещё
                нет. Первая продажа появится, когда коллектив выпустит продукт
                для внешнего мира. Как только сделка появится, здесь будут
                доход, расход, баланс и очередь на одобрение — без ручных
                таблиц.
              </p>
              <div style={styles.actions}>
                <Button variant="primary" onClick={() => onOpenTab('transactions')}>
                  Создать сделку
                </Button>
                <Button variant="secondary" onClick={() => onOpenTab('assets')}>
                  Принять актив
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <Card
                title="Последние сделки"
                subtitle="Полный список — во вкладке «Сделки»"
              >
                <Table<Transaction>
                  data={transactions.slice(0, 5)}
                  columns={[
                    {
                      key: 'type',
                      title: 'Тип',
                      width: 120,
                      render: (r) => (
                        <Badge tone="info">{TX_TYPE_LABEL[r.type]}</Badge>
                      ),
                    },
                    {
                      key: 'description',
                      title: 'Описание',
                      render: (r) => (
                        <span style={styles.truncate}>
                          {r.description.slice(0, 70)}
                        </span>
                      ),
                    },
                    {
                      key: 'amount',
                      title: 'Сумма',
                      width: 120,
                      align: 'right',
                      render: (r) =>
                        r.amountExternal !== null
                          ? money(r.amountExternal)
                          : '—',
                    },
                    {
                      key: 'status',
                      title: 'Статус',
                      width: 130,
                      render: (r) => (
                        <Badge tone={TX_STATUS_TONE[r.status]}>
                          {TX_STATUS_LABEL[r.status]}
                        </Badge>
                      ),
                    },
                  ]}
                  getRowId={(r) => r.id}
                  emptyMessage="Сделок нет"
                />
                <div style={styles.actions}>
                  <Button variant="ghost" onClick={() => onOpenTab('transactions')}>
                    Все сделки
                  </Button>
                  <Button variant="ghost" onClick={() => onOpenTab('assets')}>
                    Активы
                  </Button>
                </div>
              </Card>

              {pending > 0 ? (
                <Card
                  title={`Требуют решения: ${pending}`}
                  subtitle="Одобрение и аудит — разные шаги, оба нужны"
                >
                  <div style={styles.actions}>
                    <Button onClick={() => onOpenTab('transactions')}>
                      Открыть очередь
                    </Button>
                  </div>
                </Card>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Совет ───────────────────────────────────────────────────────

function CouncilSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [adding, setAdding] = useState(false);

  const listQ = useApiQuery<{ data: CouncilMember[] }>(
    ['gateway', 'council'],
    '/gateway/council',
  );

  const columns: Column<CouncilMember>[] = [
    {
      key: 'memberId',
      title: 'Участник',
      render: (r) => <span style={styles.mono}>{r.memberId.slice(0, 8)}…</span>,
    },
    {
      key: 'termNumber',
      title: 'Срок',
      width: 80,
      align: 'center',
      render: (r) => `№${r.termNumber}`,
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
      render: (r) => new Date(r.validTo).toLocaleDateString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 120,
      render: (r) =>
        rights.hasRight('gateway', 'Dg') ? (
          <Button
            variant="ghost"
            onClick={async () => {
              await apiDelete(`/gateway/council/${r.memberId}`);
              void qc.invalidateQueries({ queryKey: ['gateway', 'council'] });
            }}
          >
            Ротировать
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title="Совет Шлюза"
      subtitle={`7 человек, мандат 5 лет (I.5.3.1). Не из Совета 14 (I.5.3.3). Всего: ${listQ.data?.data?.length ?? 0}/7`}
      actions={
        rights.hasRight('gateway', 'C') ? (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Назначить
          </Button>
        ) : undefined
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
            void qc.invalidateQueries({ queryKey: ['gateway', 'council'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const councilSchema = z.object({
  member_id: z.string().uuid('UUID участника'),
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

  const createM = useMutation({
    mutationFn: (data: CouncilForm) =>
      apiPost<CouncilMember>('/gateway/council', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый член Совета Шлюза">
        <Form<CouncilForm>
          schema={councilSchema}
          defaultValues={{ member_id: '' }}
          submitLabel="Назначить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="member_id" label="UUID участника" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Сделки ──────────────────────────────────────────────────────

function TransactionsSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const listQ = useApiQuery<{ data: Transaction[] }>(
    ['gateway', 'transactions', filterType, filterStatus],
    `/gateway/transactions${
      filterType || filterStatus
        ? `?${[
            filterType ? `type=${filterType}` : '',
            filterStatus ? `status=${filterStatus}` : '',
          ]
            .filter(Boolean)
            .join('&')}`
        : ''
    }`,
  );

  const approveM = useMutation({
    mutationFn: (id: string) =>
      apiPost<Transaction>(`/gateway/transactions/${id}/approve`, {}),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['gateway', 'transactions'] }),
  });
  const auditM = useMutation({
    mutationFn: (id: string) =>
      apiPost<Transaction>(`/gateway/transactions/${id}/audit`, {}),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['gateway', 'transactions'] }),
  });

  const columns: Column<Transaction>[] = [
    {
      key: 'type',
      title: 'Тип',
      width: 120,
      render: (r) => <Badge tone="info">{TX_TYPE_LABEL[r.type]}</Badge>,
    },
    {
      key: 'description',
      title: 'Описание',
      render: (r) => (
        <span style={styles.truncate}>{r.description.slice(0, 60)}…</span>
      ),
    },
    {
      key: 'amountExternal',
      title: 'Сумма',
      width: 120,
      align: 'right',
      render: (r) =>
        r.amountExternal !== null ? r.amountExternal.toFixed(2) : '—',
    },
    {
      key: 'status',
      title: 'Статус',
      width: 130,
      render: (r) => (
        <Badge tone={TX_STATUS_TONE[r.status]}>{TX_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    {
      key: 'flags',
      title: 'Флаги',
      width: 130,
      render: (r) => (
        <div style={styles.flags}>
          {r.approvedBy ? <span title="Одобрено">✓</span> : null}
          {r.auditedBy ? <span title="Аудит">🔍</span> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      title: '',
      width: 220,
      render: (r) => (
        <div style={styles.rowActions}>
          <Button
            variant="ghost"
            disabled={r.status !== 'pending' || approveM.isPending}
            onClick={() => void approveM.mutateAsync(r.id)}
          >
            Одобрить
          </Button>
          <Button
            variant="ghost"
            disabled={!!r.auditedBy || auditM.isPending}
            onClick={() => void auditM.mutateAsync(r.id)}
          >
            Аудит
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Сделки"
      subtitle="5 из 7 голосов + обязательный аудит Верификацией (I.2.7)"
      actions={
        <div style={styles.cardActions}>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={styles.select}
          >
            <option value="">Все типы</option>
            {(Object.keys(TX_TYPE_LABEL) as TxType[]).map((k) => (
              <option key={k} value={k}>{TX_TYPE_LABEL[k]}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(TX_STATUS_LABEL) as TxStatus[]).map((k) => (
              <option key={k} value={k}>{TX_STATUS_LABEL[k]}</option>
            ))}
          </select>
          {rights.hasRight('gateway', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Новая сделка
            </Button>
          ) : null}
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Transaction>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Сделок нет"
        />
      )}

      {creating ? (
        <CreateTransactionModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['gateway', 'transactions'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const txSchema = z.object({
  type: z.enum(['purchase', 'sale', 'diplomacy', 'migration']),
  description: z.string().min(1).max(5000),
  amount_external: z.coerce.number().positive().optional(),
  resource_type: z.string().max(128).optional(),
});

type TxForm = z.infer<typeof txSchema>;

function CreateTransactionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: TxForm) => {
      const body: Record<string, unknown> = {
        type: data.type,
        description: data.description,
      };
      if (data.amount_external !== undefined) {body['amount_external'] = data.amount_external;}
      if (data.resource_type) {body['resource_type'] = data.resource_type;}
      return apiPost<Transaction>('/gateway/transactions', body);
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новая сделка">
        <Form<TxForm>
          schema={txSchema}
          defaultValues={{
            type: 'purchase',
            description: '',
            amount_external: undefined,
            resource_type: '',
          }}
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
            options={(Object.keys(TX_TYPE_LABEL) as TxType[]).map((k) => ({
              value: k,
              label: TX_TYPE_LABEL[k],
            }))}
          />
          <FormTextarea name="description" label="Описание" rows={4} required maxLength={5000} />
          <FormInput name="amount_external" label="Сумма (внешняя)" type="number" />
          <FormInput name="resource_type" label="Тип ресурса (до 128 символов)" />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Активы ──────────────────────────────────────────────────────

function AssetsSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);

  const listQ = useApiQuery<{ data: Asset[] }>(
    ['gateway', 'assets'],
    '/gateway/assets',
  );

  const convertM = useMutation({
    mutationFn: (id: string) =>
      apiPost<Asset>(`/gateway/assets/${id}/convert`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['gateway', 'assets'] }),
  });

  const columns: Column<Asset>[] = [
    {
      key: 'type',
      title: 'Тип',
      width: 140,
      render: (r) => <Badge tone="info">{ASSET_TYPE_LABEL[r.type]}</Badge>,
    },
    {
      key: 'value',
      title: 'Стоимость',
      width: 130,
      align: 'right',
      render: (r) => r.value.toFixed(2),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 140,
      render: (r) => (
        <Badge tone={ASSET_STATUS_TONE[r.status]}>
          {ASSET_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'sourceParticipantId',
      title: 'Источник',
      render: (r) =>
        r.sourceParticipantId ? (
          <span style={styles.mono}>{r.sourceParticipantId.slice(0, 8)}…</span>
        ) : (
          <span style={styles.muted}>внешний</span>
        ),
    },
    {
      key: 'actions',
      title: '',
      width: 140,
      render: (r) =>
        r.status !== 'converted' && rights.hasRight('gateway', 'E') ? (
          <Button
            variant="ghost"
            disabled={convertM.isPending}
            onClick={() => void convertM.mutateAsync(r.id)}
          >
            Конвертировать
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title="Внешние активы"
      subtitle="Принимаются с обязательной Верификацией. Конвертируются в фонд Шлюза"
      actions={
        rights.hasRight('gateway', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Принять актив
          </Button>
        ) : undefined
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Asset>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Активов нет"
        />
      )}

      {creating ? (
        <AcceptAssetModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['gateway', 'assets'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const assetSchema = z.object({
  type: z.enum(['real_estate', 'business', 'finance']),
  value: z.coerce.number().positive(),
  source_participant_id: z.string().uuid().optional(),
});

type AssetForm = z.infer<typeof assetSchema>;

function AcceptAssetModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: AssetForm) => {
      const body: Record<string, unknown> = {
        type: data.type,
        value: data.value,
      };
      if (data.source_participant_id) {body['source_participant_id'] = data.source_participant_id;}
      return apiPost<Asset>('/gateway/assets', body);
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый внешний актив">
        <Form<AssetForm>
          schema={assetSchema}
          defaultValues={{
            type: 'finance',
            value: 1000,
            source_participant_id: undefined,
          }}
          submitLabel="Принять"
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
            options={(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((k) => ({
              value: k,
              label: ASSET_TYPE_LABEL[k],
            }))}
          />
          <FormInput name="value" label="Стоимость" type="number" required />
          <FormInput
            name="source_participant_id"
            label="UUID источника (опционально)"
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Гарант ──────────────────────────────────────────────────────

function GuarantorSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [appointing, setAppointing] = useState(false);

  const gQ = useApiQuery<{ data: Guarantor | null }>(
    ['gateway', 'guarantor'],
    '/gateway/guarantor',
  );

  const expireM = useMutation({
    mutationFn: () => apiDelete('/gateway/guarantor'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['gateway', 'guarantor'] }),
  });

  return (
    <Card
      title="Гарант Перехода"
      subtitle="5 лет без переизбрания. Полная диагностика обязательна (I.5.4.7)"
      actions={
        rights.hasRight('gateway', 'C') ? (
          <Button variant="primary" onClick={() => setAppointing(true)}>
            + Назначить
          </Button>
        ) : undefined
      }
    >
      {gQ.isLoading ? (
        <Spinner />
      ) : !gQ.data?.data ? (
        <p style={styles.muted}>Гарант не назначен</p>
      ) : (
        <>
          <div style={styles.detailMeta}>
            <span>
              Участник:{' '}
              <span style={styles.mono}>
                {gQ.data.data.participantId.slice(0, 8)}…
              </span>
            </span>
            <Badge tone={GUARANTOR_STATUS_TONE[gQ.data.data.status]}>
              {GUARANTOR_STATUS_LABEL[gQ.data.data.status]}
            </Badge>
          </div>
          <div style={styles.detailMeta}>
            <span>
              С {new Date(gQ.data.data.validFrom).toLocaleDateString('ru-RU')} по{' '}
              {new Date(gQ.data.data.validTo).toLocaleDateString('ru-RU')}
            </span>
          </div>
          <div style={styles.subBlock}>
            <div style={styles.subBlockTitle}>Диагностика</div>
            <pre style={styles.pre}>
              {JSON.stringify(gQ.data.data.diagnosis, null, 2)}
            </pre>
          </div>
          {gQ.data.data.status === 'active' && rights.hasRight('gateway', 'Dg') ? (
            <div style={styles.actions}>
              <Button
                variant="danger"
                disabled={expireM.isPending}
                onClick={() => void expireM.mutateAsync()}
              >
                {expireM.isPending ? '…' : 'Снять досрочно'}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {appointing ? (
        <AppointGuarantorModal
          onClose={() => setAppointing(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['gateway', 'guarantor'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const guarantorSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  diagnosis_text: z.string().min(1, 'Диагностика обязательна'),
});

type GuarantorForm = z.infer<typeof guarantorSchema>;

function AppointGuarantorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: GuarantorForm) => {
      let diagnosis: Record<string, unknown>;
      try {
        diagnosis = JSON.parse(data.diagnosis_text) as Record<string, unknown>;
      } catch {
        diagnosis = { notes: data.diagnosis_text };
      }
      return apiPost<Guarantor>('/gateway/guarantor', {
        participant_id: data.participant_id,
        diagnosis,
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
      <Card title="Назначить Гаранта">
        <Form<GuarantorForm>
          schema={guarantorSchema}
          defaultValues={{
            participant_id: '',
            diagnosis_text: '{\n  "health": "ok",\n  "allegiance": "full"\n}',
          }}
          submitLabel="Назначить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="participant_id" label="UUID участника" required />
          <FormTextarea
            name="diagnosis_text"
            label="Диагностика (JSON или текст)"
            rows={5}
            required
            maxLength={5000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Свидетели ───────────────────────────────────────────────────

function WitnessesSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);

  const listQ = useApiQuery<{ data: Witness[] }>(
    ['gateway', 'witnesses'],
    '/gateway/witnesses',
  );

  const columns: Column<Witness>[] = [
    {
      key: 'communityId',
      title: 'Община',
      render: (r) => <span style={styles.mono}>{r.communityId.slice(0, 8)}…</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: 120,
      render: (r) => (
        <Badge tone={r.status === 'active' ? 'success' : 'default'}>
          {r.status === 'active' ? 'Активен' : 'Неактивен'}
        </Badge>
      ),
    },
    {
      key: 'since',
      title: 'С',
      width: 140,
      render: (r) => new Date(r.since).toLocaleDateString('ru-RU'),
    },
  ];

  const activeCount = (listQ.data?.data ?? []).filter(
    (w) => w.status === 'active',
  ).length;

  return (
    <Card
      title="Внешние Свидетели"
      subtitle={`Минимум 2 (I.5.6.1). Активных: ${activeCount}/2`}
      actions={
        rights.hasRight('gateway', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Установить
          </Button>
        ) : undefined
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Witness>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Свидетелей нет"
        />
      )}

      {creating ? (
        <EstablishWitnessModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['gateway', 'witnesses'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const witnessSchema = z.object({
  community_id: z.string().uuid('UUID общины'),
});

type WitnessForm = z.infer<typeof witnessSchema>;

function EstablishWitnessModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: WitnessForm) =>
      apiPost<Witness>('/gateway/witnesses', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый Свидетель">
        <Form<WitnessForm>
          schema={witnessSchema}
          defaultValues={{ community_id: '' }}
          submitLabel="Установить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="community_id" label="UUID общины" required />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Оборона ─────────────────────────────────────────────────────

function DefenseSection(): ReactElement {
  const rights = useRights();
  const [activating, setActivating] = useState(false);

  return (
    <Card
      title="Внешняя оборона"
      subtitle="Внешний / внутренний / глобальный Красный Контур"
      actions={
        rights.hasRight('gateway', 'C') ? (
          <Button variant="danger" onClick={() => setActivating(true)}>
            + Активировать
          </Button>
        ) : undefined
      }
    >
      <p style={styles.muted}>
        Список активных оборонительных действий в API отсутствует.
        Активация создаёт запись в `external_defense`.
      </p>

      {activating ? (
        <ActivateDefenseModal onClose={() => setActivating(false)} />
      ) : null}
    </Card>
  );
}

const defenseSchema = z.object({
  type: z.enum(['external', 'internal', 'global']),
  commander_id: z.string().uuid().optional(),
});

type DefenseForm = z.infer<typeof defenseSchema>;

function ActivateDefenseModal({ onClose }: { onClose: () => void }): ReactElement {
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createM = useMutation({
    mutationFn: (data: DefenseForm) => {
      const body: Record<string, unknown> = { type: data.type };
      if (data.commander_id) {body['commander_id'] = data.commander_id;}
      return apiPost('/gateway/defense', body);
    },
    onSuccess: () => {
      setSuccess(true);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  if (success) {
    return (
      <Modal onClose={onClose}>
        <Card title="Оборона активирована">
          <div style={styles.successBlock}>
            Запись создана в external_defense.
          </div>
          <div style={styles.actions}>
            <Button variant="primary" onClick={onClose}>Понятно</Button>
          </div>
        </Card>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <Card title="Активация обороны">
        <Form<DefenseForm>
          schema={defenseSchema}
          defaultValues={{ type: 'external', commander_id: undefined }}
          submitLabel="Активировать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormSelect
            name="type"
            label="Тип обороны"
            required
            options={[
              { value: 'external', label: 'Внешний Красный Контур' },
              { value: 'internal', label: 'Внутренний Красный Контур' },
              { value: 'global', label: 'Глобальный Красный Контур' },
            ]}
          />
          <FormInput name="commander_id" label="UUID командира (опционально)" />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Самодостаточность ───────────────────────────────────────────

function SelfSufficiencySection(): ReactElement {
  const selfQ = useApiQuery<{ canDissolve: boolean; reasons: string[] }>(
    ['gateway', 'self-sufficiency'],
    '/gateway/self-sufficiency',
  );

  return (
    <Card
      title="Самодостаточность"
      subtitle="Импорт < 5% × 3 года, замкнутый цикл (I.5.4.4)"
    >
      {selfQ.isLoading ? (
        <Spinner />
      ) : selfQ.data ? (
        <>
          <div style={styles.detailMeta}>
            <span>Статус:</span>
            {selfQ.data.canDissolve ? (
              <Badge tone="success">Готов к роспуску</Badge>
            ) : (
              <Badge tone="warning">Не готов</Badge>
            )}
          </div>
          {selfQ.data.reasons.length > 0 ? (
            <div style={styles.subBlock}>
              <div style={styles.subBlockTitle}>Причины</div>
              <ul style={styles.reasonsList}>
                {selfQ.data.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p style={styles.muted}>Нет данных</p>
      )}
    </Card>
  );
}

// ─── Роспуск ─────────────────────────────────────────────────────

function DissolveSection(): ReactElement {
  const rights = useRights();
  const [dissolving, setDissolving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dissolveM = useMutation({
    mutationFn: (reason: string) =>
      apiPost<{ dissolved: boolean }>('/gateway/dissolve', { reason }),
    onSuccess: () => setDissolving(false),
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Card
      title="Роспуск Шлюза"
      subtitle="2/3 Советов + Жюри (I.5.4.6). Передача функций по I.1.10.8.3"
    >
      <p style={styles.muted}>
        Роспуск выполняется только при подтверждённой самодостаточности.
        При попытке без неё сервис вернёт 409.
      </p>

      {rights.hasRight('gateway', 'A') ? (
        <div style={styles.actions}>
          <Button variant="danger" onClick={() => setDissolving(true)}>
            Роспуск
          </Button>
        </div>
      ) : (
        <p style={styles.muted}>Требуется право gateway:A</p>
      )}

      {dissolving ? (
        <Modal onClose={() => setDissolving(false)}>
          <Card title="Роспуск Шлюза">
            <DissolveForm
              onSubmit={(reason) => void dissolveM.mutateAsync(reason)}
              onCancel={() => setDissolving(false)}
              busy={dissolveM.isPending}
            />
          </Card>
        </Modal>
      ) : null}

      {err ? <div style={styles.error}>{err}</div> : null}
    </Card>
  );
}

const dissolveSchema = z.object({
  reason: z.string().min(1).max(2000),
});

type DissolveFormData = z.infer<typeof dissolveSchema>;

function DissolveForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <Form<DissolveFormData>
      schema={dissolveSchema}
      defaultValues={{ reason: '' }}
      submitLabel="Роспуск"
      cancelLabel="Отмена"
      onCancel={onCancel}
      loading={busy}
      onSubmit={async (data) => onSubmit(data.reason)}
    >
      <FormTextarea name="reason" label="Причина" rows={4} required maxLength={2000} />
    </Form>
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
  overview: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md },
  banner: {
    padding: spacing.md,
    borderRadius: radius.md,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  bannerTitle: { fontSize: fontSize.md, fontWeight: 600, color: colors.text },
  bannerText: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 1.6 },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: spacing.md,
  },
  kpiCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    border: `1px solid ${colors.borderSoft}`,
    background: colors.bgSoft,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  kpiLabel: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  kpiValue: { fontSize: 24, fontWeight: 600, color: colors.text },
  kpiHint: { fontSize: fontSize.xs, color: colors.textDim, lineHeight: 1.4 },
  header: {
    display: 'flex' as const, alignItems: 'center' as const,
    gap: spacing.md,
  },
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
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  mono: { fontFamily: 'monospace', fontSize: fontSize.xs, color: colors.text },
  truncate: {
    display: 'inline-block' as const, maxWidth: 340,
    overflow: 'hidden' as const, textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  rowActions: { display: 'flex' as const, gap: spacing.sm },
  flags: { display: 'flex' as const, gap: spacing.sm, fontSize: fontSize.sm },
  detailMeta: {
    display: 'flex' as const, gap: spacing.md,
    color: colors.textMuted, fontSize: fontSize.sm,
    flexWrap: 'wrap' as const, alignItems: 'center' as const,
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
  pre: {
    background: colors.bg, border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm, padding: spacing.sm, margin: 0,
    color: colors.text, fontSize: fontSize.xs, fontFamily: 'monospace',
    maxHeight: 300, overflow: 'auto' as const,
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
  },
  actions: {
    display: 'flex' as const, gap: spacing.sm,
    paddingTop: spacing.sm, marginTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
    flexWrap: 'wrap' as const,
  },
  reasonsList: {
    margin: 0, paddingLeft: spacing.lg,
    color: colors.textMuted, fontSize: fontSize.sm,
  },
  error: {
    color: colors.danger, fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6, padding: '8px 12px',
    marginTop: spacing.sm,
  },
  successBlock: {
    color: colors.text, fontSize: fontSize.sm,
    padding: spacing.md, marginBottom: spacing.md,
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: radius.md,
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