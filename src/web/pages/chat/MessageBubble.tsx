// F.4.05.04 — MessageBubble.
// Одно сообщение: аватар, автор, время, reply-quote, edit/delete на hover.
// Attachments: список файлов, клик — открытие через GET /files/:key/meta
// (presigned URL в JSON, а не 302 redirect — иначе браузер не отправит
// Authorization при обычной навигации).
// Mentions: подсветка @Name через splitMentions из lib/format; «вас
// упомянули» — сравнение с currentUserName.

import { useState, type MouseEvent, type ReactElement } from 'react';

import { getFileMeta } from '../../api/client';
import { formatBytes, splitMentions } from '../../lib/format';
import { colors, fontSize, radius, spacing } from '../../theme';

import type { ChatMessageRich } from './ChannelView';

interface Props {
  message: ChatMessageRich;
  isOwn: boolean;
  /** Имя текущего пользователя для подсветки «вас упомянули». */
  currentUserName?: string | null;
  onReply: () => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
  });
}

function initial(name: string | null): string {
  if (!name) {return '?';}
  return name.trim().charAt(0).toUpperCase();
}

function iconForMime(mime: string): string {
  if (mime.startsWith('image/')) {return '🖼';}
  if (mime.startsWith('video/')) {return '🎬';}
  if (mime.startsWith('audio/')) {return '🎵';}
  if (mime === 'application/pdf') {return '📕';}
  if (mime.startsWith('text/')) {return '📄';}
  return '📎';
}

export function MessageBubble({
  message, isOwn, currentUserName, onReply, onEdit, onDelete,
}: Props): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [hover, setHover] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const isDeleted = Boolean(message.deletedAt);

  if (isDeleted) {
    return (
      <div style={styles.row}>
        <div style={styles.deleted}>Сообщение удалено</div>
      </div>
    );
  }

  const onSave = (): void => {
    if (!draft.trim() || draft.trim() === message.content) {
      setEditing(false);
      return;
    }
    onEdit(draft.trim());
    setEditing(false);
  };

  const openAttachment = async (
    e: MouseEvent<HTMLButtonElement>,
    key: string,
  ): Promise<void> => {
    e.preventDefault();
    if (openingKey) {return;}
    setOpeningKey(key);
    setOpenError(null);
    try {
      const meta = await getFileMeta(key);
      // Программный click на <a target="_blank"> не блокируется
      // popup-blocker'ом, в отличие от window.open после async-запроса.
      const a = document.createElement('a');
      a.href = meta.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setOpenError((err as Error).message || 'Не удалось открыть файл');
    } finally {
      setOpeningKey(null);
    }
  };

  const tokens = splitMentions(message.content);

  return (
    <div
      style={isOwn ? styles.rowOwn : styles.row}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={isOwn ? styles.avatarOwn : styles.avatar}>
        {initial(message.senderName)}
      </div>
      <div style={styles.body}>
        <div style={styles.meta}>
          <span style={styles.author}>
            {message.senderName ?? message.senderId.slice(0, 8)}
          </span>
          <span style={styles.time}>{formatTime(message.createdAt)}</span>
          {message.editedAt && <span style={styles.edited}>(ред.)</span>}
        </div>

        {message.replyTo && (
          <div style={styles.reply}>
            <span style={styles.replyMark}>↪</span>
            <span style={styles.replyText}>{message.replyTo.content}</span>
          </div>
        )}

        {editing ? (
          <div style={styles.editWrap}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              style={styles.editArea}
              autoFocus
            />
            <div style={styles.editActions}>
              <button type="button" onClick={onSave} style={styles.btnPrimary}>OK</button>
              <button
                type="button"
                onClick={() => {setEditing(false); setDraft(message.content);}}
                style={styles.btnGhost}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.text}>
            {tokens.map((t, i) => {
              if (!t.isMention) {
                return <span key={i}>{t.text}</span>;
              }
              const name = t.text.slice(1).toLowerCase();
              const isSelf = Boolean(
                currentUserName && name === currentUserName.toLowerCase(),
              );
              return (
                <span key={i} style={isSelf ? styles.mentionSelf : styles.mention}>
                  {t.text}
                </span>
              );
            })}
          </div>
        )}

        {message.attachments.length > 0 && (
          <div style={styles.attachments}>
            {message.attachments.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={(e) => void openAttachment(e, a.key)}
                disabled={openingKey === a.key}
                style={styles.attachment}
                title={a.key}
              >
                <span style={styles.attachmentIcon}>{iconForMime(a.mime)}</span>
                <span style={styles.attachmentName}>{a.name}</span>
                <span style={styles.attachmentSize}>{formatBytes(a.size)}</span>
                {openingKey === a.key && <span style={styles.attachmentLoading}>…</span>}
              </button>
            ))}
          </div>
        )}

        {openError && <p style={styles.attachmentError}>{openError}</p>}

        {hover && !editing && (
          <div style={styles.actions}>
            <button type="button" onClick={onReply} style={styles.actionBtn}>Ответ</button>
            {isOwn && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  style={styles.actionBtn}
                >
                  Изменить
                </button>
                <button type="button" onClick={onDelete} style={styles.actionBtnDanger}>
                  Удалить
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;

const styles = {
  row: { display: 'flex', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm } as const,
  rowOwn: { display: 'flex', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm, flexDirection: 'row-reverse' } as const,
  avatar: {
    width: 32, height: 32, borderRadius: '50%',
    background: colors.border, color: colors.text,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: fontSize.sm, fontWeight: 600, flexShrink: 0,
  } as const,
  avatarOwn: {
    width: 32, height: 32, borderRadius: '50%',
    background: colors.primary, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: fontSize.sm, fontWeight: 600, flexShrink: 0,
  } as const,
  body: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } as const,
  meta: { display: 'flex', alignItems: 'baseline', gap: spacing.sm } as const,
  author: { fontSize: fontSize.sm, fontWeight: 500, color: colors.text } as const,
  time: { fontSize: fontSize.xs, color: colors.textMuted } as const,
  edited: { fontSize: fontSize.xs, color: colors.textDim } as const,

  reply: {
    borderLeft: `2px solid ${colors.primary}`,
    padding: '2px 8px',
    margin: '2px 0',
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: fontSize.sm, color: colors.textMuted,
    background: 'rgba(96,165,250,0.06)',
    borderRadius: radius.sm,
  } as const,
  replyMark: { color: colors.primary } as const,
  replyText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,

  text: {
    fontSize: fontSize.sm,
    color: colors.text,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  } as const,
  mention: {
    background: 'rgba(96,165,250,0.15)',
    color: colors.primary,
    borderRadius: 3,
    padding: '0 3px',
  } as const,
  mentionSelf: {
    background: 'rgba(245,158,11,0.20)',
    color: colors.warning,
    borderRadius: 3,
    padding: '0 3px',
    fontWeight: 600,
  } as const,

  attachments: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 4,
  } as const,
  attachment: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    color: colors.text,
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
    maxWidth: '100%',
    alignSelf: 'flex-start',
  } as const,
  attachmentIcon: { fontSize: 14, flexShrink: 0 } as const,
  attachmentName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 260,
  } as const,
  attachmentSize: { color: colors.textMuted, fontSize: fontSize.xs, flexShrink: 0 } as const,
  attachmentLoading: { color: colors.textMuted, fontSize: fontSize.xs } as const,
  attachmentError: {
    color: colors.danger,
    fontSize: fontSize.xs,
    marginTop: 2,
  } as const,

  editWrap: { display: 'flex', flexDirection: 'column', gap: 4 } as const,
  editArea: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical',
  } as const,
  editActions: { display: 'flex', gap: 6 } as const,
  btnPrimary: {
    padding: '4px 10px',
    borderRadius: radius.sm,
    border: 'none',
    background: colors.primary,
    color: '#fff',
    cursor: 'pointer',
    fontSize: fontSize.xs,
  } as const,
  btnGhost: {
    padding: '4px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.borderSoft}`,
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: fontSize.xs,
  } as const,
  actions: { display: 'flex', gap: 6, marginTop: 2 } as const,
  actionBtn: {
    padding: '2px 8px',
    borderRadius: radius.sm,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: fontSize.xs,
  } as const,
  actionBtnDanger: {
    padding: '2px 8px',
    borderRadius: radius.sm,
    border: 'none',
    background: 'transparent',
    color: colors.danger,
    cursor: 'pointer',
    fontSize: fontSize.xs,
  } as const,
  deleted: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    fontStyle: 'italic',
    padding: '4px 0',
  } as const,
} as const;