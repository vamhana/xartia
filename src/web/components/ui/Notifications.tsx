// src/web/components/ui/Notifications.tsx
/**
 * F.4.99.15 — Notifications.
 *
 * Колокольчик + выпадающий список + toasts.
 * WS-подписка через F.4.99.13.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiGet, apiPatch } from '../../api/client';
import { useStore } from '../../store';
import type { NotificationRecord } from '../../store';
import { colors, fontSize, radius, shadow, spacing } from '../../theme';
import { subscribe } from '../../ws/client';


// ─── useNotifications ────────────────────────────────────────────

export interface UseNotificationsResult {
  notifications: NotificationRecord[];
  unreadCount: number;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.unreadCount);
  const markReadStore = useStore((s) => s.markRead);
  const markAllReadStore = useStore((s) => s.markAllRead);
  const addNotification = useStore((s) => s.addNotification);

  // Загрузка истории при маунте / после логина (когда store пуст)
  const historyQ = useQuery({
    queryKey: ['notifications', 'history', 1, 50],
    queryFn: () =>
      apiGet<{ data: NotificationRecord[] }>(
        '/notifications/history?page=1&per_page=50',
      ),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: notifications.length === 0,
  });

  useEffect(() => {
    if (!historyQ.data) {return;}
    const list = historyQ.data.data ?? [];
    // Загружаем в store в хронологическом порядке (старые → новые),
    // чтобы addNotification вставлял их сверху корректно
    for (const n of [...list].reverse()) {
      addNotification(n);
    }
  }, [historyQ.data, addNotification]);

  // WS-подписка (мультивкладка)
  useEffect(() => {
    const unsub = subscribe('notifications', (event, payload) => {
      if (event === 'notification.new') {
        addNotification(payload as NotificationRecord);
      } else if (event === 'notification.read') {
        const p = payload as { ids?: string[] };
        if (p.ids) {markReadStore(p.ids);}
      } else if (event === 'notification.read_all') {
        markAllReadStore();
      }
    });
    return unsub;
  }, [addNotification, markReadStore, markAllReadStore]);

  const markRead = (ids: string[]): void => {
    if (ids.length === 0) {return;}
    // Оптимистично обновляем локально
    markReadStore(ids);
    // На сервер — по одному id (у нас нет batch-эндпоинта)
    for (const id of ids) {
      void apiPatch(`/notifications/${encodeURIComponent(id)}/read`, {}).catch(
        (e) => {
          console.warn('markRead failed', id, e);
        },
      );
    }
  };

  const markAllRead = (): void => {
    markAllReadStore();
    void apiPatch('/notifications/read-all', {}).catch((e) => {
      console.warn('markAllRead failed', e);
    });
  };

  return { notifications, unreadCount, markRead, markAllRead };
}

// ─── Toast API (императивный) ────────────────────────────────────

interface ToastItem {
  id: string;
  notification: NotificationRecord;
  createdAt: number;
}

type ToastListener = (items: ToastItem[]) => void;

let toastItems: ToastItem[] = [];
const toastListeners = new Set<ToastListener>();
const TOAST_TTL_MS = 5000;

function emitToasts(): void {
  for (const l of toastListeners) {l([...toastItems]);}
}

export function showToast(notification: NotificationRecord): void {
  if (toastItems.some((t) => t.id === notification.id)) {return;}
  const item: ToastItem = {
    id: notification.id,
    notification,
    createdAt: Date.now(),
  };
  toastItems = [item, ...toastItems].slice(0, 5);
  emitToasts();
  setTimeout(() => {
    toastItems = toastItems.filter((t) => t.id !== notification.id);
    emitToasts();
  }, TOAST_TTL_MS);
}

// ─── ToastContainer ──────────────────────────────────────────────

export function ToastContainer(): ReactElement {
  const [items, setItems] = useState<ToastItem[]>(toastItems);

  useEffect(() => {
    const listener: ToastListener = (next) => setItems(next);
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);

  return (
    <div style={styles.toastWrap} aria-live="polite">
      {items.map((t) => {
        const n = t.notification;
        const critical = n.priority === 'critical';
        return (
          <div
            key={t.id}
            style={{
              ...styles.toast,
              ...(critical ? styles.toastCritical : {}),
            }}
            role="status"
          >
            <div style={styles.toastTitle}>{n.title}</div>
            <div style={styles.toastBody}>{n.body}</div>
            <button
              type="button"
              style={styles.toastClose}
              onClick={() => {
                toastItems = toastItems.filter((x) => x.id !== t.id);
                emitToasts();
              }}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── NotificationBell ────────────────────────────────────────────

export function NotificationBell(): ReactElement {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {return;}
    const onDoc = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest('[data-notif-bell]')) {return;}
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div style={styles.bellWrap} data-notif-bell>
      <button
        type="button"
        style={styles.bellBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Уведомления (${unreadCount})`}
      >
        <span style={styles.bellIcon}>🔔</span>
        {unreadCount > 0 ? (
          <span style={styles.bellBadge}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div style={styles.dropdown}>
          <NotificationList max={10} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Маппинг типа уведомления → путь для навигации.
 * Если producer положил явный `data.link` — используем его.
 * Иначе — по типу.
 */
function getNotificationLink(n: NotificationRecord): string | null {
  const data = n.data as Record<string, unknown> | undefined;

  // Явный link от отправителя — приоритет
  if (data && typeof data.link === 'string') {return data.link;}

  switch (n.type) {
    case 'task.assigned':
    case 'task.status_changed':
    case 'task.submitted':
    case 'task.accepted':
    case 'task.returned':
      return typeof data?.taskId === 'string'
        ? `/tasks/${data.taskId}/report`
        : '/tasks';

    case 'signal.created':
    case 'signal.updated':
    case 'signal.escalated':
    case 'signal.response_added':
      return '/signals';

    case 'otc.report_submitted':
      return '/otc';

    case 'otc.decision_made':
    case 'otc.crisis_decision':
      return '/tasks';

    case 'otc.appeal_filed':
      return '/otc';

    case 'crisis.mobilization_started':
    case 'crisis.mobilization_confirmed':
    case 'crisis.mobilization_refused':
    case 'crisis.mobilization_completed':
    case 'crisis.plan_activated':
    case 'regime.activated':
    case 'regime.deactivated':
      return '/regimes';

    case 'semantic.alarm':
    case 'semantic.veto':
    case 'semantic.drift':
      return '/semantic';

    case 'integrity.alert':
      return '/verification';

    case 'gateway.transaction':
      return '/gateway';

    case 'community.created':
      return '/planetary';

    case 'test.notification':
      return null;

    default: {
      // Фолбэк по идентификаторам из data: отправители кладут taskId /
      // reportId / signalId, а явный link есть не всегда.
      const taskId = data?.['taskId'] ?? data?.['task_id'];
      if (typeof taskId === 'string') {return `/tasks/${taskId}/report`;}
      const reportId = data?.['reportId'] ?? data?.['report_id'];
      if (typeof reportId === 'string') {return '/otc';}
      const signalId = data?.['signalId'] ?? data?.['signal_id'];
      if (typeof signalId === 'string') {return '/signals';}
      return null;
    }
  }
}
// ─── NotificationList ────────────────────────────────────────────

export interface NotificationListProps {
  max?: number;
  /** Закрыть выпадашку после перехода к событию. */
  onNavigate?: () => void;
}

export function NotificationList({
  max = 10,
  onNavigate,
}: NotificationListProps): ReactElement {
  const { notifications, unreadCount, markRead, markAllRead } =
    useNotifications();
  const navigate = useNavigate();

  const visible = useMemo(
    () => notifications.slice(0, max),
    [notifications, max],
  );

  const onItemClick = (n: NotificationRecord): void => {
    if (!n.read) {markRead([n.id]);}
    const link = getNotificationLink(n);
    if (link) {
      navigate(link);
      onNavigate?.();
    }
  };

  return (
    <div style={styles.list}>
      <div style={styles.listHeader}>
        <span style={styles.listTitle}>Уведомления</span>
        {unreadCount > 0 ? (
          <button
            type="button"
            style={styles.markAllBtn}
            onClick={markAllRead}
          >
            Прочитать все
          </button>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <div style={styles.listEmpty}>Нет уведомлений</div>
      ) : (
        visible.map((n) => {
          const link = getNotificationLink(n);
          const clickable = !n.read || link !== null;
          return (
            <div
              key={n.id}
              style={{
                ...styles.item,
                ...(n.read ? {} : styles.itemUnread),
                cursor: clickable ? 'pointer' : 'default',
              }}
              onClick={clickable ? () => onItemClick(n) : undefined}
              role={link ? 'link' : undefined}
            >
              <div style={styles.itemTitle}>{n.title}</div>
              <div style={styles.itemBody}>{n.body}</div>
              <div style={styles.itemMeta}>
                {new Date(n.createdAt).toLocaleString('ru-RU')}
                {n.read ? '' : ' · новое'}
                {link ? ' · →' : ''}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Notifications (композит) ────────────────────────────────────

export interface NotificationsProps {
  max?: number;
  showBell?: boolean;
}

export function Notifications({
  max,
  showBell = true,
}: NotificationsProps): ReactElement {
  if (showBell) {
    return <NotificationBell />;
  }
  return (
    <div style={styles.dropdown}>
      <NotificationList {...(max !== undefined ? { max } : {})} />
    </div>
  );
}

// ─── Стили ───────────────────────────────────────────────────────

const styles = {
  bellWrap: { position: 'relative' as const },
  bellBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 6,
    borderRadius: radius.sm,
    position: 'relative' as const,
    lineHeight: 1,
  },
  bellIcon: { fontSize: 18 },
  bellBadge: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    background: colors.danger,
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 5px',
    borderRadius: radius.full,
    lineHeight: 1.2,
  },
  dropdown: {
    position: 'absolute' as const,
    top: 'calc(100% + 6px)',
    right: 0,
    width: 360,
    maxHeight: 480,
    overflowY: 'auto' as const,
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    boxShadow: shadow.lg,
    zIndex: 50,
  },
  list: { padding: 0 },
  listHeader: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  listTitle: {
    color: colors.text,
    fontWeight: 600,
    fontSize: fontSize.sm,
  },
  markAllBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    fontSize: fontSize.xs,
    padding: 0,
  },
  listEmpty: {
    padding: spacing.lg,
    textAlign: 'center' as const,
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  item: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.borderSoft}`,
    cursor: 'pointer',
  },
  itemUnread: { background: 'rgba(96,165,250,0.08)' },
  itemTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: 500 },
  itemBody: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  itemMeta: { color: colors.textDim, fontSize: 10, marginTop: 4 },
  toastWrap: {
    position: 'fixed' as const,
    bottom: 20,
    right: 20,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 8,
    zIndex: 9999,
    maxWidth: 360,
  },
  toast: {
    background: colors.bgSoft,
    border: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${colors.primary}`,
    borderRadius: radius.md,
    padding: `${spacing.sm}px ${spacing.md}px`,
    boxShadow: shadow.lg,
    position: 'relative' as const,
  },
  toastCritical: { borderLeftColor: colors.danger },
  toastTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: 600,
    paddingRight: 20,
  },
  toastBody: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  toastClose: {
    position: 'absolute' as const,
    top: 4,
    right: 6,
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
  },
};