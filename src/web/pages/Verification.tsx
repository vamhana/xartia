// F.4.02.11 — Verification page.
/**
 * 5 табов: аудиты, перепроверки, аудит кода, целостность, gateway-suspend.
 * Backend: A.1.19.01 (готов, requireRight навешан).
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
import { MetricCard } from '../components/ui/Chart';
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

type AuditType = 'planned' | 'unplanned' | 'procedural' | 'request';
type AuditStatus = 'open' | 'in_progress' | 'finished';
type RecheckResult = 'match' | 'mismatch';
type CodeSystem = 'prefix_filter' | 'balance' | 'digital_mentor' | 'other';
type IntegrityAction = 'digital_attack' | 'modification_attempt';

interface Audit {
  id: string;
  type: AuditType;
  subject: string;
  subjectId: string | null;
  initiatorId: string;
  status: AuditStatus;
  result: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface AuditFinding {
  id: string;
  auditId: string;
  finding: string;
  severity: number;
  recommendation: string;
  createdAt: string;
}

interface VerificationRecheck {
  id: string;
  otcDecisionId: string;
  verifierId: string;
  result: RecheckResult;
  comment: string | null;
  createdAt: string;
}

interface CodeAudit {
  id: string;
  system: CodeSystem;
  version: string;
  findings: Record<string, unknown>;
  conductedBy: string;
  createdAt: string;
}

interface IntegrityAlert {
  id: string;
  system: string;
  sourceNode: string;
  action: IntegrityAction;
  details: Record<string, unknown>;
  handledAt: string | null;
  resolution: string | null;
  createdAt: string;
}

type Tab = 'audits' | 'rechecks' | 'code' | 'integrity' | 'gateway';

// ─── Константы ───────────────────────────────────────────────────

const AUDIT_TYPE_LABEL: Record<AuditType, string> = {
  planned: 'Плановый',
  unplanned: 'Внеплановый',
  procedural: 'Процессуальный',
  request: 'По запросу',
};

const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  open: 'Открыт',
  in_progress: 'В работе',
  finished: 'Завершён',
};

const AUDIT_STATUS_TONE: Record<AuditStatus, BadgeTone> = {
  open: 'warning',
  in_progress: 'info',
  finished: 'success',
};

const CODE_SYSTEM_LABEL: Record<CodeSystem, string> = {
  prefix_filter: 'Префильтр',
  balance: 'Балансировка',
  digital_mentor: 'Цифровой наставник',
  other: 'Прочее',
};

const INTEGRITY_ACTION_LABEL: Record<IntegrityAction, string> = {
  digital_attack: 'Цифровая атака',
  modification_attempt: 'Попытка изменения',
};

const INTEGRITY_ACTION_TONE: Record<IntegrityAction, BadgeTone> = {
  digital_attack: 'critical',
  modification_attempt: 'high',
};

const TAB_LABEL: Record<Tab, string> = {
  audits: 'Аудиты',
  rechecks: 'Перепроверки',
  code: 'Аудит кода',
  integrity: 'Целостность',
  gateway: 'Шлюз',
};

/* function severityTone(s: number): BadgeTone {
  if (s >= 8) return 'critical';
  if (s >= 6) return 'high';
  if (s >= 4) return 'standard';
  return 'default';
} */

// ─── Страница ────────────────────────────────────────────────────

export function VerificationPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('audits');

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Верификация</h1>

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

      {tab === 'audits' ? <AuditsSection /> : null}
      {tab === 'rechecks' ? <RechecksSection /> : null}
      {tab === 'code' ? <CodeAuditsSection /> : null}
      {tab === 'integrity' ? <IntegritySection /> : null}
      {tab === 'gateway' ? <GatewaySection /> : null}
    </div>
  );
}

// ─── Аудиты ──────────────────────────────────────────────────────

function AuditsSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const listQ = useApiQuery<{ data: Audit[]; meta: { total: number } }>(
    ['verification', 'audits', filterType, filterStatus],
    `/verification/audits?page=1&per_page=100${
      filterType ? `&type=${filterType}` : ''
    }${filterStatus ? `&status=${filterStatus}` : ''}`,
  );
  const overdueQ = useApiQuery<{ data: Audit[] }>(
    ['verification', 'audits', 'overdue'],
    '/verification/audits/overdue',
  );

  const columns: Column<Audit>[] = [
    {
      key: 'type',
      title: 'Тип',
      width: 150,
      render: (r) => <Badge tone="info">{AUDIT_TYPE_LABEL[r.type]}</Badge>,
    },
    { key: 'subject', title: 'Subject', sortable: true },
    {
      key: 'status',
      title: 'Статус',
      width: 130,
      render: (r) => (
        <Badge tone={AUDIT_STATUS_TONE[r.status]}>
          {AUDIT_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      title: 'Создан',
      width: 140,
      render: (r) => new Date(r.createdAt).toLocaleDateString('ru-RU'),
    },
    {
      key: 'finishedAt',
      title: 'Завершён',
      width: 140,
      render: (r) =>
        r.finishedAt
          ? new Date(r.finishedAt).toLocaleDateString('ru-RU')
          : '—',
    },
    {
      key: 'actions',
      title: '',
      width: 80,
      render: (r) => (
        <Button variant="ghost" onClick={() => setOpenId(r.id)}>
          Открыть
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Аудиты"
      subtitle={`Всего ${listQ.data?.meta?.total ?? 0} · Просрочки: ${overdueQ.data?.data?.length ?? 0}`}
      actions={
        <div style={styles.cardActions}>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={styles.select}
          >
            <option value="">Все типы</option>
            {(Object.keys(AUDIT_TYPE_LABEL) as AuditType[]).map((k) => (
              <option key={k} value={k}>
                {AUDIT_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все статусы</option>
            {(Object.keys(AUDIT_STATUS_LABEL) as AuditStatus[]).map((k) => (
              <option key={k} value={k}>
                {AUDIT_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
          {rights.hasRight('audit', 'C') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Создать аудит
            </Button>
          ) : null}
        </div>
      }
    >
      {listQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<Audit>
          data={listQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Аудитов нет"
        />
      )}

      {creating ? (
        <CreateAuditModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['verification'] });
          }}
        />
      ) : null}

      {openId ? (
        <AuditDetail
          auditId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['verification'] });
          }}
        />
      ) : null}
    </Card>
  );
}

function AuditDetail({
  auditId,
  onClose,
  onChanged,
}: {
  auditId: string;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [addingFinding, setAddingFinding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const auditQ = useApiQuery<Audit>(
    ['verification', 'audit', auditId],
    `/verification/audits/${auditId}`,
  );

  const addFindingM = useMutation({
    mutationFn: (data: FindingForm) =>
      apiPost<AuditFinding>(`/verification/audits/${auditId}/finding`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['verification', 'audit', auditId] });
      setAddingFinding(false);
      setErr(null);
      onChanged();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  const closeM = useMutation({
    mutationFn: (data: { result: string }) =>
      apiPost<Audit>(`/verification/audits/${auditId}/close`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['verification', 'audit', auditId] });
      setClosing(false);
      setErr(null);
      onChanged();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  if (auditQ.isLoading) {return <Spinner />;}
  if (!auditQ.data) {return <p style={styles.muted}>Не найдено</p>;}

  const a = auditQ.data;
  const isFinished = a.status === 'finished';

  return (
    <Modal onClose={onClose}>
      <Card
        title={`Аудит ${a.id.slice(0, 8)}…`}
        subtitle={a.subject}
        actions={
          <Badge tone={AUDIT_STATUS_TONE[a.status]}>
            {AUDIT_STATUS_LABEL[a.status]}
          </Badge>
        }
      >
        <div style={styles.detailMeta}>
          <span>Тип: {AUDIT_TYPE_LABEL[a.type]}</span>
          <span>Создан: {new Date(a.createdAt).toLocaleString('ru-RU')}</span>
          {a.finishedAt ? (
            <span>Завершён: {new Date(a.finishedAt).toLocaleString('ru-RU')}</span>
          ) : null}
        </div>

        {a.result ? (
          <div style={styles.subBlock}>
            <div style={styles.subBlockTitle}>Результат</div>
            <p style={styles.resultText}>{a.result}</p>
          </div>
        ) : null}

        {!isFinished && rights.hasRight('audit', 'E') ? (
          <>
            <div style={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => setAddingFinding(true)}
                disabled={addingFinding}
              >
                + Находка
              </Button>
              <Button
                variant="primary"
                onClick={() => setClosing(true)}
                disabled={closing}
              >
                Закрыть аудит
              </Button>
            </div>

            {addingFinding ? (
              <div style={styles.subBlock}>
                <div style={styles.subBlockTitle}>Новая находка</div>
                <AddFindingForm
                  onSubmit={(d) => void addFindingM.mutateAsync(d)}
                  onCancel={() => setAddingFinding(false)}
                  busy={addFindingM.isPending}
                />
              </div>
            ) : null}

            {closing ? (
              <div style={styles.subBlock}>
                <div style={styles.subBlockTitle}>Закрытие</div>
                <CloseAuditForm
                  onSubmit={(d) => void closeM.mutateAsync(d)}
                  onCancel={() => setClosing(false)}
                  busy={closeM.isPending}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {err ? <div style={styles.error}>{err}</div> : null}

        <div style={styles.actions}>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
        </div>
      </Card>
    </Modal>
  );
}

const createAuditSchema = z.object({
  type: z.enum(['planned', 'unplanned', 'procedural', 'request']),
  subject: z.string().min(1).max(128),
  subject_id: z.string().uuid().optional(),
});

type CreateAuditForm = z.infer<typeof createAuditSchema>;

function CreateAuditModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CreateAuditForm) =>
      apiPost<Audit>('/verification/audits', {
        type: data.type,
        subject: data.subject,
        ...(data.subject_id ? { subject_id: data.subject_id } : {}),
      }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Новый аудит">
        <Form<CreateAuditForm>
          schema={createAuditSchema}
          defaultValues={{
            type: 'planned',
            subject: '',
            subject_id: undefined,
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
            label="Тип аудита"
            required
            options={(Object.keys(AUDIT_TYPE_LABEL) as AuditType[]).map((k) => ({
              value: k,
              label: AUDIT_TYPE_LABEL[k],
            }))}
          />
          <FormInput name="subject" label="Subject" placeholder="participant / good / task" required />
          <FormInput name="subject_id" label="UUID субъекта (опционально)" />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

const findingSchema = z.object({
  finding: z.string().min(1).max(5000),
  severity: z.coerce.number().int().min(1).max(10),
  recommendation: z.string().min(1).max(5000),
});

type FindingForm = z.infer<typeof findingSchema>;

function AddFindingForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (d: FindingForm) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <Form<FindingForm>
      schema={findingSchema}
      defaultValues={{ finding: '', severity: 5, recommendation: '' }}
      submitLabel="Добавить"
      cancelLabel="Отмена"
      onCancel={onCancel}
      loading={busy}
      onSubmit={async (data) => onSubmit(data)}
    >
      <FormTextarea name="finding" label="Находка" rows={4} required maxLength={5000} />
      <FormInput name="severity" label="Severity (1–10)" type="number" required />
      <FormTextarea
        name="recommendation"
        label="Рекомендация"
        rows={3}
        required
        maxLength={5000}
      />
    </Form>
  );
}

const closeAuditSchema = z.object({
  result: z.string().min(1).max(5000),
});

type CloseAuditFormData = z.infer<typeof closeAuditSchema>;

function CloseAuditForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (d: CloseAuditFormData) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <Form<CloseAuditFormData>
      schema={closeAuditSchema}
      defaultValues={{ result: '' }}
      submitLabel="Закрыть"
      cancelLabel="Отмена"
      onCancel={onCancel}
      loading={busy}
      onSubmit={async (data) => onSubmit(data)}
    >
      <FormTextarea name="result" label="Итог" rows={4} required maxLength={5000} />
    </Form>
  );
}

// ─── Перепроверки ────────────────────────────────────────────────

function RechecksSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);

  const statsQ = useApiQuery<{ match_rate: number; mismatches: number }>(
    ['verification', 'recheck-stats'],
    '/verification/rechecks/stats',
  );

  return (
    <Card
      title="Перепроверка ОТК"
      subtitle="При > 10% mismatch — эскалация в Балансировку"
      actions={
        rights.hasRight('audit', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Провести перепроверку
          </Button>
        ) : undefined
      }
    >
      {statsQ.isLoading ? (
        <Spinner />
      ) : statsQ.data ? (
        <div style={styles.metricRow}>
          <MetricCard
            value={`${(statsQ.data.match_rate * 100).toFixed(1)}%`}
            label="Match rate"
          />
          <MetricCard value={statsQ.data.mismatches} label="Mismatches" />
        </div>
      ) : null}

      <p style={styles.muted}>
        Список всех перепроверок в API отсутствует — доступен только по UUID решения ОТК.
        Статистика — общая.
      </p>

      {creating ? (
        <RecheckModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['verification', 'recheck-stats'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const recheckSchema = z.object({
  decision_id: z.string().uuid('UUID решения ОТК'),
  matches: z.enum(['true', 'false']),
  comment: z.string().max(2000).optional(),
});

type RecheckForm = z.infer<typeof recheckSchema>;

function RecheckModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: RecheckForm) =>
      apiPost<VerificationRecheck>(
        `/verification/rechecks/${data.decision_id}`,
        {
          matches: data.matches === 'true',
          ...(data.comment ? { comment: data.comment } : {}),
        },
      ),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Modal onClose={onClose}>
      <Card title="Перепроверка решения ОТК">
        <Form<RecheckForm>
          schema={recheckSchema}
          defaultValues={{ decision_id: '', matches: 'true', comment: '' }}
          submitLabel="Провести"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="decision_id" label="UUID решения ОТК" required />
          <FormSelect
            name="matches"
            label="Результат"
            required
            options={[
              { value: 'true', label: 'Совпадает' },
              { value: 'false', label: 'Расхождение' },
            ]}
          />
          <FormTextarea name="comment" label="Комментарий" rows={3} maxLength={2000} />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Аудит кода ──────────────────────────────────────────────────

function CodeAuditsSection(): ReactElement {
  const qc = useQueryClient();
  const rights = useRights();
  const [creating, setCreating] = useState(false);

  return (
    <Card
      title="Аудит кода"
      subtitle="Проверка алгоритмов: префильтр, Балансировка, Цифровой наставник"
      actions={
        rights.hasRight('audit', 'C') ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Провести аудит
          </Button>
        ) : undefined
      }
    >
      <p style={styles.muted}>
        Список аудитов кода в API отсутствует — создаётся вручную.
        Результат — в БД (`code_audits`).
      </p>

      {creating ? (
        <CreateCodeAuditModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['verification'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const codeAuditSchema = z.object({
  system: z.enum(['prefix_filter', 'balance', 'digital_mentor', 'other']),
  version: z.string().min(1).max(64),
  findings_text: z.string().min(1, 'Заполните findings'),
});

type CodeAuditForm = z.infer<typeof codeAuditSchema>;

function CreateCodeAuditModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CodeAuditForm) => {
      let findings: Record<string, unknown>;
      try {
        findings = JSON.parse(data.findings_text) as Record<string, unknown>;
      } catch {
        findings = { text: data.findings_text };
      }
      return apiPost<CodeAudit>('/verification/code-audits', {
        system: data.system,
        version: data.version,
        findings,
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
      <Card title="Аудит кода">
        <Form<CodeAuditForm>
          schema={codeAuditSchema}
          defaultValues={{
            system: 'balance',
            version: 'v1.0',
            findings_text: '{\n  "issues": 0,\n  "notes": ""\n}',
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
            name="system"
            label="Система"
            required
            options={(Object.keys(CODE_SYSTEM_LABEL) as CodeSystem[]).map((k) => ({
              value: k,
              label: CODE_SYSTEM_LABEL[k],
            }))}
          />
          <FormInput name="version" label="Версия" required />
          <FormTextarea
            name="findings_text"
            label="Findings (JSON или текст)"
            rows={6}
            required
            maxLength={20000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Целостность ─────────────────────────────────────────────────

function IntegritySection(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const alertsQ = useApiQuery<{ data: IntegrityAlert[] }>(
    ['verification', 'integrity-alerts'],
    '/verification/integrity-alerts',
    { refetchInterval: 30_000 },
  );

  const columns: Column<IntegrityAlert>[] = [
    {
      key: 'action',
      title: 'Действие',
      width: 170,
      render: (r) => (
        <Badge tone={INTEGRITY_ACTION_TONE[r.action]}>
          {INTEGRITY_ACTION_LABEL[r.action]}
        </Badge>
      ),
    },
    { key: 'system', title: 'Система', width: 180 },
    { key: 'sourceNode', title: 'Узел', width: 180 },
    {
      key: 'createdAt',
      title: 'Обнаружено',
      width: 160,
      render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
    },
    {
      key: 'handledAt',
      title: 'Статус',
      width: 130,
      render: (r) =>
        r.handledAt ? (
          <Badge tone="success">Обработано</Badge>
        ) : (
          <Badge tone="warning">Активен</Badge>
        ),
    },
  ];

  return (
    <Card
      title="Алерты целостности"
      subtitle={`Активных: ${alertsQ.data?.data?.length ?? 0}`}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Сообщить
        </Button>
      }
    >
      {alertsQ.isLoading ? (
        <Spinner />
      ) : (
        <Table<IntegrityAlert>
          data={alertsQ.data?.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Алертов нет"
        />
      )}

      {creating ? (
        <CreateIntegrityAlertModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['verification', 'integrity-alerts'] });
          }}
        />
      ) : null}
    </Card>
  );
}

const integritySchema = z.object({
  system: z.string().min(1).max(128),
  source_node: z.string().min(1).max(128),
  action: z.enum(['digital_attack', 'modification_attempt']),
  details_text: z.string().max(5000).optional(),
});

type IntegrityForm = z.infer<typeof integritySchema>;

function CreateIntegrityAlertModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: IntegrityForm) => {
      let details: Record<string, unknown> = {};
      if (data.details_text) {
        try {
          details = JSON.parse(data.details_text) as Record<string, unknown>;
        } catch {
          details = { text: data.details_text };
        }
      }
      return apiPost<IntegrityAlert>('/verification/integrity-alerts', {
        system: data.system,
        source_node: data.source_node,
        action: data.action,
        details,
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
      <Card
        title="Новый алерт целостности"
        subtitle="При digital_attack — автоизоляция + созыв Жюри (I.1.11)"
      >
        <Form<IntegrityForm>
          schema={integritySchema}
          defaultValues={{
            system: '',
            source_node: '',
            action: 'modification_attempt',
            details_text: '',
          }}
          submitLabel="Сообщить"
          onCancel={onClose}
          loading={createM.isPending}
          onSubmit={async (data) => {
            setErr(null);
            await createM.mutateAsync(data);
          }}
        >
          <FormInput name="system" label="Система (например, balance-algo)" required />
          <FormInput name="source_node" label="Узел-источник" required />
          <FormSelect
            name="action"
            label="Тип нарушения"
            required
            options={[
              { value: 'modification_attempt', label: 'Попытка изменения' },
              { value: 'digital_attack', label: 'Цифровая атака' },
            ]}
          />
          <FormTextarea
            name="details_text"
            label="Детали (JSON или текст)"
            rows={4}
            maxLength={5000}
          />
          {err ? <div style={styles.error}>{err}</div> : null}
        </Form>
      </Card>
    </Modal>
  );
}

// ─── Gateway-suspend ─────────────────────────────────────────────

function GatewaySection(): ReactElement {
  const rights = useRights();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ suspended: number } | null>(null);

  const suspendM = useMutation({
    mutationFn: () =>
      apiPost<{ suspended: number }>('/verification/gateway-suspend', {}),
    onSuccess: (r) => {
      setResult(r);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Card
      title="Приостановка решений Шлюза"
      subtitle="При выявлении нарушений Верификация может приостановить сделки"
    >
      <p style={styles.muted}>
        Действие приостанавливает исполнение решений Совета Шлюза до
        завершения аудита. Используется при выявлении нарушений.
      </p>

      {rights.hasRight('audit', 'A') ? (
        <div style={styles.actions}>
          <Button
            variant="danger"
            disabled={suspendM.isPending}
            onClick={() => void suspendM.mutateAsync()}
          >
            {suspendM.isPending ? '…' : 'Приостановить решения'}
          </Button>
        </div>
      ) : (
        <p style={styles.muted}>Требуется право audit:A</p>
      )}

      {result ? (
        <div style={styles.successBlock}>
          Приостановлено решений: <strong>{result.suspended}</strong>
        </div>
      ) : null}
      {err ? <div style={styles.error}>{err}</div> : null}
    </Card>
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
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  metricRow: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: spacing.md, marginBottom: spacing.md,
  },
  detailMeta: {
    display: 'flex' as const, gap: spacing.md,
    color: colors.textMuted, fontSize: fontSize.sm,
    flexWrap: 'wrap' as const, marginBottom: spacing.sm,
  },
  resultText: {
    color: colors.text, fontSize: fontSize.sm,
    lineHeight: 1.5, margin: 0,
  },
  actions: {
    display: 'flex' as const, gap: spacing.sm,
    paddingTop: spacing.sm, marginTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
    flexWrap: 'wrap' as const,
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
  error: {
    color: colors.danger, fontSize: fontSize.sm,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6, padding: '8px 12px',
    marginTop: spacing.sm,
  },
  successBlock: {
    color: colors.text, fontSize: fontSize.sm,
    padding: spacing.md, marginTop: spacing.md,
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