// src/web/pages/Regimes.tsx
/**
 * F.4.02.09 — Regimes page.
 *
 * Активные режимы, активация/деактивация, аудит, мобилизация, дедлайны.
 * WS-подписка на regime.activated/deactivated + crisis.mobilization_*.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/Chart';
import {
  Form,
  FormInput,
  FormSelect,
  FormCheckbox,
} from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import { colors, fontSize, radius, spacing } from '../theme';


// ─── Типы ────────────────────────────────────────────────────────

type RegimeType =
  | 'steel_bell'
  | 'red_circuit'
  | 'info_blockade'
  | 'ptt'
  | 'quantum_acceleration'
  | 'global_red_circuit';

interface Regime {
  id: string;
  type: RegimeType;
  directionId: string | null;
  activatedBy: string | null;
  activatedAt: string;
  deactivatedAt: string | null;
  status: 'active' | 'finished' | 'cancelled';
  reason: string;
  conditions: Record<string, unknown> | null;
  auditSchedule: string | null;
  maxDuration: string | null;
}

interface CurrentDeadlines {
  critical: number;
  high: number;
  standard: number;
  background: number;
  info_blockade_active: boolean;
  quantum_acceleration_active: boolean;
}

interface Mobilization {
  id: string;
  regimeId: string;
  requiredCount: number;
  confirmedCount: number;
  refusedCount: number;
  thresholdPercent: number;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
}

interface MobilizationShare {
  confirmed: number;
  refused: number;
  percent: number;
}

// ─── Константы ───────────────────────────────────────────────────

const TYPE_LABEL: Record<RegimeType, string> = {
  steel_bell: 'Стальной Колокол',
  red_circuit: 'Красный Контур',
  info_blockade: 'Информационная блокада',
  ptt: 'ПТТ',
  quantum_acceleration: 'Квант ускорения',
  global_red_circuit: 'Глобальный Красный Контур',
};

const TYPE_TONE: Record<RegimeType, BadgeTone> = {
  steel_bell: 'critical',
  red_circuit: 'critical',
  info_blockade: 'danger',
  ptt: 'warning',
  quantum_acceleration: 'info',
  global_red_circuit: 'critical',
};

const TYPE_COLOR: Record<RegimeType, string> = {
  steel_bell: '#7f1d1d',
  red_circuit: '#b91c1c',
  info_blockade: '#a21caf',
  ptt: '#ea580c',
  quantum_acceleration: '#0284c7',
  global_red_circuit: '#0f172a',
};

const activateSchema = z.object({
  type: z.enum([
    'steel_bell',
    'red_circuit',
    'info_blockade',
    'ptt',
    'quantum_acceleration',
    'global_red_circuit',
  ]),
  reason: z.string().min(1, 'Укажите причину').max(1000),
  context_has_threat: z.boolean().optional(),
  context_no_gateway: z.boolean().optional(),
  context_red_circuit: z.boolean().optional(),
  context_quantum: z.boolean().optional(),
  context_global_threat: z.boolean().optional(),
  context_last_ptt_at: z.string().optional(),
});

type ActivateForm = z.infer<typeof activateSchema>;

const deactivateSchema = z.object({
  reason: z.string().min(1, 'Укажите причину').max(1000),
});

type DeactivateForm = z.infer<typeof deactivateSchema>;

const mobilizationSchema = z.object({
  required_count: z.coerce.number().int().positive(),
  threshold_percent: z.coerce.number().int().min(0).max(100),
});

type MobilizationForm = z.infer<typeof mobilizationSchema>;

const refuseSchema = z.object({
  reason: z.string().max(1000).optional(),
});

type RefuseForm = z.infer<typeof refuseSchema>;

// ─── Страница ────────────────────────────────────────────────────

export function RegimesPage(): ReactElement {
  const qc = useQueryClient();
  
  const [creating, setCreating] = useState(false);

  const activeQ = useApiQuery<{ data: Regime[] }>(
    ['regimes', 'active'],
    '/regimes/active',
  );
  const allQ = useApiQuery<{ data: Regime[] }>(
    ['regimes', 'list'],
    '/regimes',
  );
  const deadlinesQ = useApiQuery<CurrentDeadlines>(
    ['regimes', 'deadlines'],
    '/regimes/current-deadlines',
  );

  // WS
  useWSSubscription('regimes', (event) => {
    if (
      event === 'regime.activated' ||
      event === 'regime.deactivated' ||
      event === 'regime.audited' ||
      event === 'quantum_acceleration.activated' ||
      event === 'info_blockade.activated' ||
      event === 'info_blockade.lifted'
    ) {
      void qc.invalidateQueries({ queryKey: ['regimes'] });
    }
  });
  useWSSubscription('crisis', (event) => {
    if (event.startsWith('crisis.mobilization_')) {
      void qc.invalidateQueries({ queryKey: ['regimes'] });
    }
  });

  const active = activeQ.data?.data ?? [];
  const all = allQ.data?.data ?? [];

  const movement = useMemo(() => {
    const activeMovement = active.find(
      (r) => r.type === 'steel_bell' || r.type === 'red_circuit',
    );
    return activeMovement ?? null;
  }, [active]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Режимы</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Активировать
        </Button>
      </div>

      {/* Current deadlines */}
      {deadlinesQ.data ? <DeadlinesBar d={deadlinesQ.data} /> : null}

      {/* Активные режимы */}
      {activeQ.isLoading ? (
        <Spinner label="Загружаем режимы…" />
      ) : active.length === 0 ? (
        <Card title="Нет активных режимов">
          <p style={styles.muted}>
            Все процессы идут в обычном темпе
          </p>
        </Card>
      ) : (
        <div style={styles.activeList}>
          {active.map((r) => (
            <RegimeCard key={r.id} regime={r} />
          ))}
        </div>
      )}

      {/* Мобилизация — если есть активный режим */}
      {movement ? (
        <MobilizationPanel regimeId={movement.id} />
      ) : null}

      {/* История */}
      <Card title="История" subtitle={`Всего ${all.length}`}>
        {all.length === 0 ? (
          <p style={styles.muted}>Пусто</p>
        ) : (
          <div style={styles.historyList}>
            {all.slice(0, 20).map((r) => (
              <div key={r.id} style={styles.historyRow}>
                <Badge tone={TYPE_TONE[r.type]}>{TYPE_LABEL[r.type]}</Badge>
                <span style={styles.historyDate}>
                  {new Date(r.activatedAt).toLocaleString('ru-RU')}
                </span>
                <span style={styles.historyStatus}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {creating ? (
        <CreateRegimeModal onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

// ─── Дедлайны ────────────────────────────────────────────────────

function DeadlinesBar({ d }: { d: CurrentDeadlines }): ReactElement {
  return (
    <Card title="Текущие дедлайны" subtitle="При активном Кванте ускорения — делятся на 10">
      <div style={styles.deadlines}>
        <DeadlineChip label="critical" value={d.critical} />
        <DeadlineChip label="high" value={d.high} />
        <DeadlineChip label="standard" value={d.standard} />
        <DeadlineChip label="background" value={d.background} />
        {d.quantum_acceleration_active ? (
          <Badge tone="info">Квант активен</Badge>
        ) : null}
        {d.info_blockade_active ? (
          <Badge tone="danger">Инфоблокада</Badge>
        ) : null}
      </div>
    </Card>
  );
}

function DeadlineChip({ label, value }: { label: string; value: number }): ReactElement {
  const seconds = Math.round(value / 1000);
  return (
    <div style={styles.deadlineChip}>
      <span style={styles.deadlineLabel}>{label}</span>
      <span style={styles.deadlineValue}>
        {seconds < 60 ? `${seconds} с` : `${Math.round(seconds / 60)} мин`}
      </span>
    </div>
  );
}

// ─── Карточка режима ─────────────────────────────────────────────

function RegimeCard({ regime }: { regime: Regime }): ReactElement {
  const qc = useQueryClient();
  const [deactivating, setDeactivating] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<string[] | null>(null);

  const deactivateM = useMutation({
    mutationFn: (reason: string) =>
      apiPost(`/regimes/${regime.id}/deactivate`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['regimes'] });
      setDeactivating(false);
    },
  });

  const auditM = useMutation({
    mutationFn: () =>
      apiPost<{ regime: Regime; findings: string[] }>(
        `/regimes/${regime.id}/audit`,
        {},
      ),
    onSuccess: (data) => {
      setAuditResult(data.findings ?? []);
      void qc.invalidateQueries({ queryKey: ['regimes'] });
    },
  });

  const accent = TYPE_COLOR[regime.type];

  return (
    <div style={{ ...styles.regimeCard, borderLeftColor: accent }}>
      <div style={styles.regimeHeader}>
        <Badge tone={TYPE_TONE[regime.type]}>{TYPE_LABEL[regime.type]}</Badge>
        <span style={styles.regimeDate}>
          с {new Date(regime.activatedAt).toLocaleString('ru-RU')}
        </span>
      </div>
      <p style={styles.regimeReason}>{regime.reason}</p>
      <div style={styles.regimeActions}>
        <Button
          variant="danger"
          onClick={() => setDeactivating(true)}
        >
          Деактивировать
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setAuditResult(null);
            setAuditing(true);
            void auditM.mutateAsync();
          }}
          disabled={auditM.isPending}
        >
          {auditM.isPending ? '…' : 'Провести аудит'}
        </Button>
      </div>

      {deactivating ? (
        <InlineDeactivate
          onSubmit={(reason) => void deactivateM.mutateAsync(reason)}
          onCancel={() => setDeactivating(false)}
          busy={deactivateM.isPending}
        />
      ) : null}

      {auditing && auditResult ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Результат аудита</div>
          {auditResult.length === 0 ? (
            <p style={styles.muted}>Находок нет</p>
          ) : (
            auditResult.map((f, i) => (
              <div key={i} style={styles.finding}>
                • {f}
              </div>
            ))
          )}
          <Button variant="ghost" onClick={() => { setAuditing(false); setAuditResult(null); }}>
            Закрыть
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function InlineDeactivate({
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
      <Form<DeactivateForm>
        schema={deactivateSchema}
        defaultValues={{ reason: '' }}
        submitLabel="Деактивировать"
        cancelLabel="Отмена"
        onCancel={onCancel}
        loading={busy}
        onSubmit={async (data) => onSubmit(data.reason)}
      >
        <FormInput
          name="reason"
          label="Причина"
          placeholder="Обоснование снятия режима"
          required
        />
      </Form>
    </div>
  );
}

// ─── Мобилизация ─────────────────────────────────────────────────

function MobilizationPanel({
  regimeId,
}: {
  regimeId: string;
}): ReactElement {
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [mobId, setMobId] = useState<string | null>(null);

  const mobQ = useApiQuery<{ data: Mobilization | null }>(
    ['mobilization', regimeId],
    `/regimes/${regimeId}/mobilization`,
  );

  const shareQ = useApiQuery<MobilizationShare>(
    ['mobilization', regimeId, 'share', mobId ?? ''],
    mobId ? `/regimes/mobilization/${mobId}/share` : `/regimes/${regimeId}/mobilization`,
    { enabled: Boolean(mobId) },
  );

  useEffect(() => {
    const id = mobQ.data?.data?.id;
    if (id && id !== mobId) {setMobId(id);}
  }, [mobQ.data, mobId]);

  const startM = useMutation({
    mutationFn: (data: MobilizationForm) =>
      apiPost<Mobilization>(`/regimes/${regimeId}/mobilization`, data),
    onSuccess: (m) => {
      setMobId(m.id);
      setStarting(false);
      void qc.invalidateQueries({ queryKey: ['mobilization'] });
    },
  });

  const confirmM = useMutation({
    mutationFn: () =>
      apiPost(`/regimes/mobilization/${mobId}/confirm`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mobilization'] });
    },
  });

  const refuseM = useMutation({
    mutationFn: (reason: string | undefined) =>
      apiPost(`/regimes/mobilization/${mobId}/refuse`, reason ? { reason } : {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mobilization'] });
      setRefusing(false);
    },
  });

  const mob = mobQ.data?.data ?? null;
  const share = shareQ.data;

  return (
    <Card
      title="Мобилизация"
      subtitle={`Режим: ${regimeId.slice(0, 8)}…`}
    >
      {!mob ? (
        <>
          <p style={styles.muted}>
            Мобилизация не запущена. Нажмите «Начать», чтобы призвать участников.
          </p>
          {!starting ? (
            <Button variant="primary" onClick={() => setStarting(true)}>
              Начать мобилизацию
            </Button>
          ) : (
            <StartMobilizationForm
              onSubmit={(d) => void startM.mutateAsync(d)}
              onCancel={() => setStarting(false)}
              busy={startM.isPending}
            />
          )}
        </>
      ) : (
        <>
          <div style={styles.mobilizationMeta}>
            <span>Требуется: {mob.requiredCount}</span>
            <span>Подтверждено: {mob.confirmedCount}</span>
            <span>Отказалось: {mob.refusedCount}</span>
            <span>Порог: {mob.thresholdPercent}%</span>
          </div>
          {share ? (
            <ProgressBar
              value={share.percent}
              max={100}
              label={`Готовность (${share.confirmed} / ${share.refused} отказалось)`}
            />
          ) : null}
          <div style={styles.mobActions}>
            <Button
              variant="primary"
              onClick={() => void confirmM.mutateAsync()}
              disabled={confirmM.isPending || mob.status !== 'active'}
            >
              Готов прибыть
            </Button>
            <Button
              variant="danger"
              onClick={() => setRefusing(true)}
              disabled={refuseM.isPending || mob.status !== 'active'}
            >
              Отказаться
            </Button>
          </div>
          {refusing ? (
            <RefuseFormInline
              onSubmit={(reason) => void refuseM.mutateAsync(reason)}
              onCancel={() => setRefusing(false)}
              busy={refuseM.isPending}
            />
          ) : null}
          {mob.status !== 'active' ? (
            <p style={styles.muted}>Мобилизация завершена</p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function StartMobilizationForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (d: MobilizationForm) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <Form<MobilizationForm>
      schema={mobilizationSchema}
      defaultValues={{ required_count: 10, threshold_percent: 60 }}
      submitLabel="Начать мобилизацию"
      cancelLabel="Отмена"
      onCancel={onCancel}
      loading={busy}
      onSubmit={async (data) => onSubmit(data)}
    >
      <FormInput
        name="required_count"
        label="Требуется участников"
        type="number"
        required
      />
      <FormInput
        name="threshold_percent"
        label="Порог (%)"
        type="number"
        required
        description="Минимальная доля подтвердивших для завершения"
      />
    </Form>
  );
}

function RefuseFormInline({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (reason: string | undefined) => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <Form<RefuseForm>
      schema={refuseSchema}
      defaultValues={{ reason: '' }}
      submitLabel="Отказаться"
      cancelLabel="Отмена"
      onCancel={onCancel}
      loading={busy}
      onSubmit={async (data) => onSubmit(data.reason || undefined)}
    >
      <FormInput
        name="reason"
        label="Причина (опционально)"
        placeholder="Отказ без санкций (I.1.8.11)"
      />
    </Form>
  );
}

// ─── Модалка активации ───────────────────────────────────────────

function CreateRegimeModal({ onClose }: { onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<RegimeType | null>(null);

  const createM = useMutation({
    mutationFn: (data: ActivateForm) => {
      const context: Record<string, unknown> = {};
      if (data.context_has_threat) {context['hasThreatAboveTenPercent'] = true;}
      if (data.context_no_gateway) {context['noGatewayData'] = true;}
      if (data.context_red_circuit) {context['isRedCircuitRequested'] = true;}
      if (data.context_quantum) {context['isQuantumAccelerationRequested'] = true;}
      if (data.context_global_threat) {context['isGlobalThreat'] = true;}
      if (data.context_last_ptt_at) {context['lastPttAt'] = data.context_last_ptt_at;}

      return apiPost<Regime>('/regimes', {
        type: data.type,
        reason: data.reason,
        context,
      });
    },
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['regimes'] });
      setSuccess(vars.type);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось активировать'),
  });

  if (success) {
    return (
      <div style={styles.modalBackdrop} onClick={onClose}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <Card title="Режим активирован">
            <div style={styles.successBlock}>
              Режим активен. Карточка появится в списке.
              {success === 'steel_bell' ? (
                <>
                  <br />
                  Квант ускорения активирован автоматически.
                </>
              ) : null}
            </div>
            <div style={styles.successActions}>
              <Button variant="primary" onClick={onClose}>
                Понятно
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Активировать режим">
          <Form<ActivateForm>
            schema={activateSchema}
            defaultValues={{
              type: 'steel_bell',
              reason: '',
              context_has_threat: false,
              context_no_gateway: false,
              context_red_circuit: false,
              context_quantum: false,
              context_global_threat: false,
              context_last_ptt_at: '',
            }}
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
              label="Тип режима"
              required
              options={(Object.keys(TYPE_LABEL) as RegimeType[]).map((t) => ({
                value: t,
                label: TYPE_LABEL[t],
              }))}
            />
            <FormInput
              name="reason"
              label="Причина"
              placeholder="Обоснование активации"
              required
            />
            <div style={styles.contextBlock}>
              <div style={styles.contextTitle}>Контекст (для проверки условий)</div>
              <FormCheckbox
                name="context_has_threat"
                label="Угроза > 10% (для steel_bell)"
              />
              <FormCheckbox
                name="context_no_gateway"
                label="Нет данных Шлюза (для info_blockade)"
              />
              <FormCheckbox
                name="context_red_circuit"
                label="Запрошен Красный Контур"
              />
              <FormCheckbox
                name="context_quantum"
                label="Запрошен Квант ускорения"
              />
              <FormCheckbox
                name="context_global_threat"
                label="Глобальная угроза"
              />
              <FormInput
                name="context_last_ptt_at"
                label="Последний ПТТ (ISO, для ptt)"
                placeholder="2020-01-01T00:00:00Z"
              />
            </div>
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
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
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  title: {
    margin: 0,
    fontSize: 22,
    color: colors.text,
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  deadlines: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
  },
  deadlineChip: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    padding: '6px 12px',
    background: colors.bgInput,
    borderRadius: radius.sm,
    minWidth: 90,
  },
  deadlineLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  deadlineValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: 600,
  },
  activeList: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  regimeCard: {
    padding: spacing.md,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderLeft: '4px solid',
    borderLeftColor: colors.primary,
    borderRadius: radius.lg,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  regimeHeader: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  regimeDate: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  regimeReason: {
    margin: 0,
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
  },
  regimeActions: {
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
  subBlockTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  finding: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
  },
  historyList: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  historyRow: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  historyDate: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    flex: 1,
  },
  historyStatus: {
    color: colors.textDim,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  mobilizationMeta: {
    display: 'flex' as const,
    gap: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.sm,
    flexWrap: 'wrap' as const,
  },
  mobActions: {
    display: 'flex' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  contextBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  contextTitle: {
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
  successBlock: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
    padding: spacing.sm,
    background: colors.bgSoft,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
  },
  successActions: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    gap: spacing.sm,
    paddingTop: spacing.md,
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