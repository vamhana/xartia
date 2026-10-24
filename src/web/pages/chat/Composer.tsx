// F.4.05.05 — Composer.
// textarea + send + reply-плашка + attachments (presigned S3 POST) + mentions.
// Авторесайз до 180px. Drag-and-drop файлов на textarea.
//
// Mentions: выбранные из дропдауна кандидаты запоминаются в pickedMentions
// (а не восстанавливаются из текста регексом), чтобы корректно работать
// с именами, содержащими пробелы, и с одноимёнными участниками.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import { uploadFile } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { formatBytes } from '../../lib/format';
import { colors, fontSize, radius, spacing } from '../../theme';

import type { ChatMessageRich } from './ChannelView';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ComposerAttachment {
  key: string;
  name: string;
  size: number;
  mime: string;
}

export interface MentionCandidate {
  id: string;
  name: string;
}

interface PickedMention {
  id: string;
  /** Что вставили в текст: '@Имя ' (с трейлинг-пробелом). */
  inserted: string;
}

interface Props {
  disabled: boolean;
  replyTo: ChatMessageRich | null;
  onCancelReply: () => void;
  onSend: (
    content: string,
    mentions: string[],
    attachments: ComposerAttachment[],
  ) => Promise<void>;
  /** Кандидаты для автокомплита @. Не критично, если пусто. */
  mentionCandidates?: MentionCandidate[];
}

interface PendingUpload {
  /** Локальный id для key в React (генерится через crypto.randomUUID). */
  id: string;
  name: string;
  status: 'uploading' | 'error';
  error?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Хвост от последнего @ до каретки, если он валиден
 * (без пробелов/переводов).
 */
function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  // Идём назад от каретки до @ или разделителя.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      // Проверим, что слева от @ пробел/начало строки/разделитель,
      // чтобы не срабатывать на email-подобное "a@b".
      const prev = i > 0 ? text[i - 1] : '';
      if (!prev || /[\s(,]/.test(prev)) {
        const q = text.slice(i + 1, caret);
        if (/^[A-Za-zА-Яа-яЁё0-9_-]*$/.test(q)) {
          return { start: i, query: q };
        }
      }
      return null;
    }
    if (/\s/.test(ch ?? '')) {return null;}
    i--;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function Composer({
  disabled,
  replyTo,
  onCancelReply,
  onSend,
  mentionCandidates = [],
}: Props): ReactElement {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pickedMentions, setPickedMentions] = useState<PickedMention[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Авторесайз ──────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {return;}
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // ─── Автокомплит mentions ────────────────────────────────────
  const filteredCandidates = useMemo(() => {
    if (!mentionOpen) {return [];}
    const q = mentionQuery.toLowerCase();
    if (!q) {return mentionCandidates.slice(0, 8);}
    return mentionCandidates
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionOpen, mentionQuery, mentionCandidates]);

  const refreshMentionState = (value: string, caret: number): void => {
    const active = activeMentionQuery(value, caret);
    if (!active || mentionCandidates.length === 0) {
      setMentionOpen(false);
      setMentionQuery('');
      setMentionStart(-1);
      return;
    }
    setMentionOpen(true);
    setMentionQuery(active.query);
    setMentionStart(active.start);
    setMentionIndex(0);
  };

  const onTextChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value;
    setText(value);
    const caret = e.target.selectionStart ?? value.length;
    refreshMentionState(value, caret);
  };

  const insertMention = (candidate: MentionCandidate): void => {
    if (mentionStart < 0) {return;}
    const before = text.slice(0, mentionStart);
    const after = text.slice(mentionStart + 1 + mentionQuery.length);
    const inserted = `@${candidate.name} `;
    const next = before + inserted + after;
    setText(next);
    // Запоминаем, кого выбрали: при submit проверим, что текст всё ещё в теле.
    setPickedMentions((prev) => [
      ...prev.filter((m) => m.id !== candidate.id),
      { id: candidate.id, inserted },
    ]);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionStart(-1);
    // Вернуть фокус и поставить каретку после вставки.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) {return;}
      const pos = before.length + inserted.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // В открытом mention-dropdown перехватываем стрелки/Enter/Esc.
    if (mentionOpen && filteredCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) =>
          (i - 1 + filteredCandidates.length) % filteredCandidates.length,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const picked = filteredCandidates[mentionIndex];
        if (picked) {insertMention(picked);}
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    // Enter без shift — отправка.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  // ─── Attachments ─────────────────────────────────────────────
  const onFilesPicked = (files: FileList | File[]): void => {
    const arr = Array.from(files);
    if (arr.length === 0) {return;}
    void uploadAll(arr);
  };

  const uploadAll = async (files: File[]): Promise<void> => {
    // Каждый файл кладём в pending сразу, чтобы UI показал прогресс.
    const jobs = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
    }));
    setPending((prev) => [
      ...prev,
      ...jobs.map((j) => ({
        id: j.id,
        name: j.file.name,
        status: 'uploading' as const,
      })),
    ]);

    await Promise.all(jobs.map(async (j) => {
      try {
        const result = await uploadFile(j.file);
        setAttachments((prev) => [
          ...prev,
          {
            key: result.key,
            name: result.name,
            size: result.size,
            mime: result.mime,
          },
        ]);
        setPending((prev) => prev.filter((p) => p.id !== j.id));
      } catch (e) {
        setPending((prev) =>
          prev.map((p) =>
            p.id === j.id
              ? { ...p, status: 'error' as const, error: (e as Error).message }
              : p,
          ),
        );
      }
    }));
  };

  const removeAttachment = (key: string): void => {
    setAttachments((prev) => prev.filter((a) => a.key !== key));
  };

  const removePending = (id: string): void => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) {return;}
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onFilesPicked(files);
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!disabled) {setDragOver(true);}
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    // Игнорируем dragleave, если курсор ушёл на дочерний элемент —
    // иначе фон мигает при проходе над textarea/кнопками.
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) {return;}
    setDragOver(false);
  };

  // ─── Submit ──────────────────────────────────────────────────
  const submit = async (): Promise<void> => {
    const content = text.trim();
    if (busy || disabled) {return;}
    if (!content && attachments.length === 0) {return;}
    if (pending.some((p) => p.status === 'uploading')) {
      setError('Дождитесь окончания загрузки вложений');
      return;
    }

    // Оставляем только упоминания, чей вставленный текст всё ещё в теле.
    // Это корректно работает с именами с пробелами и с одноимёнными
    // участниками (каждое выбрано явно), и снимает случаи, когда
    // пользователь стёр упоминание вручную.
    const stillThere = pickedMentions
      .filter((m) => content.includes(m.inserted.trimEnd()))
      .map((m) => m.id);
    const mentions = Array.from(new Set(stillThere));

    setBusy(true);
    setError(null);
    try {
      await onSend(content, mentions, attachments);
      setText('');
      setAttachments([]);
      setPending([]);
      setPickedMentions([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploading = pending.some((p) => p.status === 'uploading');
  const canSubmit = !busy && !disabled && !uploading &&
    (text.trim().length > 0 || attachments.length > 0);

  return (
    <div
      style={dragOver ? styles.rootDrag : styles.root}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {replyTo && (
        <div style={styles.replyBar}>
          <span style={styles.replyLabel}>Ответ на:</span>
          <span style={styles.replyText}>{replyTo.content.slice(0, 120)}</span>
          <button
            type="button"
            onClick={onCancelReply}
            style={styles.replyCancel}
            aria-label="Отменить ответ"
          >
            ×
          </button>
        </div>
      )}

      {(attachments.length > 0 || pending.length > 0) && (
        <div style={styles.chips}>
          {attachments.map((a) => (
            <span key={a.key} style={styles.chipDone} title={a.key}>
              📎 {a.name} <span style={styles.chipMeta}>{formatBytes(a.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.key)}
                style={styles.chipRemove}
                aria-label="Убрать вложение"
              >
                ×
              </button>
            </span>
          ))}
          {pending.map((p) => (
            <span
              key={p.id}
              style={p.status === 'error' ? styles.chipError : styles.chipPending}
              title={p.error ?? p.name}
            >
              {p.status === 'error' ? '⚠ ' : '⏳ '}{p.name}
              <button
                type="button"
                onClick={() => removePending(p.id)}
                style={styles.chipRemove}
                aria-label="Убрать вложение"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={styles.inputRow}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || disabled}
          style={styles.attachBtn}
          title="Прикрепить файл"
          aria-label="Прикрепить файл"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) {onFilesPicked(e.target.files);}
            e.target.value = '';
          }}
        />

        <div style={styles.textareaWrap}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            onClick={(e) => refreshMentionState(text, e.currentTarget.selectionStart ?? 0)}
            rows={1}
            placeholder="Написать сообщение… (Enter — отправить, Shift+Enter — новая строка, @ — упомянуть)"
            disabled={busy || disabled}
            style={styles.textarea}
          />
          {mentionOpen && filteredCandidates.length > 0 && (
            <div style={styles.mentionDropdown}>
              {filteredCandidates.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => {
                    // Не даём textarea потерять фокус — иначе mentionStart сбросится.
                    e.preventDefault();
                    insertMention(c);
                  }}
                  style={i === mentionIndex ? styles.mentionOptionActive : styles.mentionOption}
                >
                  <span style={styles.mentionName}>@{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={!canSubmit}
        >
          {busy ? '…' : '→'}
        </Button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {disabled && (
        <p style={styles.muted}>Канал архивирован — отправка недоступна.</p>
      )}
    </div>
  );
}

export default Composer;

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = {
  root: {
    borderTop: `1px solid ${colors.borderSoft}`,
    background: colors.bgSoft,
    padding: spacing.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  } as const,
  rootDrag: {
    borderTop: `1px solid ${colors.primary}`,
    background: 'rgba(96,165,250,0.06)',
    padding: spacing.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  } as const,
  replyBar: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '4px 8px',
    borderLeft: `2px solid ${colors.primary}`,
    background: 'rgba(96,165,250,0.06)',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
  } as const,
  replyLabel: { color: colors.textMuted, flexShrink: 0 } as const,
  replyText: {
    color: colors.text,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const,
  replyCancel: {
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    fontSize: fontSize.md,
    cursor: 'pointer',
    padding: '0 4px',
  } as const,

  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  } as const,
  chipDone: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    fontSize: fontSize.xs,
    color: colors.text,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const,
  chipPending: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    background: 'rgba(96,165,250,0.10)',
    border: `1px solid ${colors.primary}`,
    borderRadius: radius.sm,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const,
  chipError: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    background: 'rgba(239,68,68,0.08)',
    border: `1px solid ${colors.danger}`,
    borderRadius: radius.sm,
    fontSize: fontSize.xs,
    color: colors.danger,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const,
  chipMeta: { color: colors.textMuted, fontSize: fontSize.xs } as const,
  chipRemove: {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    padding: '0 2px',
    fontSize: fontSize.sm,
    lineHeight: 1,
  } as const,

  inputRow: { display: 'flex', gap: spacing.sm, alignItems: 'flex-end' } as const,
  attachBtn: {
    background: 'transparent',
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.sm,
    color: colors.text,
    cursor: 'pointer',
    fontSize: 16,
    padding: '6px 8px',
    lineHeight: 1,
    flexShrink: 0,
  } as const,
  textareaWrap: { position: 'relative', flex: 1, minWidth: 0 } as const,
  textarea: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'inherit',
    resize: 'none',
    minHeight: 38,
    maxHeight: 180,
    boxSizing: 'border-box',
  } as const,

  mentionDropdown: {
    position: 'absolute',
    bottom: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    maxHeight: 200,
    overflowY: 'auto',
    zIndex: 20,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  } as const,
  mentionOption: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${colors.borderSoft}`,
    cursor: 'pointer',
    color: colors.text,
    font: 'inherit',
    fontSize: fontSize.sm,
  } as const,
  mentionOptionActive: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    background: 'rgba(96,165,250,0.12)',
    border: 'none',
    borderBottom: `1px solid ${colors.borderSoft}`,
    cursor: 'pointer',
    color: colors.text,
    font: 'inherit',
    fontSize: fontSize.sm,
  } as const,
  mentionName: { fontWeight: 500 } as const,

  muted: { color: colors.textMuted, fontSize: fontSize.xs } as const,
  error: { color: colors.danger, fontSize: fontSize.xs } as const,
} as const;