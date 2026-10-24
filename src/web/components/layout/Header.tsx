// F.4.99.19 — Header
// Имя участника, статус WS, logout, тема.

import { useEffect, useState, type ReactElement } from 'react';


import { useAuth } from '../../hooks/useAuth';
import { useStore } from '../../store';
import { colors, spacing, fontSize, radius } from '../../theme';
import { onStatusChange, getState, connect, disconnect, type WSState } from '../../ws/client';
import { NotificationBell } from '../ui/Notifications';
import { Search } from '../ui/Search';

export function Header(): ReactElement {
  const { user, logout } = useAuth();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const [ws, setWs] = useState<WSState>(() => getState());

  // Подписываемся на статус WS — независимо от user.
  useEffect(() => {
    const off = onStatusChange((s) => setWs(s));
    const t = setInterval(() => setWs(getState()), 5000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  // Подключаемся ТОЛЬКО когда есть user.
  // user.participant.id в зависимостях — реакция на перелогин.
  const userId = user?.participant.id;
  useEffect(() => {
    if (!userId) {return;}
    void connect();
  }, [userId]);

  // Кнопка вручную переподключить, если отвалилось.
  const onWSReconnect = (): void => {
    disconnect();
    setTimeout(() => void connect(), 200);
  };

  const wsColor =
    ws.status === 'connected'
      ? colors.success
      : ws.status === 'reconnecting' || ws.status === 'connecting'
        ? colors.warning
        : colors.danger;

  return (
    <header style={styles.header}>
      <button onClick={toggleSidebar} style={styles.iconBtn} title="Свернуть меню">
        ☰
      </button>

      <div style={styles.spacer} />

      <div style={styles.wsBlock} title={`WebSocket: ${ws.status}`}>
        <span style={{ ...styles.wsDot, background: wsColor }} />
        <span style={styles.wsLabel}>
          {ws.status === 'connected' && ws.latencyMs !== null
            ? `WS ${ws.latencyMs}мс`
            : ws.status}
        </span>
        {ws.status !== 'connected' && (
          <button onClick={onWSReconnect} style={styles.wsReconnect}>↻</button>
        )}
      </div>

      <button onClick={toggleTheme} style={styles.iconBtn} title="Тема">
        {theme === 'dark' ? '☀' : '🌙'}
      </button>
      <Search openOnShortcut={false} placeholder="Поиск…" />
      <NotificationBell />
      <div style={styles.userBlock}>
        <div style={styles.userName}>{user?.participant.name ?? '—'}</div>
        <div style={styles.userId}>{user?.participant.externalId ?? ''}</div>
      </div>

      <button onClick={() => void logout()} style={styles.logoutBtn}>
        Выйти
      </button>
    </header>
  );
}

const styles = {
  header: {
    height: 56,
    background: colors.bgSoft,
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${spacing.md}px`,
    gap: spacing.md,
    flexShrink: 0,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    fontSize: 18,
    cursor: 'pointer',
    padding: 6,
    borderRadius: radius.sm,
  },
  spacer: { flex: 1 },
  wsBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.full,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  wsDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  wsLabel: { fontFamily: 'monospace' },
  wsReconnect: {
    background: 'transparent',
    border: 'none',
    color: colors.warning,
    cursor: 'pointer',
    fontSize: 14,
  },
  userBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    lineHeight: 1.2,
  },
  userName: { fontSize: fontSize.sm, color: colors.text },
  userId: { fontSize: fontSize.xs, color: colors.textDim, fontFamily: 'monospace' },
  logoutBtn: {
    background: 'transparent',
    color: colors.textMuted,
    border: `1px solid ${colors.border}`,
    padding: '6px 12px',
    borderRadius: radius.sm,
    fontSize: fontSize.sm,
    cursor: 'pointer',
  },
};