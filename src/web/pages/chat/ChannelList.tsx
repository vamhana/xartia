// F.4.05.02 — ChannelList.
// Список каналов + фильтр + кнопка создания.

import { useMemo, useState, type ReactElement } from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { colors, fontSize, radius, spacing } from '../../theme';

import type { ChannelListItem } from './ChatPage';
import { CreateChannelModal } from './CreateChannelModal';

interface Props {
  channels: ChannelListItem[];
  selectedChannelId: string | null;
  loading: boolean;
  onSelect: (ch: ChannelListItem | null) => void;
  onCreated: (ch: ChannelListItem) => void;
}

const TYPE_ICON: Record<ChannelListItem['channelType'], string> = {
  direct:    '👤',
  direction: '🧭',
  cell:      '🏢',
  council:   '⚖️',
  project:   '📦',
};

const TYPE_LABEL: Record<ChannelListItem['channelType'], string> = {
  direct:    'Личный',
  direction: 'Направление',
  cell:      'Ячейка',
  council:   'Совет',
  project:   'Проект',
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) {return 'сейчас';}
  const s = Math.floor(ms / 1000);
  if (s < 3600) {return `${Math.floor(s / 60)} мин`;}
  const m = Math.floor(s / 60);
  if (m < 1440) {return `${Math.floor(m / 60)} ч`;}
  return `${Math.floor(m / 1440)} дн`;
}

export function ChannelList({
  channels, selectedChannelId, loading, onSelect, onCreated,
}: Props): ReactElement {
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {return channels;}
    return channels.filter((c) =>
      c.displayName.toLowerCase().includes(q) ||
      c.channelType.toLowerCase().includes(q) ||
      (c.peerExternalId ?? '').toLowerCase().includes(q),
    );
  }, [channels, filter]);

  return (
    <aside style={styles.aside}>
      <div style={styles.header}>
        <h2 style={styles.title}>Чаты</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setCreating(true)}
          title="Создать канал"
        >
          +
        </Button>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Поиск по каналам"
        style={styles.filter}
      />

      <div style={styles.list}>
        {loading && channels.length === 0 && (
          <Spinner label="Загружаем…" />
        )}
        {!loading && visible.length === 0 && (
          <p style={styles.empty}>Каналов нет</p>
        )}
        {visible.map((c) => {
          const isActive = c.channelId === selectedChannelId;
          return (
            <button
              key={c.channelId}
              type="button"
              onClick={() => onSelect(c)}
              style={isActive ? styles.itemActive : styles.item}
            >
              <span style={styles.icon}>{TYPE_ICON[c.channelType]}</span>
              <div style={styles.itemMain}>
                <div style={styles.itemTop}>
                  <span style={styles.itemName}>{c.displayName}</span>
                  {c.lastMessage && (
                    <span style={styles.time}>{formatRelative(c.lastMessage.createdAt)}</span>
                  )}
                </div>
                <div style={styles.itemBottom}>
                  {c.lastMessage ? (
                    <span style={styles.preview}>{c.lastMessage.content}</span>
                  ) : (
                    <Badge tone="default">{TYPE_LABEL[c.channelType]}</Badge>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {creating && (
        <CreateChannelModal
          onClose={() => setCreating(false)}
          onCreated={(ch) => {
            setCreating(false);
            onCreated(ch);
          }}
        />
      )}
    </aside>
  );
}

const styles = {
  aside: {
    width: 300,
    flexShrink: 0,
    background: colors.bgSoft,
    borderRight: `1px solid ${colors.borderSoft}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as const,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.borderSoft}`,
  } as const,
  title: { fontSize: fontSize.md, fontWeight: 600, margin: 0, color: colors.text } as const,
  filter: {
    margin: spacing.sm,
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: fontSize.sm,
  } as const,
  list: { flex: 1, overflowY: 'auto', padding: `0 ${spacing.xs}px ${spacing.sm}px` } as const,
  empty: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center', padding: spacing.md } as const,
  item: {
    display: 'flex',
    gap: spacing.sm,
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: 'none',
    background: 'transparent',
    color: colors.text,
    font: 'inherit',
    cursor: 'pointer',
    marginBottom: 2,
  } as const,
  itemActive: {
    display: 'flex',
    gap: spacing.sm,
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: 'none',
    background: 'rgba(96,165,250,0.12)',
    color: colors.text,
    font: 'inherit',
    cursor: 'pointer',
    marginBottom: 2,
  } as const,
  icon: { fontSize: 18, width: 22, flexShrink: 0 } as const,
  itemMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } as const,
  itemTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 } as const,
  itemName: { fontSize: fontSize.sm, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,
  time: { fontSize: fontSize.xs, color: colors.textMuted, flexShrink: 0 } as const,
  itemBottom: { display: 'flex', alignItems: 'center' } as const,
  preview: { fontSize: fontSize.xs, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,
} as const;