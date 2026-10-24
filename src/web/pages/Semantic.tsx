// src/web/pages/Semantic.tsx
/**
 * F.4.02.21 — Semantic page.
 *
 * 5 разделов на табах: Drift, Alarms, Veto, Dictionary, Tools.
 * WS-подписка на semantic.* события.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost, apiPatch, apiDelete } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
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

type DriftStatus = 'new' | 'analyzed' | 'resolved';
type AlarmStatus = 'raised' | 'acknowledged' | 'escalated' | 'resolved';
type AlarmEscalation = 'council' | 'forum' | 'referendum';
type VetoType = 'semantic_guardian' | 'jury';
type VetoStatus = 'active' | 'lifted' | 'expired';

interface SemanticDrift {
  id: string;
  term: string;
  originalMeaning: string;
  detectedMeaning: string;
  severity: number;
  detectedBy: string | null;
  status: DriftStatus;
  resolvedAt: string | null;
  createdAt: string;
}

interface SemanticAlarm {
  id: string;
  driftId: string | null;
  priority: number;
  raisedBy: string;
  status: AlarmStatus;
  escalatedTo: AlarmEscalation | null;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface Veto {
  id: string;
  type: VetoType;
  decisionRef: string;
  reason: string;
  validFrom: string;
  validTo: string;
  status: VetoStatus;
  liftedAt: string | null;
  liftReason: string | null;
}

interface DictionaryTerm {
  id: string;
  term: string;
  definition: string;
  version: number;
  updatedAt: string;
}

type Tab = 'drift' | 'alarms' | 'veto' | 'dictionary' | 'tools';

// ─── Константы ───────────────────────────────────────────────────

const DRIFT_STATUS_LABEL: Record<DriftStatus, string> = {
  new: 'Новый',
  analyzed: 'Проанализирован',
  resolved: 'Решён',
};

const DRIFT_STATUS_TONE: Record<DriftStatus, BadgeTone> = {
  new: 'warning',
  analyzed: 'info',
  resolved: 'success',
};

const ALARM_STATUS_LABEL: Record<AlarmStatus, string> = {
  raised: 'Поднята',
  acknowledged: 'Принята',
  escalated: 'Эскалирована',
  resolved: 'Решена',
};

const ALARM_STATUS_TONE: Record<AlarmStatus, BadgeTone> = {
  raised: 'danger',
  acknowledged: 'warning',
  escalated: 'high',
  resolved: 'success',
};

const ESCALATION_LABEL: Record<AlarmEscalation, string> = {
  council: 'Совет',
  forum: 'Форум',
  referendum: 'Референдум',
};



function severityTone(s: number): BadgeTone {
  if (s >= 8) {return 'critical';}
  if (s >= 6) {return 'high';}
  if (s >= 4) {return 'standard';}
  return 'default';
}

// ─── Страница ────────────────────────────────────────────────────

export function SemanticPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('drift');

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Семантический Страж</h1>

      <div style={styles.tabs}>
        <TabBtn active={tab === 'drift'} onClick={() => setTab('drift')}>
          Дрейф
        </TabBtn>
        <TabBtn active={tab === 'alarms'} onClick={() => setTab('alarms')}>
          Тревоги
        </TabBtn>
        <TabBtn active={tab === 'veto'} onClick={() => setTab('veto')}>
          Вето
        </TabBtn>
        <TabBtn active={tab === 'dictionary'} onClick={() => setTab('dictionary')}>
          Словарь
        </TabBtn>
        <TabBtn active={tab === 'tools'} onClick={() => setTab('tools')}>
          Инструменты
        </TabBtn>
      </div>

      {tab === 'drift' ? <DriftSection /> : null}
      {tab === 'alarms' ? <AlarmsSection /> : null}
      {tab === 'veto' ? <VetoSection /> : null}
      {tab === 'dictionary' ? <DictionarySection /> : null}
      {tab === 'tools' ? <ToolsSection /> : null}
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
      style={{
        ...styles.tabBtn,
        ...(active ? styles.tabBtnActive : {}),
      }}
    >
      {children}
    </button>
  );
}

// ─── Drift ───────────────────────────────────────────────────────

function DriftSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const listQ = useApiQuery<{ data: SemanticDrift[]; meta: { total: number } }>(
    ['semantic', 'drift', filterStatus],
    `/semantic/drift?page=1&per_page=50${filterStatus ? `&status=${filterStatus}` : ''}`,
  );

  useWSSubscription('semantic', (event) => {
    if (event === 'semantic.drift') {
      void qc.invalidateQueries({ queryKey: ['semantic', 'drift'] });
    }
  });

  const columns: Column<SemanticDrift>[] = [
    {
      key: 'severity',
      title: 'Severity',
      width: 100,
      sortable: true,
      render: (r) => (
        <Badge tone={severityTone(r.severity)}>{String(r.severity)}</Badge>
      ),
    },
    { key: 'term', title: 'Термин', sortable: true },
    {
      key: 'originalMeaning',
      title: 'Исходное значение',
      render: (r) => (
        <span style={styles.truncate}>{r.originalMeaning.slice(0, 60)}…</span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 140,
      render: (r) => (
        <Badge tone={DRIFT_STATUS_TONE[r.status]}>
          {DRIFT_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      title: 'Создан',
      width: 140,
      render: (r) => new Date(r.createdAt).toLocaleDateString('ru-RU'),
    },
  ];

  return (
    <Card
      title="Семантический дрейф"
      subtitle={`Всего ${listQ.data?.meta?.total ?? 0}`}
      actions={
        <div style={styles.cardActions}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(DRIFT_STATUS_LABEL) as DriftStatus[]).map((s) => (
              <option key={s} value={s}>
                {DRIFT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Создать
          </Button>
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<SemanticDrift>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Дрейфов нет"
        />
      )}

      {creating ? (
        <CreateDriftModal onClose={() => setCreating(false)} />
      ) : null}
    </Card>
  );
}

const driftSchema = z.object({
  term: z.string().min(1, 'Укажите термин').max(255),
  original_meaning: z.string().min(1).max(5000),
  detected_meaning: z.string().min(1).max(5000),
  severity: z.coerce.number().int().min(1).max(10),
});

type DriftForm = z.infer<typeof driftSchema>;

function CreateDriftModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: DriftForm) =>
      apiPost<SemanticDrift>('/semantic/drift', {
        term: data.term,
        original_meaning: data.original_meaning,
        detected_meaning: data.detected_meaning,
        severity: data.severity,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'drift'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось создать'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый дрейф">
        <Form<DriftForm>
          schema={driftSchema}
          defaultValues={{
            term: '',
            original_meaning: '',
            detected_meaning: '',
            severity: 5,
          }}
          submitLabel="Создать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="term" label="Термин" required />
          <FormTextarea
            name="original_meaning"
            label="Исходное значение"
            rows={3}
            required
            maxLength={5000}
          />
          <FormTextarea
            name="detected_meaning"
            label="Обнаруженное значение"
            rows={3}
            required
            maxLength={5000}
          />
          <FormInput
            name="severity"
            label="Severity (1–10)"
            type="number"
            required
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Alarms ──────────────────────────────────────────────────────

function AlarmsSection(): ReactElement {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [escalating, setEscalating] = useState<string | null>(null);

  const listQ = useApiQuery<{ data: SemanticAlarm[] }>(
    ['semantic', 'alarms', filterStatus],
    `/semantic/alarms${filterStatus ? `?status=${filterStatus}` : ''}`,
  );

  useWSSubscription('semantic', (event) => {
    if (
      event === 'semantic.alarm' ||
      event === 'semantic.alarm_escalated'
    ) {
      void qc.invalidateQueries({ queryKey: ['semantic', 'alarms'] });
    }
  });

  const ackM = useMutation({
    mutationFn: (id: string) =>
      apiPost<SemanticAlarm>(`/semantic/alarm/${id}/acknowledge`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['semantic', 'alarms'] }),
  });

  const columns: Column<SemanticAlarm>[] = [
    {
      key: 'priority',
      title: 'Приоритет',
      width: 110,
      render: (r) => (
        <Badge tone={r.priority >= 9 ? 'critical' : r.priority >= 7 ? 'high' : 'standard'}>
          {String(r.priority)}
        </Badge>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 140,
      render: (r) => (
        <Badge tone={ALARM_STATUS_TONE[r.status]}>
          {ALARM_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'escalatedTo',
      title: 'Куда',
      width: 130,
      render: (r) =>
        r.escalatedTo ? ESCALATION_LABEL[r.escalatedTo] : '—',
    },
    {
      key: 'createdAt',
      title: 'Создана',
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 220,
      render: (r) => (
        <div style={styles.rowActions}>
          <Button
            variant="ghost"
            onClick={() => void ackM.mutateAsync(r.id)}
            disabled={ackM.isPending || r.status !== 'raised'}
          >
            Принять
          </Button>
          <Button
            variant="ghost"
            onClick={() => setEscalating(r.id)}
            disabled={r.status === 'resolved'}
          >
            Эскалировать
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Семантические тревоги"
      actions={
        <div style={styles.cardActions}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все</option>
            {(Object.keys(ALARM_STATUS_LABEL) as AlarmStatus[]).map((s) => (
              <option key={s} value={s}>
                {ALARM_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Поднять тревогу
          </Button>
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<SemanticAlarm>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Тревог нет"
        />
      )}

      {creating ? <CreateAlarmModal onClose={() => setCreating(false)} /> : null}
      {escalating ? (
        <EscalateAlarmModal
          alarmId={escalating}
          onClose={() => setEscalating(null)}
        />
      ) : null}
    </Card>
  );
}

const alarmSchema = z.object({
  drift_id: z.string().optional(),
});

type AlarmForm = z.infer<typeof alarmSchema>;

function CreateAlarmModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: AlarmForm) =>
      apiPost<SemanticAlarm>('/semantic/alarm', {
        drift_id: data.drift_id || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'alarms'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новая тревога">
        <Form<AlarmForm>
          schema={alarmSchema}
          defaultValues={{ drift_id: '' }}
          submitLabel="Поднять"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput
            name="drift_id"
            label="UUID дрейфа (опционально)"
            placeholder="Если тревога связана с конкретным дрейфом"
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const escalateSchema = z.object({
  to: z.enum(['council', 'forum', 'referendum']),
});

type EscalateForm = z.infer<typeof escalateSchema>;

function EscalateAlarmModal({
  alarmId,
  onClose,
}: {
  alarmId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const escalateM = useMutation({
    mutationFn: (data: EscalateForm) =>
      apiPost<SemanticAlarm>(`/semantic/alarm/${alarmId}/escalate`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'alarms'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Эскалация тревоги">
        <Form<EscalateForm>
          schema={escalateSchema}
          defaultValues={{ to: 'council' }}
          submitLabel="Эскалировать"
          onCancel={onClose}
          loading={escalateM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await escalateM.mutateAsync(data);
          }}
        >
          <FormSelect
            name="to"
            label="Куда"
            required
            options={(Object.keys(ESCALATION_LABEL) as AlarmEscalation[]).map(
              (k) => ({ value: k, label: ESCALATION_LABEL[k] }),
            )}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Veto ────────────────────────────────────────────────────────

function VetoSection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [lifting, setLifting] = useState<string | null>(null);

  // Нет GET /semantic/veto — только POST и DELETE. Списка нет.
  // Работаем через ручной ввод UUID (как в Archive/Jury).
  const [lookupId, setLookupId] = useState('');
  const [openedId, setOpenedId] = useState<string | null>(null);

  useWSSubscription('semantic', (event) => {
    if (event === 'semantic.veto' || event === 'semantic.veto_lifted') {
      void qc.invalidateQueries({ queryKey: ['semantic', 'veto'] });
    }
  });

  return (
    <Card
      title="Вето"
      subtitle="Срок действия — 3 дня (I.4.6.3). Списка нет — введите UUID"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Наложить вето
        </Button>
      }
    >
      <div style={styles.openRow}>
        <input
          style={styles.input}
          placeholder="UUID вето"
          value={lookupId}
          onChange={(e) => setLookupId(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!lookupId.trim()}
          onClick={() => setOpenedId(lookupId.trim())}
        >
          Открыть
        </Button>
      </div>

      {openedId ? (
        <VetoCheck
          vetoId={openedId}
          onLift={() => setLifting(openedId)}
          onClose={() => setOpenedId(null)}
        />
      ) : null}

      {creating ? (
        <CreateVetoModal onClose={() => setCreating(false)} />
      ) : null}

      {lifting ? (
        <LiftVetoModal
          vetoId={lifting}
          onClose={() => setLifting(null)}
        />
      ) : null}
    </Card>
  );
}

function VetoCheck({
  vetoId,
  onLift,
  onClose,
}: {
  vetoId: string;
  onLift: () => void;
  onClose: () => void;
}): ReactElement {
  // Нет GET /semantic/veto/:id — выводим только то, что знаем.
  // По спеке `A.1.29.01` есть только POST /semantic/veto и DELETE.
  return (
    <div style={styles.subBlock}>
      <div style={styles.subBlockTitle}>Вето {vetoId.slice(0, 8)}…</div>
      <p style={styles.muted}>
        Просмотр вето недоступен — в API нет GET /semantic/veto/:id (техдолг A.1.29.01).
      </p>
      <div style={styles.rowActions}>
        <Button variant="danger" onClick={onLift}>
          Снять вето
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </div>
  );
}

const vetoSchema = z.object({
  type: z.enum(['semantic_guardian', 'jury']),
  decision_ref: z.string().uuid('UUID решения'),
  reason: z.string().min(1).max(2000),
});

type VetoForm = z.infer<typeof vetoSchema>;

function CreateVetoModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: VetoForm) => apiPost<Veto>('/semantic/veto', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'veto'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новое вето">
        <Form<VetoForm>
          schema={vetoSchema}
          defaultValues={{
            type: 'semantic_guardian',
            decision_ref: '',
            reason: '',
          }}
          submitLabel="Наложить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormSelect
            name="type"
            label="Тип вето"
            required
            options={[
              { value: 'semantic_guardian', label: 'Семантический Страж' },
              { value: 'jury', label: 'Жюри' },
            ]}
          />
          <FormInput
            name="decision_ref"
            label="UUID решения"
            required
          />
          <FormTextarea
            name="reason"
            label="Причина"
            rows={3}
            required
            maxLength={2000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const liftVetoSchema = z.object({
  reason: z.string().min(1).max(2000),
});

type LiftVetoForm = z.infer<typeof liftVetoSchema>;

function LiftVetoModal({
  vetoId,
  onClose,
}: {
  vetoId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const liftM = useMutation({
    mutationFn: (data: LiftVetoForm) =>
      apiDelete<Veto>(`/semantic/veto/${vetoId}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'veto'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Снять вето">
        <Form<LiftVetoForm>
          schema={liftVetoSchema}
          defaultValues={{ reason: '' }}
          submitLabel="Снять"
          onCancel={onClose}
          loading={liftM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await liftM.mutateAsync(data);
          }}
        >
          <FormTextarea
            name="reason"
            label="Причина снятия"
            rows={3}
            required
            maxLength={2000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Dictionary ──────────────────────────────────────────────────

function DictionarySection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DictionaryTerm | null>(null);

  const listQ = useApiQuery<{ data: DictionaryTerm[] }>(
    ['semantic', 'dictionary'],
    '/semantic/dictionary',
  );

  const columns: Column<DictionaryTerm>[] = [
    { key: 'term', title: 'Термин', sortable: true },
    {
      key: 'definition',
      title: 'Определение',
      render: (r) => (
        <span style={styles.truncate}>{r.definition.slice(0, 80)}…</span>
      ),
    },
    {
      key: 'version',
      title: 'Версия',
      width: 90,
      align: 'center',
      sortable: true,
      render: (r) => `v${r.version}`,
    },
    {
      key: 'updatedAt',
      title: 'Обновлён',
      width: 140,
      render: (r) => new Date(r.updatedAt).toLocaleDateString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 100,
      render: (r) => (
        <Button variant="ghost" onClick={() => setEditing(r)}>
          Изменить
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Словарь терминов"
      subtitle={`Всего ${listQ.data?.data?.length ?? 0}`}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Новый термин
        </Button>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<DictionaryTerm>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Словарь пуст"
        />
      )}

      {creating ? <CreateTermModal onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <EditTermModal term={editing} onClose={() => setEditing(null)} />
      ) : null}

      {/* Чтобы TS не ругался на неиспользуемый qc */}
      <span style={{ display: 'none' }}>
        {void qc}
      </span>
    </Card>
  );
}

const termSchema = z.object({
  term: z.string().min(1).max(255),
  definition: z.string().min(1).max(10000),
});

type TermForm = z.infer<typeof termSchema>;

function CreateTermModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: TermForm) =>
      apiPost<DictionaryTerm>('/semantic/dictionary', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'dictionary'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось создать'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый термин">
        <Form<TermForm>
          schema={termSchema}
          defaultValues={{ term: '', definition: '' }}
          submitLabel="Создать"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="term" label="Термин" required />
          <FormTextarea
            name="definition"
            label="Определение"
            rows={6}
            required
            maxLength={10000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const editTermSchema = z.object({
  definition: z.string().min(1).max(10000),
});

type EditTermForm = z.infer<typeof editTermSchema>;

function EditTermModal({
  term,
  onClose,
}: {
  term: DictionaryTerm;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const editM = useMutation({
    mutationFn: (data: EditTermForm) =>
      apiPatch<DictionaryTerm>(`/semantic/dictionary/${term.id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['semantic', 'dictionary'] });
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось обновить'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title={`Термин: ${term.term} (v${term.version})`}>
        <Form<EditTermForm>
          schema={editTermSchema}
          defaultValues={{ definition: term.definition }}
          submitLabel="Обновить"
          onCancel={onClose}
          loading={editM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await editM.mutateAsync(data);
          }}
        >
          <FormTextarea
            name="definition"
            label="Определение"
            rows={8}
            required
            maxLength={10000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Tools ───────────────────────────────────────────────────────

function ToolsSection(): ReactElement {
  return (
    <div style={styles.toolsGrid}>
      <TranslationPanel />
      <ReportPanel />
      <GuardianPanel />
      <PressurePanel />
    </div>
  );
}

const translationSchema = z.object({
  original: z.string().min(1).max(50000),
  translated: z.string().min(1).max(50000),
  language: z.string().min(2).max(16),
});

type TranslationForm = z.infer<typeof translationSchema>;

function TranslationPanel(): ReactElement {
  const [result, setResult] = useState<{
    ok?: boolean;
    drift?: Array<{ term: string; delta: string }>;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const checkM = useMutation({
    mutationFn: (data: TranslationForm) =>
      apiPost<{ ok: boolean; drift: Array<{ term: string; delta: string }> }>(
        '/semantic/translations/check',
        data,
      ),
    onSuccess: (r) => {
      setResult(r);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Card title="Проверка перевода">
      <Form<TranslationForm>
        schema={translationSchema}
        defaultValues={{ original: '', translated: '', language: 'en' }}
        submitLabel="Проверить"
        loading={checkM.isPending}
        onSubmit={async (data) => {
          await checkM.mutateAsync(data);
        }}
      >
        <FormTextarea
          name="original"
          label="Оригинал"
          rows={3}
          required
          maxLength={50000}
        />
        <FormTextarea
          name="translated"
          label="Перевод"
          rows={3}
          required
          maxLength={50000}
        />
        <FormInput
          name="language"
          label="Язык (en, de, …)"
          required
        />
        {result ? (
          <div style={result.ok ? styles.resultOk : styles.resultBad}>
            {result.ok ? '✓ Перевод корректен' : '✗ Обнаружен дрейф'}
            {result.drift && result.drift.length > 0 ? (
              <div style={styles.driftList}>
                {result.drift.map((d, i) => (
                  <div key={i}>
                    • {d.term}: {d.delta}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {err ? <div style={styles.error}>{err}</div> : null}
      </Form>
    </Card>
  );
}

function ReportPanel(): ReactElement {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const reportQ = useApiQuery<Record<string, unknown>>(
    ['semantic', 'report', year],
    `/semantic/report?year=${year}`,
  );

  return (
    <Card title="Годовой доклад">
      <div style={styles.reportYear}>
        <input
          type="number"
          min={2000}
          max={2100}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={styles.input}
        />
      </div>
      {reportQ.isLoading ? (
        <Spinner />
      ) : (
        <pre style={styles.pre}>
          {JSON.stringify(reportQ.data ?? {}, null, 2)}
        </pre>
      )}
    </Card>
  );
}

function GuardianPanel(): ReactElement {
  const guardianQ = useApiQuery<{
    active: boolean;
    can_remove: boolean;
    note: string;
  }>(['semantic', 'guardian'], '/semantic/guardian');

  return (
    <Card title="Семантический Страж">
      {guardianQ.isLoading ? (
        <Spinner />
      ) : guardianQ.data ? (
        <>
          <div style={styles.guardianRow}>
            <span>Статус:</span>
            <Badge tone={guardianQ.data.active ? 'success' : 'danger'}>
              {guardianQ.data.active ? 'Активен' : 'Не активен'}
            </Badge>
          </div>
          <div style={styles.guardianRow}>
            <span>Может быть отстранён:</span>
            <Badge tone={guardianQ.data.can_remove ? 'warning' : 'info'}>
              {guardianQ.data.can_remove ? 'Да' : 'Нет'}
            </Badge>
          </div>
          <p style={styles.muted}>{guardianQ.data.note}</p>
        </>
      ) : null}
    </Card>
  );
}

const pressureSchema = z.object({
  description: z.string().min(1).max(2000),
});

type PressureForm = z.infer<typeof pressureSchema>;

function PressurePanel(): ReactElement {
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const sendM = useMutation({
    mutationFn: (data: PressureForm) =>
      apiPost('/semantic/pressure', data),
    onSuccess: () => {
      setSent(true);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Card
      title="Сигнал о давлении"
      subtitle="Self-service. Активирует InfoBlockade (I.4.6.4)"
    >
      <Form<PressureForm>
        schema={pressureSchema}
        defaultValues={{ description: '' }}
        submitLabel="Отправить"
        loading={sendM.isPending}
        onSubmit={async (data) => {
          setSent(false);
          await sendM.mutateAsync(data);
        }}
      >
        <FormTextarea
          name="description"
          label="Описание"
          rows={3}
          required
          maxLength={2000}
        />
        {sent ? (
          <div style={styles.resultOk}>✓ Сигнал отправлен</div>
        ) : null}
        {err ? <div style={styles.error}>{err}</div> : null}
      </Form>
    </Card>
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
  tabBtnActive: {
    background: colors.primary,
    color: '#fff',
  },
  cardActions: {
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
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  truncate: {
    display: 'inline-block' as const,
    maxWidth: 300,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  rowActions: {
    display: 'flex' as const,
    gap: spacing.sm,
  },
  openRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    marginBottom: spacing.sm,
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
  modal: { width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' as const },
  toolsGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: spacing.md,
  },
  resultOk: {
    color: colors.success,
    fontSize: fontSize.sm,
    padding: '8px 12px',
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 6,
  },
  resultBad: {
    color: colors.danger,
    fontSize: fontSize.sm,
    padding: '8px 12px',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
  },
  driftList: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: fontSize.xs,
  },
  reportYear: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
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
    maxHeight: 320,
    overflow: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  guardianRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    padding: '4px 0',
    fontSize: fontSize.sm,
    color: colors.text,
  },
};