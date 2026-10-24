// F.4.05.06 — CreateChannelModal.
// Создание канала: direct / direction / cell / council / project.
// Для direct — ParticipantPicker. Для остальных — UUID scopeId вручную
// (TODO: заменить на селекторы соответствующих сущностей).

import { useState, type ReactElement } from 'react';

import { apiPost, type ApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { colors, fontSize, radius, spacing } from '../../theme';
import { ParticipantPicker } from '../admin/ParticipantPicker';

import type { ChannelListItem } from './ChatPage';

interface Props {
  onClose: () => void;
  onCreated: (ch: ChannelListItem) => void;
}

type ChannelType = 'direct' | 'direction' | 'cell' | 'council' | 'project';

const TYPE_LABEL: Record<ChannelType, string> = {
  direct:    'Личный (с участником)',
  direction: 'Направление',
  cell:      'Ячейка',
  council:   'Совет',
  project:   'Проект',
};

export function CreateChannelModal({ onClose, onCreated }: Props): ReactElement {
  const [type, setType] = useState<ChannelType>('direct');
  const [peerId, setPeerId] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      let ch: ChannelListItem;
      if (type === 'direct') {
        if (!peerId) {throw new Error('Выберите участника');}
        ch = await apiPost<ChannelListItem>('/chat/channels/direct', {
          participant_id: peerId,
        });
      } else {
        if (!scopeId) {throw new Error('Укажите scopeId (UUID)');}
        ch = await apiPost<ChannelListItem>(
          `/chat/channels/${type}/${scopeId}`,
          name ? { name } : {},
        );
      }
      onCreated(ch);
    } catch (e) {
      const apiErr = e as ApiError;
      setErr(apiErr.message ?? (e as Error).message ?? 'Ошибка создания канала');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Новый канал</h2>
          <button type="button" onClick={onClose} style={styles.close} aria-label="Закрыть">×</button>
        </div>
        <div style={styles.body}>
          <div style={styles.field}>
            <label style={styles.label}>Тип канала</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ChannelType)}
              style={styles.select}
              disabled={busy}
            >
              {(Object.keys(TYPE_LABEL) as ChannelType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>

          {type === 'direct' && (
            <div style={styles.field}>
              <label style={styles.label}>Собеседник</label>
              <ParticipantPicker
                value={peerId}
                onChange={setPeerId}
                disabled={busy}
              />
            </div>
          )}

          {type !== 'direct' && (
            <>
              <div style={styles.field}>
                <label style={styles.label}>
                  {type === 'direction' ? 'Direction ID' :
                   type === 'cell' ? 'Cell ID' :
                   type === 'council' ? 'Council ID' :
                   'Plan ID'} (UUID)
                </label>
                <input
                  type="text"
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  style={styles.input}
                  disabled={busy}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Название (опционально)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={styles.input}
                  disabled={busy}
                />
              </div>
            </>
          )}

          {err && <p style={styles.error}>{err}</p>}

          <div style={styles.actions}>
            <Button variant="primary" onClick={onSubmit} disabled={busy}>
              {busy ? 'Создаём…' : 'Создать'}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateChannelModal;

const styles = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  } as const,
  modal: {
    background: colors.bg,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: radius.md,
    minWidth: 420, maxWidth: 520, width: '90vw',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  } as const,
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.sm, borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  title: { fontSize: fontSize.md, fontWeight: 600, margin: 0, color: colors.text } as const,
  close: {
    border: 'none', background: 'transparent', color: colors.textMuted,
    fontSize: 20, cursor: 'pointer', padding: 4,
  } as const,
  body: {
    padding: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm,
  } as const,
  field: { display: 'flex', flexDirection: 'column', gap: 4 } as const,
  label: {
    fontSize: fontSize.xs, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.4,
  } as const,
  input: {
    padding: '6px 10px', borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft, color: colors.text, fontSize: fontSize.sm,
  } as const,
  select: {
    padding: '6px 10px', borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bgSoft, color: colors.text, fontSize: fontSize.sm,
  } as const,
  actions: { display: 'flex', gap: spacing.sm, marginTop: spacing.sm } as const,
  error: { color: colors.danger, fontSize: fontSize.sm } as const,
} as const;