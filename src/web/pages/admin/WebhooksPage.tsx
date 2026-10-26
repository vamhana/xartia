// F.4.04.10 — Admin → Webhooks.
//
// Полное управление подписками: создание/редактирование/удаление,
// проверка доставки, история и повтор failed-доставок, ротация секрета.

import type { ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiDelete, apiGet, apiPatch, apiPost } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { colors, fontSize, radius, spacing } from '../../theme';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  delivered: 'success',
  pending: 'info',
  retrying: 'warning',
  failed: 'danger',
};

export function WebhooksPage(): ReactElement {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<Webhook | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiGet<{ data: Webhook[] }>('/webhooks'),
  });
  const eventsQ = useQuery({
    queryKey: ['webhooks', 'events'],
    queryFn: () => apiGet<{ data: string[] }>('/webhooks/events'),
  });

  const testM = useMutation({
    mutationFn: (id: string) => apiPost<{ sent: boolean }>(`/webhooks/${id}/test`, {}),
    onSuccess: (r) => {
      setNotice(r.sent ? 'Тестовая доставка отправлена' : 'Не удалось отправить тест');
      void qc.invalidateQueries({ queryKey: ['webhooks', 'deliveries'] });
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : 'Ошибка теста'),
  });

  const rotateM = useMutation({
    mutationFn: (id: string) => apiPost<{ secret: string }>(`/webhooks/${id}/rotate-secret`, {}),
    onSuccess: (r) => {
      setNotice(`Новый секрет (сохраните): ${r.secret}`);
      void qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : 'Ошибка ротации'),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiDelete(`/webhooks/${id}`),
    onSuccess: () => {
      setNotice('Webhook удалён');
      void qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : 'Ошибка удаления'),
  });

  const toggleM = useMutation({
    mutationFn: (w: Webhook) => apiPatch(`/webhooks/${w.id}`, { active: !w.active }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e) => setNotice(e instanceof Error ? e.message : 'Ошибка'),
  });

  const items = listQ.data?.data ?? [];
  const events = eventsQ.data?.data ?? [];

  if (listQ.isLoading) {return <Spinner label="Загрузка webhooks…" />;}

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Webhooks</h1>
        <Button variant="primary" onClick={() => setEditing('new')}>+ Создать webhook</Button>
      </header>

      {notice && (
        <div style={styles.notice} onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {items.length === 0 ? (
        <Card title="Подписок нет" subtitle="Внешние интеграции (V.6, V.7)">
          <p style={styles.muted}>
            Создайте webhook, чтобы отправлять события Хартии во внешние системы.
          </p>
        </Card>
      ) : (
        <Card title="Подписки" subtitle={`${items.length} шт.`}>
          {items.map((w) => (
            <div key={w.id} style={styles.row}>
              <div style={styles.main}>
                <code style={styles.url}>{w.url}</code>
                <div style={styles.events}>
                  {w.events.map((e) => <Badge key={e} tone="info">{e}</Badge>)}
                </div>
                <div style={styles.muted}>
                  создан {new Date(w.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <div style={styles.actions}>
                <Badge tone={w.active ? 'success' : 'default'}>{w.active ? 'активен' : 'выключен'}</Badge>
                <Button variant="ghost" size="sm" onClick={() => toggleM.mutate(w)}>
                  {w.active ? 'Выключить' : 'Включить'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={testM.isPending && testM.variables === w.id}
                  onClick={() => testM.mutate(w.id)}
                >
                  Тест
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setHistoryFor(w)}>
                  История
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(w)}>
                  Изменить
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={rotateM.isPending && rotateM.variables === w.id}
                  onClick={() => rotateM.mutate(w.id)}
                >
                  Новый секрет
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Удалить webhook ${w.url}?`)) {deleteM.mutate(w.id);}
                  }}
                >
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {editing && (
        <WebhookForm
          webhook={editing === 'new' ? null : editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setNotice(message);
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['webhooks'] });
          }}
        />
      )}

      {historyFor && (
        <DeliveriesModal webhook={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

function WebhookForm({
  webhook,
  events,
  onClose,
  onSaved,
}: {
  webhook: Webhook | null;
  events: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactElement {
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [selected, setSelected] = useState<string[]>(webhook?.events ?? []);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveM = useMutation({
    mutationFn: async () => {
      if (webhook) {
        return apiPatch(`/webhooks/${webhook.id}`, { url, events: selected });
      }
      const created = await apiPost<{ secret: string }>('/webhooks', {
        url,
        events: selected,
        ...(secret ? { secret } : {}),
      });
      return created;
    },
    onSuccess: (r) => {
      if (!webhook && r && typeof r === 'object' && 'secret' in r) {
        onSaved(`Webhook создан. Секрет (показывается один раз): ${String(r.secret)}`);
      } else {
        onSaved('Webhook сохранён');
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Ошибка'),
  });

  const toggleEvent = (e: string): void => {
    setSelected((prev) => prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <b>{webhook ? 'Изменить webhook' : 'Новый webhook'}</b>
          <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
        </div>

        <label style={styles.label}>URL *</label>
        <input
          style={styles.input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/hooks/xartia"
        />

        <label style={styles.label}>События *</label>
        <div style={styles.eventGrid}>
          {events.map((e) => (
            <label key={e} style={styles.eventItem}>
              <input
                type="checkbox"
                checked={selected.includes(e)}
                onChange={() => toggleEvent(e)}
              />
              <span>{e}</span>
            </label>
          ))}
        </div>

        {!webhook && (
          <>
            <label style={styles.label}>Секрет (необязательно)</label>
            <input
              style={styles.input}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="16–128 символов; если пусто — сгенерируется"
            />
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.modalActions}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            loading={saveM.isPending}
            disabled={!url || selected.length === 0}
            onClick={() => saveM.mutate()}
          >
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeliveriesModal({
  webhook,
  onClose,
}: {
  webhook: Webhook;
  onClose: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['webhooks', 'deliveries', webhook.id],
    queryFn: () => apiGet<{ data: Delivery[]; total: number }>(
      `/webhooks/${webhook.id}/deliveries?per_page=100`,
    ),
  });

  const retryM = useMutation({
    mutationFn: (deliveryId: string) =>
      apiPost<{ delivered: boolean }>(`/webhooks/${webhook.id}/retry/${deliveryId}`, {}),
    onSuccess: (r) => {
      setNotice(r.delivered ? 'Доставлено' : 'Повтор не удался');
      void qc.invalidateQueries({ queryKey: ['webhooks', 'deliveries', webhook.id] });
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : 'Ошибка'),
  });

  const items = q.data?.data ?? [];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modalWide} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <b>История доставок</b>
          <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
        </div>
        <div style={styles.muted}>{webhook.url} · всего {q.data?.total ?? 0}</div>
        {notice && <div style={styles.notice}>{notice}</div>}
        {q.isLoading && <div style={styles.muted}>Загрузка…</div>}
        {items.length === 0 && !q.isLoading && <div style={styles.muted}>Доставок ещё не было</div>}
        {items.map((d) => (
          <div key={d.id} style={styles.deliveryRow}>
            <Badge tone={TONE[d.status] ?? 'default'}>{d.status}</Badge>
            <span style={styles.deliveryEvent}>{d.event}</span>
            <span style={styles.muted}>попыток {d.attempts}</span>
            <span style={styles.muted}>HTTP {d.responseStatus ?? '—'}</span>
            <span style={styles.muted}>{new Date(d.createdAt).toLocaleString('ru-RU')}</span>
            {(d.status === 'failed' || d.status === 'retrying') && (
              <Button
                variant="secondary"
                size="sm"
                loading={retryM.isPending && retryM.variables === d.id}
                onClick={() => retryM.mutate(d.id)}
              >
                Повторить
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: spacing.md },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  h1: { fontSize: fontSize.xl, fontWeight: 600, margin: 0, color: colors.text },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  notice: {
    padding: spacing.sm,
    background: 'rgba(96,165,250,0.15)',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    color: colors.text,
    wordBreak: 'break-all' as const,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
    flexWrap: 'wrap' as const,
  },
  main: { display: 'flex', flexDirection: 'column' as const, gap: 4, minWidth: 260, flex: 1 },
  url: { fontFamily: 'ui-monospace, monospace', fontSize: fontSize.sm, color: colors.text, wordBreak: 'break-all' as const },
  events: { display: 'flex', gap: 4, flexWrap: 'wrap' as const },
  actions: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modal: {
    width: 'min(620px, 94vw)',
    maxHeight: '88vh',
    overflow: 'auto' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  modalWide: {
    width: 'min(900px, 96vw)',
    maxHeight: '88vh',
    overflow: 'auto' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.sm,
  },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  label: { fontSize: fontSize.sm, color: colors.text, fontWeight: 600 },
  input: {
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    padding: '8px 10px',
    fontSize: fontSize.sm,
  },
  eventGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 },
  eventItem: { display: 'flex', gap: 6, alignItems: 'center', fontSize: fontSize.sm, color: colors.text },
  error: { color: colors.danger, fontSize: fontSize.sm },
  deliveryRow: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: fontSize.sm,
    flexWrap: 'wrap' as const,
  },
  deliveryEvent: { flex: 1, color: colors.text, fontFamily: 'ui-monospace, monospace' },
};
