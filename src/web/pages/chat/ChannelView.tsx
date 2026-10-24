// F.4.05.03 — ChannelView.
// Окно открытого канала: история + Composer + WS.
//
// onSend расширен: (content, mentions, attachments).
// Участники для автокомплита @ загружаются через
// GET /chat/channels/:id/members (rich, F.4.05.0x).
// confirm/alert заменены на модалки.
// 404 канала → заглушка «Канал недоступен» с кнопкой «← К списку».
//
// onBack (опционально) — кнопка «←» в шапке для мобильного layout.
// На десктопе не передаётся, шапка рендерится без неё.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { apiDelete, apiGet, apiPatch, apiPost } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useApiQuery } from '../../hooks/useApi';
import { useWSSubscription } from '../../hooks/useWS';
import { useUser } from '../../store';
import { colors, fontSize, radius, spacing } from '../../theme';

import type { ChannelListItem } from './ChatPage';
import { Composer } from './Composer';
import type { ComposerAttachment, MentionCandidate } from './Composer';
import { MessageBubble } from './MessageBubble';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ChatMessageRich {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  mentions: string[];
  attachments: Array<{ key: string; name: string; size: number; mime: string }>;
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  senderName: string | null;
  senderExternalId: string | null;
  replyTo: { id: string; senderId: string; content: string } | null;
}

/** Rich-форма участника канала — ответ GET /chat/channels/:id/members. */
interface ChannelMemberRich {
  id: string;
  channelId: string;
  participantId: string;
  validFrom: string;
  validTo: string | null;
  name: string | null;
  externalId: string | null;
  pseudonym: string | null;
}

interface Props {
  channel: ChannelListItem;
  onChannelRemoved: () => void;
  /** На мобильной вёрстке — вернуться к списку. На десктопе не передаётся. */
  onBack?: () => void;
}
const PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function isNotFound(err: Error | null): boolean {
  if (!err) {return false;}
  const e = err as Error & { status?: number };
  if (e.status === 404) {return true;}
  return /not.?found/i.test(err.message);
}

// ─────────────────────────────────────────────────────────────────
// Modal shell
// ─────────────────────────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}): ReactElement {
  return (
    <div style={styles.modalBackdrop} onClick={busy ? undefined : onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            style={styles.modalClose}
            aria-label="Закрыть"
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ChannelView
// ─────────────────────────────────────────────────────────────────

export function ChannelView({ channel, onChannelRemoved, onBack }: Props): ReactElement {
  const user = useUser();
  const me = user?.participant.id ?? '';
  const myName = user?.participant.name ?? null;

  const [messages, setMessages] = useState<ChatMessageRich[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<boolean>(false);
  const [replyTo, setReplyTo] = useState<ChatMessageRich | null>(null);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Начальная загрузка.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setHasMore(true);
    setError(null);
    setFatal(false);
    setReplyTo(null);

    apiFetchHistory(channel.id, null)
      .then((items) => {
        if (cancelled) {return;}
        const asc = [...items].reverse();
        setMessages(asc);
        setHasMore(items.length === PAGE_SIZE);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) {return;}
        setError(e.message);
        setFatal(isNotFound(e));
        setLoading(false);
      });

    return () => {cancelled = true;};
  }, [channel.id]);

  // Скролл вниз при новых сообщениях, если пользователь у дна.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) {return;}
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) {return;}
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
  };

  // WS — на комнату канала.
  useWSSubscription(`chat:${channel.channelId}`, (event, payload) => {
    const p = payload as {
      channelId?: string;
      message?: ChatMessageRich;
      messageId?: string;
    };

    if (event === 'chat.message' && p.message) {
      const incoming = p.message;
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) {return prev;}
        return [...prev, incoming];
      });
      return;
    }
    if (event === 'chat.message_edited' && p.message) {
      const edited = p.message;
      setMessages((prev) => prev.map((m) => (m.id === edited.id ? edited : m)));
      return;
    }
    if (event === 'chat.message_deleted' && p.messageId) {
      const deletedId = p.messageId;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === deletedId
            ? { ...m, deletedAt: new Date().toISOString(), content: '' }
            : m,
        ),
      );
    }
  });

  // Участники канала — для автокомплита @. Для direct каналов массив
  // пустой (chat_channel_members не заполняется), автокомплит просто
  // не сработает — это ожидаемо.
  const membersQ = useApiQuery<{ data: ChannelMemberRich[] }>(
    ['chat', 'channel-members', channel.id],
    `/chat/channels/${channel.id}/members`,
    { enabled: channel.channelType !== 'direct' },
  );

  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    const list = membersQ.data?.data ?? [];
    return list
      .filter((m) => m.participantId !== me && Boolean(m.name))
      .map((m) => ({ id: m.participantId, name: m.name as string }));
  }, [membersQ.data, me]);

  const loadMore = async (): Promise<void> => {
    if (loadingMore || !hasMore || messages.length === 0) {return;}
    const first = messages[0];
    if (!first) {return;}
    setLoadingMore(true);
    try {
      const items = await apiFetchHistory(channel.id, first.createdAt);
      const asc = [...items].reverse();
      setMessages((prev) => [...asc, ...prev]);
      setHasMore(items.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const onSend = async (
    content: string,
    mentions: string[],
    attachments: ComposerAttachment[],
  ): Promise<void> => {
    const created = await apiPost<ChatMessageRich>(
      `/chat/channels/${channel.id}/messages`,
      {
        content,
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(replyTo ? { reply_to_id: replyTo.id } : {}),
      },
    );
    setMessages((prev) => {
      if (prev.some((m) => m.id === created.id)) {return prev;}
      return [...prev, created];
    });
    setReplyTo(null);
    stickToBottomRef.current = true;
  };

  const onEdit = async (id: string, content: string): Promise<void> => {
    const updated = await apiPatch<ChatMessageRich>(`/chat/messages/${id}`, { content });
    setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
  };

  const onDelete = async (id: string): Promise<void> => {
    await apiDelete(`/chat/messages/${id}`);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, deletedAt: new Date().toISOString(), content: '' } : m,
      ),
    );
  };

  const doLeave = async (): Promise<void> => {
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPost(`/chat/channels/${channel.id}/leave`, {});
      onChannelRemoved();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const doArchive = async (): Promise<void> => {
    const reason = archiveReason.trim();
    if (!reason) {
      setActionError('Причина обязательна');
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPost(`/chat/channels/${channel.id}/archive`, { reason });
      onChannelRemoved();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const canLeave = channel.channelType !== 'direct';
  const canArchive = channel.channelType !== 'direct' && !channel.archivedAt;

  // Fatal-заглушка: канал недоступен (404).
  if (fatal) {
    return (
      <section style={styles.root}>
        <header style={styles.header}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={styles.backBtn}
              aria-label="К списку каналов"
            >
              ←
            </button>
          )}
          <div style={styles.headerMain}>
            <h2 style={styles.h2}>{channel.displayName}</h2>
          </div>
        </header>
        <div style={styles.fatalPane}>
          <p style={styles.fatalTitle}>Канал недоступен</p>
          <p style={styles.fatalText}>{error ?? 'Канал не найден или у вас нет доступа.'}</p>
          <Button variant="secondary" onClick={onChannelRemoved}>
            ← К списку каналов
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section style={styles.root}>
      <header style={styles.header}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={styles.backBtn}
            aria-label="К списку каналов"
          >
            ←
          </button>
        )}
        <div style={styles.headerMain}>
          <h2 style={styles.h2}>{channel.displayName}</h2>
          {channel.channelType !== 'direct' && (
            <Badge tone="info">{channel.channelType}</Badge>
          )}
          {channel.peerExternalId && (
            <span style={styles.muted}>· {channel.peerExternalId}</span>
          )}
        </div>
        <div style={styles.headerActions}>
          {canLeave && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)}>
              Покинуть
            </Button>
          )}
          {canArchive && (
            <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
              Архивировать
            </Button>
          )}
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} style={styles.scroll}>
        {loading ? (
          <Spinner label="Загружаем историю…" />
        ) : error && !fatal ? (
          <p style={styles.error}>{error}</p>
        ) : (
          <>
            {hasMore && (
              <div style={styles.loadMoreWrap}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Загружаем…' : '↑ Показать ещё'}
                </Button>
              </div>
            )}
            {messages.length === 0 && (
              <p style={styles.empty}>Сообщений пока нет</p>
            )}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                isOwn={m.senderId === me}
                currentUserName={myName}
                onReply={() => setReplyTo(m)}
                onEdit={(content) => onEdit(m.id, content)}
                onDelete={() => onDelete(m.id)}
              />
            ))}
          </>
        )}
      </div>

      <Composer
        disabled={Boolean(channel.archivedAt)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={onSend}
        mentionCandidates={mentionCandidates}
      />

      {confirmLeave && (
        <Modal
          title="Покинуть канал?"
          onClose={() => { setConfirmLeave(false); setActionError(null); }}
          busy={actionBusy}
        >
          <p style={styles.modalText}>
            Вы перестанете получать сообщения из «{channel.displayName}».
            Вернуться можно будет через повторное вступление.
          </p>
          {actionError && <p style={styles.error}>{actionError}</p>}
          <div style={styles.modalActions}>
            <Button variant="ghost" onClick={() => setConfirmLeave(false)} disabled={actionBusy}>
              Отмена
            </Button>
            <Button variant="danger" onClick={() => void doLeave()} disabled={actionBusy}>
              {actionBusy ? '…' : 'Покинуть'}
            </Button>
          </div>
        </Modal>
      )}

      {archiveOpen && (
        <Modal
          title="Архивировать канал"
          onClose={() => { setArchiveOpen(false); setArchiveReason(''); setActionError(null); }}
          busy={actionBusy}
        >
          <p style={styles.modalText}>
            После архивации отправка сообщений станет недоступна.
            Действие необратимо через UI.
          </p>
          <textarea
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            rows={3}
            placeholder="Причина (1..2000)"
            style={styles.modalTextarea}
            disabled={actionBusy}
            autoFocus
          />
          {actionError && <p style={styles.error}>{actionError}</p>}
          <div style={styles.modalActions}>
            <Button
              variant="ghost"
              onClick={() => { setArchiveOpen(false); setArchiveReason(''); setActionError(null); }}
              disabled={actionBusy}
            >
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => void doArchive()}
              disabled={actionBusy || archiveReason.trim().length === 0}
            >
              {actionBusy ? '…' : 'Архивировать'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────

async function apiFetchHistory(
  channelDbId: string,
  before: string | null,
): Promise<ChatMessageRich[]> {
  const qs = new URLSearchParams();
  qs.set('limit', String(PAGE_SIZE));
  if (before) {qs.set('before', before);}
  const res = await apiGet<{ data: ChatMessageRich[] }>(
    `/chat/channels/${channelDbId}/messages?${qs.toString()}`,
  );
  return res.data;
}

export default ChannelView;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' } as const,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
    background: colors.bgSoft,
  } as const,
  backBtn: {
    background: 'transparent',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    color: colors.text,
    cursor: 'pointer',
    fontSize: fontSize.md,
    padding: '4px 10px',
    marginRight: spacing.sm,
    flexShrink: 0,
  } as const,
  headerMain: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
  } as const,
  headerActions: { display: 'flex', gap: spacing.xs, flexShrink: 0 } as const,
  h2: { fontSize: fontSize.md, fontWeight: 600, margin: 0, color: colors.text } as const,
  muted: { color: colors.textMuted, fontSize: fontSize.sm } as const,
  scroll: { flex: 1, overflowY: 'auto', padding: spacing.md } as const,
  loadMoreWrap: { display: 'flex', justifyContent: 'center', marginBottom: spacing.sm } as const,
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg } as const,
  error: { color: colors.danger, textAlign: 'center', padding: spacing.sm, fontSize: fontSize.sm } as const,

  fatalPane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  } as const,
  fatalTitle: { margin: 0, fontSize: fontSize.lg, color: colors.text } as const,
  fatalText: { margin: 0, color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' } as const,

  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as const,
  modal: {
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    minWidth: 380,
    maxWidth: 520,
    width: '90vw',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as const,
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  modalTitle: { fontSize: fontSize.md, fontWeight: 600, color: colors.text } as const,
  modalClose: {
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
  } as const,
  modalBody: {
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  } as const,
  modalText: { margin: 0, color: colors.text, fontSize: fontSize.sm, lineHeight: 1.5 } as const,
  modalTextarea: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  } as const,
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  } as const,
} as const;