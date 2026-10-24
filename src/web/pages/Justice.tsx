// F.4.02.13 — Justice page.
/**
 * Панель Правозащиты. 5 табов: заявления, расследования, изоляция,
 * санкции, права жертвы. Плюс Красный Контур и not-imputable.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { apiPost, apiDelete } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import {
  Form,
  FormInput,
  FormTextarea,
  FormSelect,
  FormCheckbox,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';


// ─── Типы ────────────────────────────────────────────────────────

type ComplaintType = 'violence' | 'threat' | 'coercion' | 'harassment';
type ComplaintStatus = 'filed' | 'investigation' | 'closed';
type InvestigationStatus = 'open' | 'in_progress' | 'closed';
type SanctionType =
  | 'restorative_talk' | 'temporary_isolation' | 'resocialization'
  | 'exclusion' | 'not_imputable';
type SanctionStatus = 'imposed' | 'served' | 'appealed' | 'revoked';

interface Complaint {
  id: string;
  type: ComplaintType;
  applicantId: string | null;
  anonymous: boolean;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
}

interface Investigation {
  id: string;
  complaintId: string;
  investigatorIds: string[];
  targetId: string;
  status: InvestigationStatus;
  deadline: string;
  result: string | null;
  victimRights: {
    anonymity: boolean;
    relocationProvided: boolean;
    psychologistAssigned: boolean;
    participation: boolean;
  };
  auditedBy: string | null;
  createdAt: string;
}

interface Sanction {
  id: string;
  targetId: string;
  type: SanctionType;
  basis: string;
  decidedBy: string;
  decidedAt: string;
  status: SanctionStatus;
}

type Tab = 'complaints' | 'investigations' | 'isolation' | 'sanctions' | 'victims';

// ─── Константы ───────────────────────────────────────────────────

const COMPLAINT_TYPE_LABEL: Record<ComplaintType, string> = {
  violence: 'Насилие',
  threat: 'Угроза',
  coercion: 'Принуждение',
  harassment: 'Домогательство',
};

const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  filed: 'Подано',
  investigation: 'Расследование',
  closed: 'Закрыто',
};

const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, BadgeTone> = {
  filed: 'warning',
  investigation: 'info',
  closed: 'success',
};

const INVESTIGATION_STATUS_LABEL: Record<InvestigationStatus, string> = {
  open: 'Открыто',
  in_progress: 'В работе',
  closed: 'Закрыто',
};

const INVESTIGATION_STATUS_TONE: Record<InvestigationStatus, BadgeTone> = {
  open: 'warning',
  in_progress: 'info',
  closed: 'success',
};

const SANCTION_TYPE_LABEL: Record<SanctionType, string> = {
  restorative_talk: 'Восстановительная беседа',
  temporary_isolation: 'Временная изоляция',
  resocialization: 'Ресоциализация',
  exclusion: 'Исключение',
  not_imputable: 'Необратимое отчуждение',
};

// ─── Страница ────────────────────────────────────────────────────

export function JusticePage(): ReactElement {
  const [tab, setTab] = useState<Tab>('complaints');

  useWSSubscription('regimes', (event) => {
    if (
      event === 'regime.activated' ||
      event === 'regime.deactivated' ||
      event === 'info_blockade.activated' ||
      event === 'info_blockade.lifted'
    ) {
      // Ничего не делаем — карточка режима показывается на /regimes.
      // Но если добавим индикатор режима в Layout — здесь можно будет
      // инвалидировать ['regimes'] и заголовок обновится.
      console.warn('justice: regime event', event);
    }
  });

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Правозащита</h1>

      <div style={styles.tabs}>
        <TabBtn active={tab === 'complaints'} onClick={() => setTab('complaints')}>
          Заявления
        </TabBtn>
        <TabBtn active={tab === 'investigations'} onClick={() => setTab('investigations')}>
          Расследования
        </TabBtn>
        <TabBtn active={tab === 'isolation'} onClick={() => setTab('isolation')}>
          Изоляция
        </TabBtn>
        <TabBtn active={tab === 'sanctions'} onClick={() => setTab('sanctions')}>
          Санкции
        </TabBtn>
        <TabBtn active={tab === 'victims'} onClick={() => setTab('victims')}>
          Права жертвы
        </TabBtn>
      </div>

      {tab === 'complaints' ? <ComplaintsSection /> : null}
      {tab === 'investigations' ? <InvestigationsSection /> : null}
      {tab === 'isolation' ? <IsolationSection /> : null}
      {tab === 'sanctions' ? <SanctionsSection /> : null}
      {tab === 'victims' ? <VictimsSection /> : null}
    </div>
  );
}

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

// ─── Заявления ───────────────────────────────────────────────────

function ComplaintsSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [pendingComplaintId, setPendingComplaintId] = useState<string | null>(null);

  const listQ = useApiQuery<{ data: Complaint[] }>(
    ['justice', 'complaints', filter],
    `/justice/complaints${filter ? `?status=${filter}` : ''}`,
  );

  const columns: Column<Complaint>[] = [
    {
      key: 'type',
      title: 'Тип',
      width: 140,
      render: (r) => (
        <Badge tone="info">{COMPLAINT_TYPE_LABEL[r.type] ?? r.type}</Badge>
      ),
    },
    {
      key: 'description',
      title: 'Описание',
      render: (r) => (
        <span style={styles.truncate}>{r.description.slice(0, 80)}…</span>
      ),
    },
    {
      key: 'applicantId',
      title: 'Заявитель',
      width: 150,
      render: (r) =>
        r.anonymous ? (
          <span style={styles.muted}>(анонимно)</span>
        ) : r.applicantId ? (
          <span style={styles.mono}>{r.applicantId.slice(0, 42)}…</span>
        ) : (
          <span style={styles.muted}>—</span>
        ),
    },
    {
      key: 'anonymous',
      title: 'Аноним',
      width: 90,
      align: 'center',
      render: (r) => (r.anonymous ? 'Да' : '—'),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 140,
      render: (r) => (
        <Badge tone={COMPLAINT_STATUS_TONE[r.status]}>
          {COMPLAINT_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      title: 'Подано',
      width: 140,
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
    // ↓ НОВАЯ КОЛОНКА: копировать UUID + начать расследование
    {
      key: 'actions',
      title: '',
      width: 180,
      render: (r) => (
        <div style={styles.rowActions}>
          <CopyIdButton id={r.id} />
          <Button
            variant="ghost"
            onClick={() => setPendingComplaintId(r.id)}
          >
            Расследовать
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Заявления"
      subtitle="Срок расследования — 14 дней (I.2.3). Запрет коллективной ответственности (I.2.4)"
      actions={
        <div style={styles.cardActions}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={styles.select}
          >
            <option value="">Все</option>
            {(Object.keys(COMPLAINT_STATUS_LABEL) as ComplaintStatus[]).map((s) => (
              <option key={s} value={s}>
                {COMPLAINT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Подать заявление
          </Button>
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Complaint>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Заявлений нет"
        />
      )}

      {creating ? (
        <CreateComplaintModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['justice', 'complaints'] });
          }}
        />
      ) : null}

      {pendingComplaintId ? (
        <CreateInvestigationModal
          prefillComplaintId={pendingComplaintId}
          onClose={() => setPendingComplaintId(null)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['justice'] });
          }}
        />
      ) : null}
    </Card>
  );
}

// ─── Кнопка «Копировать UUID» ───────────────────────────────────

function CopyIdButton({ id }: { id: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      style={{
        background: 'transparent',
        border: 'none',
        color: copied ? colors.success : colors.primary,
        cursor: 'pointer',
        fontSize: fontSize.xs,
        padding: 0,
      }}
    >
      {copied ? '✓' : 'ID'}
    </button>
  );
}

const complaintSchema = z.object({
  type: z.enum(['violence', 'threat', 'coercion', 'harassment']),
  description: z.string().min(1).max(10000),
  anonymous: z.boolean(),
});

type ComplaintForm = z.infer<typeof complaintSchema>;

function CreateComplaintModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: ComplaintForm) =>
      apiPost<Complaint>('/justice/complaints', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новое заявление">
        <Form<ComplaintForm>
          schema={complaintSchema}
          defaultValues={{ type: 'violence', description: '', anonymous: false }}
          submitLabel="Подать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormSelect
            name="type"
            label="Тип заявления"
            required
            options={(Object.keys(COMPLAINT_TYPE_LABEL) as ComplaintType[]).map(
              (k) => ({ value: k, label: COMPLAINT_TYPE_LABEL[k] }),
            )}
          />
          <FormTextarea
            name="description"
            label="Описание"
            rows={6}
            required
            maxLength={10000}
          />
          <FormCheckbox
            name="anonymous"
            label="Анонимно (применитель скрыт)"
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Расследования ───────────────────────────────────────────────

function InvestigationsSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const overdueQ = useApiQuery<{ data: Investigation[] }>(
    ['justice', 'investigations', 'overdue'],
    '/justice/investigations/overdue',
    { enabled: overdueOnly },
  );

  return (
    <Card
      title="Расследования"
      subtitle="Просрочки и продления. Процессуальный аудит — Верификация (I.2.8)"
      actions={
        <div style={styles.cardActions}>
          <Button
            variant={overdueOnly ? 'primary' : 'secondary'}
            onClick={() => setOverdueOnly((v) => !v)}
          >
            {overdueOnly ? 'Показать все' : 'Только просроченные'}
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Начать расследование
          </Button>
        </div>
      }
    >
      <InvestigationLookup />

      {overdueOnly ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Просроченные</div>
          {overdueQ.isLoading ? (
            <Spinner />
          ) : (overdueQ.data?.data?.length ?? 0) === 0 ? (
            <p style={styles.muted}>Нет просроченных</p>
          ) : (
            overdueQ.data?.data?.map((i) => (
              <InvestigationRow
                key={i.id}
                inv={i}
                onClose={() => setClosing(i.id)}
              />
            ))
          )}
        </div>
      ) : null}

      {creating ? (
        <CreateInvestigationModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['justice'] });
          }}
        />
      ) : null}

      {closing ? (
        <CloseInvestigationModal
          investigationId={closing}
          onClose={() => setClosing(null)}
        />
      ) : null}
    </Card>
  );
}

function InvestigationLookup(): ReactElement {
  const [id, setId] = useState('');
  const [openedId, setOpenedId] = useState<string | null>(null);

  return (
    <div style={styles.openRow}>
      <input
        style={styles.input}
        placeholder="UUID расследования (списка всех нет в API)"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={!id.trim()}
        onClick={() => setOpenedId(id.trim())}
      >
        Открыть
      </Button>
      {openedId ? (
        <InvestigationDetail
          investigationId={openedId}
          onClose={() => setOpenedId(null)}
        />
      ) : null}
    </div>
  );
}

function InvestigationRow({
  inv,
  onClose,
}: {
  inv: Investigation;
  onClose: () => void;
}): ReactElement {
  const overdue = new Date(inv.deadline).getTime() < Date.now();
  return (
    <div style={styles.invRow}>
      <span style={styles.invId}>{inv.id.slice(0, 8)}…</span>
      <Badge tone={INVESTIGATION_STATUS_TONE[inv.status]}>
        {INVESTIGATION_STATUS_LABEL[inv.status]}
      </Badge>
      <span
        style={{
          ...styles.invDeadline,
          color: overdue ? colors.danger : colors.textMuted,
        }}
      >
        {new Date(inv.deadline).toLocaleDateString('ru-RU')}
      </span>
      <Button variant="ghost" onClick={onClose}>
        Закрыть
      </Button>
    </div>
  );
}

function InvestigationDetail({
  investigationId,
  onClose,
}: {
  investigationId: string;
  onClose: () => void;
}): ReactElement {
  const invQ = useApiQuery<Investigation>(
    ['justice', 'investigation', investigationId],
    `/justice/investigations/${investigationId}`,
  );

  if (invQ.isLoading) {return <Spinner />;}
  if (!invQ.data) {
    return <p style={styles.muted}>Не найдено</p>;
  }

  const i = invQ.data;

  return (
    <div style={styles.subBlock}>
      <div style={styles.subBlockTitle}>Расследование {i.id.slice(0, 8)}…</div>
      <div style={styles.invMeta}>
        <span>Статус: </span>
        <Badge tone={INVESTIGATION_STATUS_TONE[i.status]}>
          {INVESTIGATION_STATUS_LABEL[i.status]}
        </Badge>
      </div>
      <div style={styles.invMeta}>
        <span>Target: {i.targetId.slice(0, 8)}…</span>
      </div>
      <div style={styles.invMeta}>
        <span>Следователей: {i.investigatorIds.length}</span>
      </div>
      <div style={styles.invMeta}>
        <span>Deadline: {new Date(i.deadline).toLocaleString('ru-RU')}</span>
      </div>
      <div style={styles.victimRightsRow}>
        <Badge tone={i.victimRights.anonymity ? 'success' : 'default'}>
          Анонимность
        </Badge>
        <Badge tone={i.victimRights.relocationProvided ? 'success' : 'default'}>
          Переселение
        </Badge>
        <Badge tone={i.victimRights.psychologistAssigned ? 'success' : 'default'}>
          Психолог
        </Badge>
        <Badge tone={i.victimRights.participation ? 'success' : 'default'}>
          Участие
        </Badge>
      </div>
      {i.result ? (
        <p style={styles.resultText}>{i.result}</p>
      ) : null}
      <Button variant="ghost" onClick={onClose}>Закрыть</Button>
    </div>
  );
}

const investigationSchema = z.object({
  complaint_id: z.string().uuid('UUID заявления'),
  target_id: z.string().uuid('UUID подозреваемого'),
  investigator_ids_text: z.string().optional(),
});

type InvestigationForm = z.infer<typeof investigationSchema>;

function CreateInvestigationModal({
  prefillComplaintId,
  onClose,
  onCreated,
}: {
  prefillComplaintId?: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: InvestigationForm) => {
      const ids = (data.investigator_ids_text ?? '')
        .split(/[,\s;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return apiPost<Investigation>('/justice/investigations', {
        complaint_id: data.complaint_id,
        target_id: data.target_id,
        ...(ids.length > 0 ? { investigator_ids: ids } : {}),
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
      <Card title="Новое расследование">
        <Form<InvestigationForm>
          schema={investigationSchema}
          defaultValues={{
            complaint_id: prefillComplaintId ?? '',
            target_id: '',
            investigator_ids_text: '',
          }}
          submitLabel="Начать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="complaint_id" label="UUID заявления" required />
          <FormInput
            name="target_id"
            label="UUID подозреваемого (копируйте из Паспорта участника)"
            required
          />
          <FormTextarea
            name="investigator_ids_text"
            label="UUID следователей (через запятую; по умолчанию — вы)"
            rows={2}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const closeInvSchema = z.object({
  result: z.string().min(1).max(10000),
});

type CloseInvForm = z.infer<typeof closeInvSchema>;

function CloseInvestigationModal({
  investigationId,
  onClose,
}: {
  investigationId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const closeM = useMutation({
    mutationFn: (data: CloseInvForm) =>
      apiPost<Investigation>(
        `/justice/investigations/${investigationId}/close`,
        data,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['justice'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Закрыть расследование">
        <Form<CloseInvForm>
          schema={closeInvSchema}
          defaultValues={{ result: '' }}
          submitLabel="Закрыть"
          onCancel={onClose}
          loading={closeM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await closeM.mutateAsync(data);
          }}
        >
          <FormTextarea
            name="result"
            label="Результат"
            rows={5}
            required
            maxLength={10000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Изоляция ────────────────────────────────────────────────────

function IsolationSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [lifting, setLifting] = useState(false);

  return (
    <Card
      title="Изоляция"
      subtitle="Базовые блага сохраняются (I.4.4). Условия обязательны"
      actions={
        <div style={styles.cardActions}>
          <Button variant="danger" onClick={() => setLifting(true)}>
            Снять изоляцию
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Наложить изоляцию
          </Button>
        </div>
      }
    >
      <p style={styles.muted}>
        Список активных изоляций в API не предусмотрен — работаем с UUID.
      </p>

      {creating ? (
        <CreateIsolationModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['justice'] });
          }}
        />
      ) : null}
      {lifting ? (
        <LiftIsolationModal
          onClose={() => setLifting(false)}
          onLifted={() => {
            void qc.invalidateQueries({ queryKey: ['justice'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const isolationSchema = z.object({
  target_id: z.string().uuid('UUID участника'),
  valid_to: z.string().min(1, 'Дата обязательна'),
  conditions_text: z.string().min(1, 'Условия обязательны'),
});

type IsolationForm = z.infer<typeof isolationSchema>;

function CreateIsolationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: IsolationForm) => {
      let conditions: Record<string, unknown>;
      try {
        conditions = JSON.parse(data.conditions_text) as Record<string, unknown>;
      } catch {
        conditions = { note: data.conditions_text };
      }
      return apiPost('/justice/isolation', {
        target_id: data.target_id,
        valid_to: data.valid_to,
        conditions,
      });
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  const defaultValidTo = new Date(Date.now() + 30 * 86400000).toISOString();

  return (
    <Modal onClose={onClose}>
      <Card title="Наложить изоляцию">
        <Form<IsolationForm>
          schema={isolationSchema}
          defaultValues={{
            target_id: '',
            valid_to: defaultValidTo,
            conditions_text: '{\n  "restrictions": ["контакты"]\n}',
          }}
          submitLabel="Наложить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="target_id" label="UUID участника" required />
          <FormInput
            name="valid_to"
            label="Действует до (YYYY-MM-DDTHH:MM:SS)"
            required
          />
          <FormTextarea
            name="conditions_text"
            label="Условия (JSON или текст)"
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

const liftIsolationSchema = z.object({
  id: z.string().uuid('UUID изоляции'),
  reason: z.string().min(1).max(1000),
});

type LiftIsolationForm = z.infer<typeof liftIsolationSchema>;

function LiftIsolationModal({
  onClose,
  onLifted,
}: {
  onClose: () => void;
  onLifted: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const liftM = useMutation({
    mutationFn: (data: LiftIsolationForm) =>
      apiDelete<void>(`/justice/isolation/${data.id}`, {
        reason: data.reason,
      }),
    onSuccess: () => {
      onLifted();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Снять изоляцию">
        <Form<LiftIsolationForm>
          schema={liftIsolationSchema}
          defaultValues={{ id: '', reason: '' }}
          submitLabel="Снять"
          onCancel={onClose}
          loading={liftM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await liftM.mutateAsync(data);
          }}
        >
          <FormInput name="id" label="UUID изоляции" required />
          <FormTextarea
            name="reason"
            label="Причина снятия"
            rows={3}
            required
            maxLength={1000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Санкции ─────────────────────────────────────────────────────

function SanctionsSection(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);
  const [notImputable, setNotImputable] = useState(false);
  const [redCircuit, setRedCircuit] = useState(false);

  return (
    <Card
      title="Санкции"
      subtitle="Санкции на участника + Красный Контур. Остальные контуры (Стальной Колокол, Инфоблокада, ПТТ) — на странице /regimes"
      actions={
        <div style={styles.cardActions}>
          <Button variant="danger" onClick={() => setRedCircuit(true)}>
            Активировать Красный Контур
          </Button>
          <Button variant="danger" onClick={() => setNotImputable(true)}>
            Not-imputable
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Наложить санкцию
          </Button>
        </div>
      }
    >
      <p style={styles.muted}>
        Список санкций в API не предусмотрен — работаем с UUID.
        Твоё направление: {user?.participant.directionId.slice(0, 8) ?? '—'}…
      </p>

      {creating ? (
        <CreateSanctionModal
          onClose={() => setCreating(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['justice'] })}
        />
      ) : null}
      {notImputable ? (
        <NotImputableModal onClose={() => setNotImputable(false)} />
      ) : null}
      {redCircuit ? (
        <RedCircuitModal onClose={() => setRedCircuit(false)} />
      ) : null}
    </Card>
  );
}

const sanctionSchema = z.object({
  target_id: z.string().uuid('UUID участника'),
  type: z.enum([
    'restorative_talk',
    'temporary_isolation',
    'resocialization',
    'exclusion',
    'not_imputable',
  ]),
  basis: z.string().min(1).max(2000),
});

type SanctionForm = z.infer<typeof sanctionSchema>;

function CreateSanctionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: SanctionForm) =>
      apiPost<Sanction>('/justice/sanctions', data),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новая санкция">
        <Form<SanctionForm>
          schema={sanctionSchema}
          defaultValues={{
            target_id: '',
            type: 'restorative_talk',
            basis: '',
          }}
          submitLabel="Наложить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="target_id" label="UUID участника" required />
          <FormSelect
            name="type"
            label="Тип санкции"
            required
            options={(Object.keys(SANCTION_TYPE_LABEL) as SanctionType[]).map(
              (k) => ({ value: k, label: SANCTION_TYPE_LABEL[k] }),
            )}
          />
          <FormTextarea
            name="basis"
            label="Основание"
            rows={4}
            required
            maxLength={2000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const notImputableSchema = z.object({
  target_id: z.string().uuid('UUID участника'),
  decision_ref: z.string().uuid('UUID сессии Жюри'),
});

type NotImputableForm = z.infer<typeof notImputableSchema>;

function NotImputableModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: NotImputableForm) =>
      apiPost<Sanction>('/justice/not-imputable', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['justice'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card
        title="Необратимое отчуждение"
        subtitle="Требуется 20 из 24 голосов Жюри + подтверждение Верификацией"
      >
        <Form<NotImputableForm>
          schema={notImputableSchema}
          defaultValues={{ target_id: '', decision_ref: '' }}
          submitLabel="Отчуждить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="target_id" label="UUID участника" required />
          <FormInput
            name="decision_ref"
            label="UUID сессии Жюри"
            required
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const redCircuitSchema = z.object({
  reason: z.string().min(1).max(2000),
});

type RedCircuitForm = z.infer<typeof redCircuitSchema>;

function RedCircuitModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const navigate = useNavigate(); // ← добавь импорт из 'react-router-dom'
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createM = useMutation({
    mutationFn: (data: RedCircuitForm) =>
      apiPost<{ regimeId: string | null; audit_id: string }>(
        '/justice/red-circuit',
        data,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['regimes'] });
      void qc.invalidateQueries({ queryKey: ['justice'] });
      setSuccess(true);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  if (success) {
    return (
      <Modal onClose={onClose}>
        <Card title="Красный Контур активирован">
          <div style={styles.successBlock}>
            Режим <strong>red_circuit</strong> активен.
            <br />
            Карточка появится на странице «Режимы», в шапке — индикатор режима.
          </div>
          <div style={styles.successActions}>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                navigate('/regimes');
              }}
            >
              Открыть Режимы
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </Card>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <Card
        title="Красный Контур"
        subtitle="Режим Правозащиты (I.3.10). Все Советы получат WS-событие."
      >
        <Form<RedCircuitForm>
          schema={redCircuitSchema}
          defaultValues={{ reason: '' }}
          submitLabel="Активировать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormTextarea
            name="reason"
            label="Причина"
            rows={4}
            required
            maxLength={2000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Права жертвы ────────────────────────────────────────────────

function VictimsSection(): ReactElement {
  const [participantId, setParticipantId] = useState('');
  const [opened, setOpened] = useState<string | null>(null);

  return (
    <Card
      title="Права жертвы"
      subtitle="Анонимность, переселение, психолог, участие (I.2.2)"
    >
      <div style={styles.openRow}>
        <input
          style={styles.input}
          placeholder="UUID участника"
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!participantId.trim()}
          onClick={() => setOpened(participantId.trim())}
        >
          Показать
        </Button>
      </div>
      {opened ? <VictimRightsView participantId={opened} /> : null}
    </Card>
  );
}

function VictimRightsView({
  participantId,
}: {
  participantId: string;
}): ReactElement {
  const q = useApiQuery<{
    anonymity: boolean;
    relocationProvided: boolean;
    psychologistAssigned: boolean;
    participation: boolean;
  }>(
    ['justice', 'victim-rights', participantId],
    `/justice/victim-rights/${participantId}`,
  );

  if (q.isLoading) {return <Spinner />;}
  if (!q.data) {return <p style={styles.muted}>Нет данных</p>;}

  return (
    <div style={styles.subBlock}>
      <div style={styles.subBlockTitle}>Права {participantId.slice(0, 8)}…</div>
      <div style={styles.victimRightsRow}>
        <RightBadge label="Анонимность" on={q.data.anonymity} />
        <RightBadge label="Переселение" on={q.data.relocationProvided} />
        <RightBadge label="Психолог" on={q.data.psychologistAssigned} />
        <RightBadge label="Участие" on={q.data.participation} />
      </div>
    </div>
  );
}

function RightBadge({ label, on }: { label: string; on: boolean }): ReactElement {
  return (
    <div style={styles.rightBadge}>
      <span>{label}</span>
      <Badge tone={on ? 'success' : 'default'}>{on ? 'Да' : 'Нет'}</Badge>
    </div>
  );
}

// ─── Общий Modal ─────────────────────────────────────────────────

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
  rowActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
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
    minWidth: 200,
    flex: 1,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  truncate: {
    display: 'inline-block' as const,
    maxWidth: 400,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  openRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    marginBottom: spacing.md,
    flexWrap: 'wrap' as const,
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
  subBlockTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  invRow: {
    display: 'flex' as const,
    gap: spacing.md,
    alignItems: 'center' as const,
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  invId: {
    fontFamily: 'monospace',
    color: colors.text,
    fontSize: fontSize.sm,
  },
  invDeadline: { fontSize: fontSize.xs, flex: 1 },
  invMeta: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    color: colors.text,
    fontSize: fontSize.sm,
    flexWrap: 'wrap' as const,
  },
  victimRightsRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
  },
  resultText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
    margin: 0,
  },
  rightBadge: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    padding: '4px 10px',
    background: colors.bgInput,
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    padding: '8px 12px',
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
  mono: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    color: colors.text,
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
  modal: { width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' as const },
};