// src/web/pages/Jury.tsx
/**
 * F.4.02.14 — Jury page.
 *
 * Сессии, голосование, decision, votes, outside-trust, appeals.
 * Списка сессий нет в API — работаем через UUID (см. A.1.22.01).
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
import { Form, FormInput, FormTextarea, FormSelect } from '../components/ui/Form';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { useUser } from '../store';
import { colors, fontSize, radius, spacing } from '../theme';

// ─── Типы ────────────────────────────────────────────────────────

type SessionType = 'normal_12' | 'extended_24';
type VoteValue = 'yes' | 'no' | 'abstain';
type OutsideTrustStatus = 'active' | 'reviewed' | 'lifted';

interface JurySession {
  id: string;
  type: SessionType;
  subjectId: string;
  participants: string[];
  moderatorId: string;
  votes: Record<string, VoteValue>;
  decision: string | null;
  decidedAt: string | null;
  createdAt?: string;
}

interface VoteCount {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}

interface OutsideTrust {
  participantId: string;
  reason: string;
  validFrom: string;
  reviewAt: string;
  status: OutsideTrustStatus;
  liftedAt: string | null;
}

// ─── Константы ───────────────────────────────────────────────────

const TYPE_LABEL: Record<SessionType, string> = {
  normal_12: 'Обычная (12)',
  extended_24: 'Расширенная (24)',
};

const OUTSIDE_LABEL: Record<OutsideTrustStatus, string> = {
  active: 'Активен',
  reviewed: 'Пересмотрен',
  lifted: 'Снят',
};

const OUTSIDE_TONE: Record<OutsideTrustStatus, BadgeTone> = {
  active: 'danger',
  reviewed: 'warning',
  lifted: 'success',
};

const VOTE_LABEL: Record<VoteValue, string> = {
  yes: 'За',
  no: 'Против',
  abstain: 'Воздержался',
};

// ─── Схемы ───────────────────────────────────────────────────────

const createSessionSchema = z.object({
  type: z.enum(['normal_12', 'extended_24']),
  subject_id: z.string().uuid('UUID субъекта'),
  exclude_ids_text: z.string().optional(),
});

type CreateSessionForm = z.infer<typeof createSessionSchema>;

const voteSchema = z.object({
  participant_id: z.string().optional(),
  vote: z.enum(['yes', 'no', 'abstain']),
});

type VoteForm = z.infer<typeof voteSchema>;

const decisionSchema = z.object({
  decision: z.string().min(1, 'Введите решение').max(5000),
});

type DecisionForm = z.infer<typeof decisionSchema>;

const outsideTrustSchema = z.object({
  participant_id: z.string().uuid('UUID участника'),
  reason: z.string().min(1, 'Причина').max(2000),
});

type OutsideTrustForm = z.infer<typeof outsideTrustSchema>;

const appealSchema = z.object({
  jury_session_id: z.string().optional(),
  council_type: z.string().min(1, 'Укажите тип совета').max(64),
  subject_id: z.string().uuid('UUID субъекта'),
});

type AppealForm = z.infer<typeof appealSchema>;

// ─── Страница ────────────────────────────────────────────────────

export function JuryPage(): ReactElement {
  const [sessionId, setSessionId] = useState('');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Жюри</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Создать сессию
        </Button>
      </div>

      <Card
        title="Открыть сессию"
        subtitle="Списка сессий нет — введите UUID (см. audit_id из события jury.session_created)"
      >
        <div style={styles.openRow}>
          <input
            style={styles.input}
            placeholder="UUID сессии"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!sessionId.trim()}
            onClick={() => setOpenSessionId(sessionId.trim())}
          >
            Открыть
          </Button>
        </div>
      </Card>

      {openSessionId ? (
        <SessionPanel
          sessionId={openSessionId}
          onClose={() => setOpenSessionId(null)}
        />
      ) : null}

      <OutsideTrustPanel />
      <AppealsPanel />

      {creating ? (
        <CreateSessionModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenSessionId(id);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Сессия ──────────────────────────────────────────────────────

function SessionPanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const user = useUser();
  const [voting, setVoting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sessionQ = useApiQuery<JurySession>(
    ['jury', 'session', sessionId],
    `/jury/sessions/${sessionId}`,
    { refetchInterval: 10_000 },
  );
  const votesQ = useApiQuery<VoteCount>(
    ['jury', 'votes', sessionId],
    `/jury/sessions/${sessionId}/votes`,
    { refetchInterval: 10_000 },
  );

  const voteM = useMutation({
    mutationFn: (data: VoteForm) =>
      apiPost<JurySession>(`/jury/sessions/${sessionId}/vote`, {
        ...(data.participant_id ? { participant_id: data.participant_id } : {}),
        vote: data.vote,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jury', 'session', sessionId] });
      void qc.invalidateQueries({ queryKey: ['jury', 'votes', sessionId] });
      setVoting(false);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось проголосовать'),
  });

  const decideM = useMutation({
    mutationFn: (data: DecisionForm) =>
      apiPost<JurySession>(`/jury/sessions/${sessionId}/decision`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jury', 'session', sessionId] });
      setDeciding(false);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось вынести решение'),
  });

  if (sessionQ.isLoading) {
    return (
      <Card title="Сессия">
        <Spinner />
      </Card>
    );
  }
  if (sessionQ.isError || !sessionQ.data) {
    return (
      <Card title="Сессия">
        <p style={styles.muted}>Не удалось загрузить</p>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </Card>
    );
  }

  const s = sessionQ.data;
  const votes = votesQ.data;
  const voted = Boolean(s.votes[user?.participant.id ?? '']);
  const isDecided = Boolean(s.decidedAt);

  return (
    <Card
      title={`Сессия ${sessionId.slice(0, 8)}…`}
      actions={
        <Badge tone={isDecided ? 'success' : 'warning'}>
          {isDecided ? 'Решено' : 'В процессе'}
        </Badge>
      }
      subtitle={TYPE_LABEL[s.type]}
    >
      <div style={styles.sessionMeta}>
        <span>Участников: {s.participants.length}</span>
        <span>Модератор: {s.moderatorId.slice(0, 8)}…</span>
        <span>Субъект: {s.subjectId.slice(0, 8)}…</span>
      </div>

      {/* Счётчик */}
      {votes ? (
        <div style={styles.votesRow}>
          <VoteChip label="За" value={votes.yes} tone="success" />
          <VoteChip label="Против" value={votes.no} tone="danger" />
          <VoteChip label="Воздержался" value={votes.abstain} tone="default" />
          <span style={styles.votesTotal}>Всего: {votes.total}</span>
        </div>
      ) : null}

      {!isDecided ? (
        <div style={styles.subBlock}>
          <div style={styles.subBlockTitle}>Голосование</div>
          {voted ? (
            <p style={styles.muted}>
              Вы уже проголосовали: {VOTE_LABEL[s.votes[user?.participant.id ?? ''] ?? 'abstain']}
            </p>
          ) : !voting ? (
            <div style={styles.voteBtns}>
              <Button
                variant="primary"
                onClick={() =>
                  void voteM.mutateAsync({ vote: 'yes' })
                }
                disabled={voteM.isPending}
              >
                За
              </Button>
              <Button
                variant="danger"
                onClick={() => void voteM.mutateAsync({ vote: 'no' })}
                disabled={voteM.isPending}
              >
                Против
              </Button>
              <Button
                variant="ghost"
                onClick={() => void voteM.mutateAsync({ vote: 'abstain' })}
                disabled={voteM.isPending}
              >
                Воздержаться
              </Button>
              <Button
                variant="secondary"
                onClick={() => setVoting(true)}
              >
                Голосовать за участника
              </Button>
            </div>
          ) : (
            <Form<VoteForm>
              schema={voteSchema}
              defaultValues={{ participant_id: '', vote: 'yes' }}
              submitLabel="Проголосовать"
              cancelLabel="Отмена"
              onCancel={() => setVoting(false)}
              loading={voteM.isPending}
              onSubmit={async (data) => {
                await voteM.mutateAsync(data);
              }}
            >
              <FormInput
                name="participant_id"
                label="UUID участника сессии (для голоса за него)"
                required
              />
              <FormSelect
                name="vote"
                label="Голос"
                required
                options={[
                  { value: 'yes', label: 'За' },
                  { value: 'no', label: 'Против' },
                  { value: 'abstain', label: 'Воздержаться' },
                ]}
              />
              {err ? <div style={styles.error}>{err}</div> : null}
            </Form>
          )}
        </div>
      ) : null}

      {/* Решение */}
      <div style={styles.subBlock}>
        <div style={styles.subBlockTitle}>Решение</div>
        {s.decision ? (
          <>
            <p style={styles.decisionText}>{s.decision}</p>
            {s.decidedAt ? (
              <span style={styles.muted}>
                Принято {new Date(s.decidedAt).toLocaleString('ru-RU')}
              </span>
            ) : null}
          </>
        ) : !deciding ? (
          <Button
            variant="primary"
            onClick={() => setDeciding(true)}
          >
            Вынести решение
          </Button>
        ) : (
          <Form<DecisionForm>
            schema={decisionSchema}
            defaultValues={{ decision: '' }}
            submitLabel="Вынести"
            cancelLabel="Отмена"
            onCancel={() => setDeciding(false)}
            loading={decideM.isPending}
            onSubmit={async (data) => {
              await decideM.mutateAsync(data);
            }}
          >
            <FormTextarea
              name="decision"
              label="Текст решения"
              rows={4}
              required
              maxLength={5000}
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        )}
      </div>

      <div style={styles.actions}>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    </Card>
  );
}

function VoteChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: BadgeTone;
}): ReactElement {
  return (
    <div style={styles.voteChip}>
      <span style={styles.voteChipLabel}>{label}</span>
      <Badge tone={tone}>{String(value)}</Badge>
    </div>
  );
}

// ─── Модалка создания сессии ─────────────────────────────────────

function CreateSessionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: CreateSessionForm) => {
      const excludeIds = (data.exclude_ids_text ?? '')
        .split(/[,\s;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return apiPost<JurySession>('/jury/sessions', {
        type: data.type,
        subject_id: data.subject_id,
        ...(excludeIds.length > 0 ? { exclude_ids: excludeIds } : {}),
      });
    },
    onSuccess: (s) => onCreated(s.id),
    onError: (e) => setErr((e as Error).message || 'Не удалось создать'),
  });

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <Card title="Новая сессия">
          <Form<CreateSessionForm>
            schema={createSessionSchema}
            defaultValues={{
              type: 'normal_12',
              subject_id: '',
              exclude_ids_text: '',
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
              label="Тип сессии"
              required
              options={[
                { value: 'normal_12', label: 'Обычная (12)' },
                { value: 'extended_24', label: 'Расширенная (24)' },
              ]}
            />
            <FormInput
              name="subject_id"
              label="UUID субъекта"
              placeholder="UUID участника или решения"
              required
            />
            <FormTextarea
              name="exclude_ids_text"
              label="Исключить из выборки (UUID через запятую, опционально)"
              rows={2}
            />
            {err ? <div style={styles.error}>{err}</div> : null}
          </Form>
        </Card>
      </div>
    </div>
  );
}

// ─── Outside-trust ───────────────────────────────────────────────

function OutsideTrustPanel(): ReactElement {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [lookupFor, setLookupFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: OutsideTrustForm) =>
      apiPost<OutsideTrust>('/jury/outside-trust-network', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jury', 'outside'] });
      setCreating(false);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось'),
  });

  return (
    <Card
      title="Вне сети доверия"
      subtitle="Срок 6 месяцев до пересмотра (I.4.4)"
      actions={
        <Button variant="secondary" onClick={() => setCreating(true)}>
          + Назначить
        </Button>
      }
    >
      <div style={styles.openRow}>
        <input
          style={styles.input}
          placeholder="UUID участника"
          value={lookupId}
          onChange={(e) => setLookupId(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!lookupId.trim()}
          onClick={() => setLookupFor(lookupId.trim())}
        >
          Проверить
        </Button>
      </div>

      {lookupFor ? (
        <OutsideTrustCheck
          participantId={lookupFor}
          onClose={() => setLookupFor(null)}
        />
      ) : null}

      {creating ? (
        <div style={styles.modalBackdrop} onClick={() => setCreating(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <Card title="Назначить outside-trust">
              <Form<OutsideTrustForm>
                schema={outsideTrustSchema}
                defaultValues={{ participant_id: '', reason: '' }}
                submitLabel="Назначить"
                onCancel={() => setCreating(false)}
                loading={createM.isPending}
                onSubmit={async (data) => {
                  setErr(null);
                  await createM.mutateAsync(data);
                }}
              >
                <FormInput
                  name="participant_id"
                  label="UUID участника"
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
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function OutsideTrustCheck({
  participantId,
  onClose,
}: {
  participantId: string;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const statusQ = useApiQuery<{ data: OutsideTrust | null }>(
    ['jury', 'outside', participantId],
    `/jury/outside-trust-network/${participantId}`,
  );

  const reviewM = useMutation({
    mutationFn: () =>
      apiPost<OutsideTrust>(
        `/jury/outside-trust-network/${participantId}/review`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jury', 'outside', participantId] });
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось снять'),
  });

  if (statusQ.isLoading) {
    return <Spinner />;
  }

  const t = statusQ.data?.data;

  return (
    <div style={styles.subBlock}>
      <div style={styles.subBlockTitle}>Статус {participantId.slice(0, 8)}…</div>
      {!t ? (
        <p style={styles.muted}>Не в outside-trust</p>
      ) : (
        <>
          <div style={styles.outsideRow}>
            <Badge tone={OUTSIDE_TONE[t.status]}>
              {OUTSIDE_LABEL[t.status]}
            </Badge>
            <span style={styles.muted}>
              Review: {new Date(t.reviewAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
          <p style={styles.muted}>{t.reason}</p>
          {t.status !== 'lifted' ? (
            <Button
              variant="primary"
              onClick={() => void reviewM.mutateAsync()}
              disabled={reviewM.isPending}
            >
              {reviewM.isPending ? '…' : 'Пересмотреть'}
            </Button>
          ) : null}
          {err ? <div style={styles.error}>{err}</div> : null}
        </>
      )}
      <Button variant="ghost" onClick={onClose}>Закрыть</Button>
    </div>
  );
}

// ─── Апелляции ───────────────────────────────────────────────────

function AppealsPanel(): ReactElement {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (data: AppealForm) =>
      apiPost('/jury/appeals', {
        jury_session_id: data.jury_session_id || null,
        council_type: data.council_type,
        subject_id: data.subject_id,
      }),
    onSuccess: () => {
      setOpen(false);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || 'Не удалось подать'),
  });

  return (
    <Card
      title="Апелляции"
      subtitle="Срок подачи — 24 часа с момента решения (I.3.4)"
      actions={
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Подать
        </Button>
      }
    >
      <p style={styles.muted}>
        Просмотр поданных апелляций в текущей ревизии недоступен — в API нет
        GET /jury/appeals/:id (см. A.1.22.01, техдолг).
      </p>

      {open ? (
        <div style={styles.modalBackdrop} onClick={() => setOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <Card title="Новая апелляция">
              <Form<AppealForm>
                schema={appealSchema}
                defaultValues={{
                  jury_session_id: '',
                  council_type: 'APPELLATE',
                  subject_id: '',
                }}
                submitLabel="Подать"
                onCancel={() => setOpen(false)}
                loading={createM.isPending}
                onSubmit={async (data) => {
                  setErr(null);
                  await createM.mutateAsync(data);
                }}
              >
                <FormInput
                  name="jury_session_id"
                  label="UUID сессии Жюри (опционально)"
                />
                <FormInput
                  name="council_type"
                  label="Тип совета"
                  placeholder="APPELLATE / COUNCIL / GATEWAY"
                  required
                />
                <FormInput
                  name="subject_id"
                  label="UUID субъекта"
                  required
                />
                {err ? <div style={styles.error}>{err}</div> : null}
              </Form>
            </Card>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  page: { display: 'flex' as const, flexDirection: 'column' as const, gap: spacing.md },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  title: { margin: 0, fontSize: 22, color: colors.text },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    flex: 1,
    minWidth: 200,
  },
  openRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
  },
  sessionMeta: {
    display: 'flex' as const,
    gap: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.xs,
    flexWrap: 'wrap' as const,
    marginBottom: spacing.sm,
  },
  votesRow: {
    display: 'flex' as const,
    gap: spacing.md,
    alignItems: 'center' as const,
    padding: spacing.sm,
    background: colors.bgInput,
    borderRadius: radius.sm,
    flexWrap: 'wrap' as const,
  },
  voteChip: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  voteChipLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  votesTotal: {
    marginLeft: 'auto',
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  voteBtns: {
    display: 'flex' as const,
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
  },
  subBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  subBlockTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  decisionText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 1.5,
    margin: 0,
  },
  actions: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    paddingTop: spacing.sm,
    borderTop: `1px solid ${colors.borderSoft}`,
    marginTop: spacing.sm,
  },
  outsideRow: {
    display: 'flex' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
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
  modal: { width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const },
};