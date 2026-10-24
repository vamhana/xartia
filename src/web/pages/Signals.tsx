// F.4.02.06 — Сигналы.
// Master-detail: слева список, справа детали.
// Реальное время: WS-подписка на канал signals.
// Создание сигнала, ответы направления, эскалация.
// URL-sync: ?selected=<id> открывает деталь (из CommandPalette).

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiPost } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { useApiQuery } from '../hooks/useApi';
import { useWSSubscription } from '../hooks/useWS';
import {
  SIGNAL_PRIORITY_LABEL,
  SIGNAL_PRIORITY_TONE,
  SIGNAL_STATUS_LABEL,
  SIGNAL_STATUS_TONE,
  SIGNAL_TYPE_LABEL,
  SIGNAL_RESPONSE_LABEL,
  SIGNAL_RESPONSE_TONE,
  formatDateTime,
} from '../lib/format';
import { useUser } from '../store';
import { colors, spacing, fontSize, radius } from '../theme';
import type {
  Signal,
  SignalResponse,
  SignalPriority,
  SignalType,
  SignalResponseType,
} from '../types';

// -------- Список + детали --------

export function SignalsPage(): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterPriority, setFilterPriority] = useState<SignalPriority | ''>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  const [searchParams] = useSearchParams();
  const selectedFromUrl = searchParams.get('selected');

  useEffect(() => {
    if (selectedFromUrl && selectedFromUrl !== selectedId) {
      setSelectedId(selectedFromUrl);
    }
  }, [selectedFromUrl, selectedId]);

  const qc = useQueryClient();

  // Список
  const listQuery = useApiQuery<{
    data: Signal[];
    meta: { page: number; per_page: number; total: number };
  }>(
    ['signals', 'list', filterPriority, filterStatus],
    `/signals?page=1&per_page=100${filterPriority ? `&priority=${filterPriority}` : ''}${filterStatus ? `&status=${filterStatus}` : ''}`,
    { refetchInterval: 60_000 },
  );

  const signals = listQuery.data?.data ?? [];

  // Детали — только когда выбран сигнал
  const detailQuery = useApiQuery<Signal>(
    ['signal', selectedId ?? ''],
    `/signals/${selectedId ?? ''}`,
    { enabled: !!selectedId },
  );

  const responsesQuery = useApiQuery<{ data: SignalResponse[] }>(
    ['signal-responses', selectedId ?? ''],
    `/signals/${selectedId ?? ''}/responses`,
    { enabled: !!selectedId },
  );

  // -------- WS: real-time обновления --------

  useWSSubscription('signals', (event) => {
    if (event === 'signal.created' || event === 'signal.updated' ||
        event === 'signal.escalated') {
      void qc.invalidateQueries({ queryKey: ['signals'] });
      if (event === 'signal.updated' && selectedId) {
        void qc.invalidateQueries({ queryKey: ['signal', selectedId] });
      }
    }
    if (event === 'signal.response_added' && selectedId) {
      void qc.invalidateQueries({ queryKey: ['signal-responses', selectedId] });
    }
  });

  const selected = detailQuery.data ?? null;
  const responses = responsesQuery.data?.data ?? [];

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>
          Сигналы
          {signals.length > 0 && <span style={styles.count}>({signals.length})</span>}
        </h1>
        <div style={styles.headerActions}>
          <Button
            variant="secondary"
            onClick={() => void listQuery.refetch()}
            loading={listQuery.isFetching}
          >
            Обновить
          </Button>
          <Button onClick={() => setCreating(true)}>+ Новый сигнал</Button>
        </div>
      </div>

      <div style={styles.filters}>
        <label style={styles.filterLabel}>
          Приоритет:
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as SignalPriority | '')}
            style={styles.select}
          >
            <option value="">Все</option>
            <option value="critical">Критический</option>
            <option value="high">Высокий</option>
            <option value="standard">Стандартный</option>
            <option value="background">Фоновый</option>
          </select>
        </label>
        <label style={styles.filterLabel}>
          Статус:
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="">Все</option>
            <option value="new">Новый</option>
            <option value="run">Прогон</option>
            <option value="connect">Коннект</option>
            <option value="plan">План</option>
            <option value="completed">Завершён</option>
            <option value="rejected">Отклонён</option>
          </select>
        </label>
      </div>

      <div style={styles.split}>
        <aside style={styles.list}>
          {listQuery.isLoading ? (
            <Spinner label="Загрузка…" />
          ) : signals.length === 0 ? (
            <div style={styles.empty}>Нет сигналов</div>
          ) : (
            signals.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  ...styles.listItem,
                  ...(s.id === selectedId ? styles.listItemActive : {}),
                }}
              >
                <div style={styles.listItemTop}>
                  <code style={styles.extId}>{s.externalId}</code>
                  <Badge tone={SIGNAL_PRIORITY_TONE[s.priority]}>
                    {SIGNAL_PRIORITY_LABEL[s.priority]}
                  </Badge>
                </div>
                <div style={styles.listItemDesc}>{s.description}</div>
                <div style={styles.listItemMeta}>
                  <Badge tone={SIGNAL_STATUS_TONE[s.status]}>
                    {SIGNAL_STATUS_LABEL[s.status]}
                  </Badge>
                  <span style={styles.dim}>{formatDateTime(s.createdAt)}</span>
                </div>
              </button>
            ))
          )}
        </aside>

        <section style={styles.detail}>
          {creating ? (
            <CreateSignalForm
              onCancel={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                setSelectedId(id);
              }}
            />
          ) : selected ? (
            <SignalDetail
              signal={selected}
              responses={responses}
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ['signal', selected.id] });
                void qc.invalidateQueries({ queryKey: ['signal-responses', selected.id] });
                void qc.invalidateQueries({ queryKey: ['signals'] });
              }}
            />
          ) : (
            <Card>
              <div style={styles.empty}>Выберите сигнал слева или создайте новый</div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

// -------- Детали сигнала --------

function SignalDetail({
  signal,
  responses,
  onChanged,
}: {
  signal: Signal;
  responses: SignalResponse[];
  onChanged: () => void;
}): ReactElement {
  const [replyOpen, setReplyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escalateMutation = useMutation<unknown, Error, void>({
    mutationFn: () => apiPost(`/signals/${signal.id}/escalate`),
    onSuccess: () => onChanged(),
    onError: (e) => setError(e.message),
  });

  const canReply = signal.status !== 'completed' && signal.status !== 'rejected';
  const canEscalate = signal.iterations >= 3 &&
    signal.status !== 'completed' && signal.status !== 'rejected';

  return (
    <>
      <Card
        title={
          <div style={styles.detailHeader}>
            <code style={styles.extId}>{signal.externalId}</code>
            <Badge tone={SIGNAL_PRIORITY_TONE[signal.priority]}>
              {SIGNAL_PRIORITY_LABEL[signal.priority]}
            </Badge>
            <Badge tone={SIGNAL_STATUS_TONE[signal.status]}>
              {SIGNAL_STATUS_LABEL[signal.status]}
            </Badge>
            <Badge tone="info">{SIGNAL_TYPE_LABEL[signal.type]}</Badge>
          </div>
        }
        subtitle={`Итераций: ${signal.iterations}/3 · ${formatDateTime(signal.createdAt)}`}
      >
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Описание</div>
          <div style={styles.fieldText}>{signal.description}</div>
        </div>
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Обоснование</div>
          <div style={styles.fieldText}>{signal.justification}</div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.detailActions}>
          {canReply && (
            <Button onClick={() => setReplyOpen(!replyOpen)}>
              {replyOpen ? 'Отмена' : 'Ответить'}
            </Button>
          )}
          {canEscalate && (
            <Button
              variant="danger"
              onClick={() => escalateMutation.mutate()}
              loading={escalateMutation.isPending}
            >
              Эскалировать в Арбитраж
            </Button>
          )}
        </div>
      </Card>

      {replyOpen && (
        <ReplyForm
          signalId={signal.id}
          onDone={() => {
            setReplyOpen(false);
            onChanged();
          }}
        />
      )}

      <Card title={`Ответы направлений (${responses.length})`}>
        {responses.length === 0 ? (
          <div style={styles.empty}>Пока нет ответов</div>
        ) : (
          <div style={styles.responses}>
            {responses.map((r) => (
              <div key={r.id} style={styles.responseItem}>
                <div style={styles.responseTop}>
                  <Badge tone={SIGNAL_RESPONSE_TONE[r.response]}>
                    {SIGNAL_RESPONSE_LABEL[r.response]}
                  </Badge>
                  <span style={styles.dim}>{formatDateTime(r.createdAt)}</span>
                </div>
                <div style={styles.responseJust}>{r.justification}</div>
                {r.consequences && (
                  <div style={styles.responseExtra}>
                    <strong>Последствия:</strong> {r.consequences}
                  </div>
                )}
                {r.needs && (
                  <div style={styles.responseExtra}>
                    <strong>Потребности:</strong> {r.needs}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// -------- Форма ответа --------

function ReplyForm({
  signalId,
  onDone,
}: {
  signalId: string;
  onDone: () => void;
}): ReactElement {
  const user = useUser();
  const [response, setResponse] = useState<SignalResponseType>('support');
  const [justification, setJustification] = useState('');
  const [consequences, setConsequences] = useState('');
  const [needs, setNeeds] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directionId = user?.participant.directionId ?? '';

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (justification.trim().length === 0) {
      setError('Обоснование обязательно');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost(`/signals/${signalId}/responses`, {
        direction_id: directionId,
        response,
        justification,
        ...(consequences ? { consequences } : {}),
        ...(needs ? { needs } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Ответ направления">
      <form onSubmit={(e) => void onSubmit(e)}>
        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Позиция *</div>
          <div style={styles.radioRow}>
            {(['support', 'object', 'clarify', 'amend', 'no_influence'] as const).map((r) => (
              <label key={r} style={styles.radio}>
                <input
                  type="radio"
                  name="response"
                  checked={response === r}
                  onChange={() => setResponse(r)}
                />
                <span style={{ marginLeft: 6 }}>{SIGNAL_RESPONSE_LABEL[r]}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Обоснование *</div>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            style={styles.textarea}
            disabled={submitting}
          />
        </div>

        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Последствия</div>
          <textarea
            value={consequences}
            onChange={(e) => setConsequences(e.target.value)}
            rows={2}
            style={styles.textarea}
            disabled={submitting}
          />
        </div>

        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Потребности</div>
          <textarea
            value={needs}
            onChange={(e) => setNeeds(e.target.value)}
            rows={2}
            style={styles.textarea}
            disabled={submitting}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.detailActions}>
          <Button type="submit" loading={submitting}>Отправить ответ</Button>
        </div>
      </form>
    </Card>
  );
}

// -------- Форма создания --------

function CreateSignalForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const [type, setType] = useState<SignalType>('problem');
  const [priority, setPriority] = useState<SignalPriority>('standard');
  const [description, setDescription] = useState('');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 5) {
      setError('Описание минимум 5 символов');
      return;
    }
    if (justification.trim().length < 5) {
      setError('Обоснование минимум 5 символов');
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiPost<{ id: string }>('/signals', {
        type,
        priority,
        description,
        justification,
      });
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Новый сигнал">
      <form onSubmit={(e) => void onSubmit(e)}>
        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Тип</div>
          <div style={styles.radioRow}>
            {(['need', 'problem', 'idea', 'failure'] as const).map((t) => (
              <label key={t} style={styles.radio}>
                <input
                  type="radio"
                  name="type"
                  checked={type === t}
                  onChange={() => setType(t)}
                />
                <span style={{ marginLeft: 6 }}>{SIGNAL_TYPE_LABEL[t]}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Приоритет</div>
          <div style={styles.radioRow}>
            {(['critical', 'high', 'standard', 'background'] as const).map((p) => (
              <label key={p} style={styles.radio}>
                <input
                  type="radio"
                  name="priority"
                  checked={priority === p}
                  onChange={() => setPriority(p)}
                />
                <span style={{ marginLeft: 6 }}>{SIGNAL_PRIORITY_LABEL[p]}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Описание *</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={styles.textarea}
            placeholder="Что произошло / что нужно"
            disabled={submitting}
          />
        </div>

        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>Обоснование *</div>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            style={styles.textarea}
            placeholder="Почему это важно"
            disabled={submitting}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.detailActions}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" loading={submitting}>Создать сигнал</Button>
        </div>
      </form>
    </Card>
  );
}

// -------- Стили --------

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, height: '100%', minHeight: 0 } as const,
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    flexShrink: 0,
  } as const,
  h1: { margin: 0, fontSize: 22, color: colors.text } as const,
  count: { color: colors.textMuted, fontWeight: 400, fontSize: fontSize.lg, marginLeft: 8 } as const,
  headerActions: { display: 'flex', gap: spacing.sm } as const,
  filters: {
    display: 'flex',
    gap: spacing.lg,
    marginBottom: spacing.md,
    flexShrink: 0,
  } as const,
  filterLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  } as const,
  select: {
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: '6px 10px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
  } as const,
  split: {
    display: 'grid',
    gridTemplateColumns: '340px 1fr',
    gap: spacing.md,
    flex: 1,
    minHeight: 0,
  } as const,
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    overflowY: 'auto' as const,
    paddingRight: 4,
  } as const,
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
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } as const,
  listItemActive: {
    border: `1px solid ${colors.primary}`,
    background: 'rgba(59, 130, 246, 0.08)',
  } as const,
  listItemTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  } as const,
  listItemDesc: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 1.35,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box' as const,
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  } as const,
  listItemMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: fontSize.xs,
  } as const,
  detail: { overflowY: 'auto' as const } as const,
  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  } as const,
  detailActions: {
    display: 'flex',
    gap: spacing.sm,
    marginTop: spacing.md,
  } as const,
  extId: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: fontSize.xs,
    color: colors.textDim,
    background: colors.bg,
    padding: '2px 6px',
    borderRadius: radius.sm,
  } as const,
  field: { marginBottom: spacing.md } as const,
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  } as const,
  fieldText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const } as const,
  fieldGroup: { marginBottom: spacing.md } as const,
  radioRow: { display: 'flex', flexWrap: 'wrap' as const, gap: spacing.md } as const,
  radio: { display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: fontSize.sm } as const,
  textarea: {
    width: '100%',
    background: colors.bgInput,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: '10px 12px',
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  } as const,
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: `1px solid ${colors.danger}`,
    color: colors.danger,
    padding: '8px 12px',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  } as const,
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center' as const,
    padding: 20,
  } as const,
  responses: { display: 'flex', flexDirection: 'column' as const, gap: spacing.sm } as const,
  responseItem: {
    background: colors.bg,
    padding: '10px 12px',
    borderRadius: radius.md,
    borderLeft: `3px solid ${colors.borderSoft}`,
  } as const,
  responseTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  } as const,
  responseJust: { fontSize: fontSize.sm, color: colors.text, lineHeight: 1.4 } as const,
  responseExtra: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 6 } as const,
  dim: { color: colors.textDim, fontSize: fontSize.xs } as const,
};