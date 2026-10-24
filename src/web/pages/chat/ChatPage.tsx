// F.4.05.01 — Chat page.
// 2-колоночный master-detail: список каналов | окно сообщений.
//
// Deep link: /chat?channel=<channelId> (строковый, например 'direct:<a>:<b>').
//
// На узких экранах (< 768px) показывается либо список, либо открытый
// канал: выбор панели определяется наличием параметра ?channel= в URL.
// Тот же deep-link, что и на десктопе, — просто список и канал
// не помещаются рядом.
//
// Не использует useWSSubscription на верхнем уровне — подписка только
// в ChannelView (на открытый канал). Список каналов обновляется refetchInterval.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { useApiQuery } from '../../hooks/useApi';
import { colors, spacing } from '../../theme';

import { ChannelList } from './ChannelList';
import { ChannelView } from './ChannelView';

// ─────────────────────────────────────────────────────────────────
// Types (совпадают с C.0.36.02.ChannelListItem)
// ─────────────────────────────────────────────────────────────────

export interface ChannelListItem {
  id: string;
  channelId: string;
  channelType: 'direct' | 'direction' | 'cell' | 'council' | 'project';
  scopeId: string | null;
  name: string | null;
  displayName: string;
  peerId: string | null;
  peerName: string | null;
  peerExternalId: string | null;
  archivedAt: string | null;
  createdAt: string;
  lastMessage: {
    id: string;
    senderId: string;
    content: string;
    createdAt: string;
  } | null;
}

interface ListEnvelope<T> {
  data: T[];
  audit_id: string;
}

const MOBILE_BREAKPOINT_PX = 768;

// ─────────────────────────────────────────────────────────────────
// useMediaQuery
// ─────────────────────────────────────────────────────────────────

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') {return false;}
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {return;}
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent): void => setMatches(e.matches);
    // Начальное значение — на случай SSR/гидратации.
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// ─────────────────────────────────────────────────────────────────
// ChatPage
// ─────────────────────────────────────────────────────────────────

export function ChatPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const selectedChannelId = params.get('channel');

  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);

  const channelsQ = useApiQuery<ListEnvelope<ChannelListItem>>(
    ['chat', 'channels'],
    '/chat/channels',
    { refetchInterval: 30_000 },
  );

  const channels = channelsQ.data?.data ?? [];

  const selected = useMemo(() => {
    if (!selectedChannelId) {return null;}
    return channels.find((c) => c.channelId === selectedChannelId) ?? null;
  }, [selectedChannelId, channels]);

  const select = (ch: ChannelListItem | null): void => {
    const next = new URLSearchParams(params);
    if (ch) {
      next.set('channel', ch.channelId);
    } else {
      next.delete('channel');
    }
    setParams(next, { replace: true });
  };

  // Мобильная вёрстка: либо список, либо открытый канал.
  if (isMobile) {
    if (selected) {
      return (
        <div style={styles.root}>
          <ChannelView
            key={selected.channelId}
            channel={selected}
            onBack={() => select(null)}
            onChannelRemoved={() => {
              void channelsQ.refetch();
              select(null);
            }}
          />
        </div>
      );
    }
    return (
      <div style={styles.root}>
        <ChannelList
          channels={channels}
          selectedChannelId={selectedChannelId}
          loading={channelsQ.isLoading}
          onSelect={select}
          onCreated={(ch) => {
            void channelsQ.refetch();
            select(ch);
          }}
        />
      </div>
    );
  }

  // Десктопная вёрстка: две колонки.
  return (
    <div style={styles.root}>
      <ChannelList
        channels={channels}
        selectedChannelId={selectedChannelId}
        loading={channelsQ.isLoading}
        onSelect={select}
        onCreated={(ch) => {
          void channelsQ.refetch();
          select(ch);
        }}
      />

      {selected ? (
        <ChannelView
          key={selected.channelId}
          channel={selected}
          onChannelRemoved={() => {
            void channelsQ.refetch();
            select(null);
          }}
        />
      ) : (
        <div style={styles.emptyPane}>
          {channelsQ.isLoading ? (
            <Spinner label="Загружаем каналы…" />
          ) : channelsQ.isError ? (
            <Card title="Ошибка"><p>Не удалось загрузить каналы</p></Card>
          ) : (
            <p style={styles.emptyText}>
              Выберите канал слева или создайте новый.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ChatPage;

const styles = {
  root: {
    display: 'flex',
    gap: 0,
    height: '100%',
    background: colors.bg,
  } as const,
  emptyPane: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  } as const,
  emptyText: { color: colors.textMuted },
} as const;