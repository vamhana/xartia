// src/web/pages/Automation.tsx
/**
 * F.4.02.24 — Панель Автоматизации (I.6.15).
 *
 * 3 таба: queue / sections / operator-audit.
 * Оператор — 6 мес., не более 2 сроков (I.6.15.2).
 * Стаж ≥ 2 года + аттестация ИИ (I.6.15.1).
 * > 95% утверждений → аудит; > 3 ошибок/мес → отстранение (III.1.13).
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
import { Form, FormInput, FormTextarea } from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { useApiQuery } from '../hooks/useApi';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type Tab = 'queue' | 'sections' | 'operator-audit';

type AiRecommendation = 'approve' | 'reject';
type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'deferred';
type AuditStatus = 'ok' | 'audit_required' | 'removed';

interface AutomationDecision {
  id: string;
  type: string;
  content: Record<string, unknown>;
  aiRecommendation: AiRecommendation;
  deadline: string;
  status: DecisionStatus;
  rejectionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface AutomationSection {
  id: string;
  directionId: string;
  enabled: boolean;
  operatorId: string | null;
  disabledAt: string | null;
  disableReason: string | null;
  createdAt: string;
}

interface OperatorAudit {
  id: string;
  operatorId: string;
  approvalRate: number;
  errorCount: number;
  status: AuditStatus;
  recommendations: string[];
  createdAt: string;
}

// ─── Константы ───────────────────────────────────────────────────

const TAB_LABEL: Record<Tab, string> = {
  'queue': 'Очередь',
  'sections': 'Участки',
  'operator-audit': 'Аудит оператора',
};

const DECISION_STATUS_TONE: Record<DecisionStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  deferred: 'info',
};

const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  pending: 'Ожидает',
  approved: 'Утверждено',
  rejected: 'Отклонено',
  deferred: 'Отложено',
};

const AUDIT_STATUS_TONE: Record<AuditStatus, BadgeTone> = {
  ok: 'success',
  audit_required: 'warning',
  removed: 'critical',
};

const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  ok: 'Норма',
  audit_required: 'Требуется аудит',
  removed: 'Отстранён',
};

// ─── Схемы ───────────────────────────────────────────────────────

const rejectSchema = z.object({
  reason: z.string().min(1, 'Причина обязательна (I.6.15.5)').max(2000),
});

const deferSchema = z.object({
  new_deadline: z.string().min(1, 'Укажите дату'),
});

const assignOperatorSchema = z.object({
  operator_id: z.string().uuid('UUID оператора'),
});

const disableSchema = z.object({
  reason: z.string().min(1, 'Причина обязательна (I.6.15.6)').max(2000),
});

const createSectionSchema = z.object({
  direction_id: z.string().uuid('UUID направления'),
});

// ─── Страница ────────────────────────────────────────────────────

export function AutomationPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('queue');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Автоматизация</h1>
        <span style={styles.subtitle}>
          Оператор утверждает типовые запросы ИИ (I.6.15). Доля
          утверждений &gt; 95% → аудит (III.1.13а).
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

      {tab === 'queue' && <QueueTab />}
      {tab === 'sections' && <SectionsTab />}
      {tab === 'operator-audit' && <OperatorAuditTab />}
    </div>
  );
}

// ─── Queue ───────────────────────────────────────────────────────

function QueueTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [deferring, setDeferring] = useState<string | null>(null);

  const q = useApiQuery<{ data: AutomationDecision[] }>(
    ['automation', 'queue'],
    '/automation/queue',
  );

  const decisions = q.data?.data ?? [];

  const approveM = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/automation/decisions/${id}/approve`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automation'] }),
  });

  const columns: Column<AutomationDecision>[] = [
    {
      key: 'aiRecommendation',
      title: 'Рекомендация ИИ',
      width: 160,
      render: (r) => (
        <Badge tone={r.aiRecommendation === 'approve' ? 'success' : 'danger'}>
          {r.aiRecommendation === 'approve' ? 'Утвердить' : 'Отклонить'}
        </Badge>
      ),
    },
    {
      key: 'type',
      title: 'Тип',
      width: 180,
      render: (r) => <span style={styles.mono}>{r.type}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: 120,
      render: (r) => (
        <Badge tone={DECISION_STATUS_TONE[r.status]}>
          {DECISION_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'deadline',
      title: 'Дедлайн',
      width: 160,
      render: (r) => new Date(r.deadline).toLocaleString('ru-RU'),
    },
    {
      key: 'actions',
      title: '',
      width: 260,
      render: (r) =>
        r.status === 'pending' || r.status === 'deferred' ? (
          <div style={styles.rowActions}>
            <Button
              variant="primary"
              onClick={() => void approveM.mutateAsync(r.id)}
              disabled={approveM.isPending}
            >
              Утвердить
            </Button>
            <Button variant="danger" onClick={() => setRejecting(r.id)}>
              Отклонить
            </Button>
            <Button variant="ghost" onClick={() => setDeferring(r.id)}>
              Отложить
            </Button>
          </div>
        ) : (
          <span style={styles.muted}>—</span>
        ),
    },
  ];

  return (
    <Card
      title="Очередь решений"
      subtitle={`Оператор: ${user?.participant.name ?? '—'}`}
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Table<AutomationDecision>
          data={decisions}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage="Решений нет"
        />
      )}

      {rejecting ? (
        <Modal onClose={() => setRejecting(null)} title="Отклонить решение">
          <Form<z.infer<typeof rejectSchema>>
            schema={rejectSchema}
            defaultValues={{ reason: '' }}
            submitLabel="Отклонить"
            onCancel={() => setRejecting(null)}
            onSubmit={async (data) => {
              await apiPost(`/automation/decisions/${rejecting}/reject`, data);
              void qc.invalidateQueries({ queryKey: ['automation'] });
              setRejecting(null);
            }}
          >
            <FormTextarea
              name="reason"
              label="Причина (обязательна, I.6.15.5)"
              rows={4}
              required
            />
          </Form>
        </Modal>
      ) : null}

      {deferring ? (
        <Modal onClose={() => setDeferring(null)} title="Отложить решение">
          <Form<z.infer<typeof deferSchema>>
            schema={deferSchema}
            defaultValues={{
              new_deadline: new Date(Date.now() + 86_400_000)
                .toISOString()
                .slice(0, 16),
            }}
            submitLabel="Отложить"
            onCancel={() => setDeferring(null)}
            onSubmit={async (data) => {
              await apiPost(`/automation/decisions/${deferring}/defer`, {
                new_deadline: new Date(data.new_deadline).toISOString(),
              });
              void qc.invalidateQueries({ queryKey: ['automation'] });
              setDeferring(null);
            }}
          >
            <FormInput
              name="new_deadline"
              label="Новый дедлайн (YYYY-MM-DDTHH:MM)"
              required
            />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Sections ────────────────────────────────────────────────────

function SectionsTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [creating, setCreating] = useState(false);
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<string | null>(null);

  // Список участков — ручки нет в API, читаем по одному section через
  // известный directionId пользователя. В проде — добавить listSections.
  const directionId = user?.participant.directionId ?? '';
  const sectionQ = useApiQuery<AutomationSection>(
    ['automation', 'section-by-direction', directionId],
    `/automation/sections/${directionId}`,
    { enabled: false }, // не читаем до явного вызова
  );

  // Здесь используем секцию для «направление пользователя», если есть.
  // Если нет — покажем кнопку «Создать участок для моего направления».
  const section = sectionQ.data;

  return (
    <Card
      title="Участки автоматизации"
      subtitle="Один участок на направление. Оператор — на 6 мес., не более 2 сроков."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Создать участок
        </Button>
      }
    >
      {!section && !sectionQ.isLoading ? (
        <p style={styles.muted}>
          Активных участков не найдено. Создайте участок для направления.
        </p>
      ) : section ? (
        <div style={styles.sectionCard}>
          <div style={styles.sectionRow}>
            <span style={styles.muted}>Направление</span>
            <span style={styles.mono}>{section.directionId}</span>
          </div>
          <div style={styles.sectionRow}>
            <span style={styles.muted}>Статус</span>
            <Badge tone={section.enabled ? 'success' : 'default'}>
              {section.enabled ? 'Включен' : 'Отключен'}
            </Badge>
          </div>
          <div style={styles.sectionRow}>
            <span style={styles.muted}>Оператор</span>
            <span style={styles.mono}>
              {section.operatorId ?? '—'}
            </span>
          </div>
          {!section.enabled && section.disableReason ? (
            <div style={styles.sectionRow}>
              <span style={styles.muted}>Причина отключения</span>
              <span>{section.disableReason}</span>
            </div>
          ) : null}
          <div style={styles.rowActions}>
            <Button
              variant="secondary"
              onClick={() => setAssigningTo(section.id)}
            >
              Назначить оператора
            </Button>
            <Button
              variant="danger"
              onClick={() => setDisabling(section.id)}
              disabled={!section.enabled}
            >
              Отключить
            </Button>
          </div>
        </div>
      ) : (
        <Spinner />
      )}

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Новый участок">
          <Form<z.infer<typeof createSectionSchema>>
            schema={createSectionSchema}
            defaultValues={{ direction_id: directionId }}
            submitLabel="Создать"
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              await apiPost('/automation/sections', data);
              void qc.invalidateQueries({ queryKey: ['automation'] });
              setCreating(false);
            }}
          >
            <FormInput name="direction_id" label="UUID направления" required />
          </Form>
        </Modal>
      ) : null}

      {assigningTo ? (
        <Modal onClose={() => setAssigningTo(null)} title="Назначить оператора">
          <Form<z.infer<typeof assignOperatorSchema>>
            schema={assignOperatorSchema}
            defaultValues={{ operator_id: '' }}
            submitLabel="Назначить"
            onCancel={() => setAssigningTo(null)}
            onSubmit={async (data) => {
              await apiPost(
                `/automation/sections/${assigningTo}/operator`,
                data,
              );
              void qc.invalidateQueries({ queryKey: ['automation'] });
              setAssigningTo(null);
            }}
          >
            <FormInput name="operator_id" label="UUID оператора" required />
            <p style={styles.muted}>
              Проверки: стаж ≥ 2 года + аттестация ИИ (I.6.15.1),
              конфликты (I.6.15.4), мандат 6 мес. × 2 срока (I.6.15.2).
            </p>
          </Form>
        </Modal>
      ) : null}

      {disabling ? (
        <Modal onClose={() => setDisabling(null)} title="Отключить участок">
          <Form<z.infer<typeof disableSchema>>
            schema={disableSchema}
            defaultValues={{ reason: '' }}
            submitLabel="Отключить"
            onCancel={() => setDisabling(null)}
            onSubmit={async (data) => {
              await apiPost(
                `/automation/sections/${disabling}/disable`,
                data,
              );
              void qc.invalidateQueries({ queryKey: ['automation'] });
              setDisabling(null);
            }}
          >
            <FormTextarea
              name="reason"
              label="Причина (I.6.15.6)"
              rows={3}
              required
            />
          </Form>
        </Modal>
      ) : null}
    </Card>
  );
}

// ─── Operator Audit ──────────────────────────────────────────────

function OperatorAuditTab(): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [operatorId, setOperatorId] = useState('');
  const [auditResult, setAuditResult] = useState<OperatorAudit | null>(null);
  const [checkResult, setCheckResult] = useState<{
    should_audit?: boolean;
    should_remove?: boolean;
  } | null>(null);

  const auditM = useMutation({
    mutationFn: (id: string) =>
      apiPost<OperatorAudit & { audit_id: string }>(
        `/automation/operator/audit?operator_id=${id}`,
        {},
      ),
    onSuccess: (data) => setAuditResult(data),
  });

  const checkAuditM = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ should_audit: boolean }>(
        `/automation/operator/should-audit?operator_id=${id}`,
        {},
      ),
    onSuccess: (data) =>
      setCheckResult((prev) => ({ ...prev, should_audit: data.should_audit })),
  });

  const checkRemoveM = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ should_remove: boolean }>(
        `/automation/operator/should-remove?operator_id=${id}`,
        {},
      ),
    onSuccess: (data) =>
      setCheckResult((prev) => ({ ...prev, should_remove: data.should_remove })),
  });

  const runDailyM = useMutation({
    mutationFn: () =>
      apiPost<{ audited: number; removed: number }>(
        '/automation/run-daily-audit',
        {},
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automation'] }),
  });

  const effectiveId = operatorId || user?.participant.id || '';

  return (
    <Card
      title="Аудит оператора"
      subtitle="Доля утверждений > 95% → аудит (III.1.13а). Ошибки > 3/мес → отстранение (III.1.13б)."
    >
      <div style={styles.row}>
        <input
          style={styles.input}
          placeholder="UUID оператора (по умолчанию — вы)"
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
        />
        <Button
          variant="primary"
          onClick={() => void auditM.mutateAsync(effectiveId)}
          disabled={auditM.isPending || !effectiveId}
        >
          {auditM.isPending ? '…' : 'Провести аудит'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void checkAuditM.mutateAsync(effectiveId)}
          disabled={checkAuditM.isPending || !effectiveId}
        >
          should-audit?
        </Button>
        <Button
          variant="secondary"
          onClick={() => void checkRemoveM.mutateAsync(effectiveId)}
          disabled={checkRemoveM.isPending || !effectiveId}
        >
          should-remove?
        </Button>
        <Button
          variant="ghost"
          onClick={() => void runDailyM.mutateAsync()}
          disabled={runDailyM.isPending}
        >
          {runDailyM.isPending ? '…' : 'Cron: run-daily-audit'}
        </Button>
      </div>

      {runDailyM.data ? (
        <div style={styles.resultBox}>
          Daily audit: обработано {runDailyM.data.audited}, отстранено{' '}
          {runDailyM.data.removed}
        </div>
      ) : null}

      {checkResult ? (
        <div style={styles.resultBox}>
          {checkResult.should_audit !== undefined ? (
            <div>
              should_audit:{' '}
              <strong>{String(checkResult.should_audit)}</strong>
            </div>
          ) : null}
          {checkResult.should_remove !== undefined ? (
            <div>
              should_remove:{' '}
              <strong>{String(checkResult.should_remove)}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {auditResult ? (
        <div style={styles.auditBox}>
          <div style={styles.sectionRow}>
            <span style={styles.muted}>Approval rate</span>
            <strong>{(auditResult.approvalRate * 100).toFixed(1)}%</strong>
          </div>
          <div style={styles.sectionRow}>
            <span style={styles.muted}>Ошибок за месяц</span>
            <strong>{auditResult.errorCount}</strong>
          </div>
          <div style={styles.sectionRow}>
            <span style={styles.muted}>Статус</span>
            <Badge tone={AUDIT_STATUS_TONE[auditResult.status]}>
              {AUDIT_STATUS_LABEL[auditResult.status]}
            </Badge>
          </div>
          {auditResult.recommendations.length > 0 ? (
            <div style={styles.recommendations}>
              {auditResult.recommendations.map((r, i) => (
                <div key={i} style={styles.recommendation}>
                  • {r}
                </div>
              ))}
            </div>
          ) : null}
        </div>
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
  rowActions: { display: 'flex' as const, gap: spacing.sm, flexWrap: 'wrap' as const },
  sectionCard: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    padding: spacing.md,
    background: colors.bgSoft,
    borderRadius: radius.md,
  },
  sectionRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    fontSize: fontSize.sm,
  },
  resultBox: {
    padding: spacing.sm,
    background: colors.bgSoft,
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  auditBox: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    padding: spacing.md,
    background: colors.bgSoft,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  recommendations: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 4,
    marginTop: spacing.sm,
  },
  recommendation: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
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
};