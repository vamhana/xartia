// src/web/store/index.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Participant } from '../types';

export interface AuthUser {
  participant: Participant;
  roles: string[];
}

export interface NotificationRecord {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface StoreState {
  // auth
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  clearUser: () => void;

  // theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (v: boolean) => void;

  // notifications
  notifications: NotificationRecord[];
  unreadCount: number;
  addNotification: (n: NotificationRecord) => void;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

const MAX_STORED_NOTIFICATIONS = 100;

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (u) => set({ user: u }),
      clearUser: () => set({ user: null }),

      theme: 'dark',
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),

      notifications: [],
      unreadCount: 0,

      addNotification: (n) =>
        set((s) => {
          if (s.notifications.some((x) => x.id === n.id)) {return s;}
          const next = [n, ...s.notifications].slice(
            0,
            MAX_STORED_NOTIFICATIONS,
          );
          return {
            notifications: next,
            unreadCount: next.filter((x) => !x.read).length,
          };
        }),

      markRead: (ids) =>
        set((s) => {
          const set_ = new Set(ids);
          const next = s.notifications.map((x) =>
            set_.has(x.id) ? { ...x, read: true } : x,
          );
          return {
            notifications: next,
            unreadCount: next.filter((x) => !x.read).length,
          };
        }),

      markAllRead: () =>
        set((s) => {
          const next = s.notifications.map((x) => ({ ...x, read: true }));
          return { notifications: next, unreadCount: 0 };
        }),

      removeNotification: (id) =>
        set((s) => {
          const next = s.notifications.filter((x) => x.id !== id);
          return {
            notifications: next,
            unreadCount: next.filter((x) => !x.read).length,
          };
        }),

      clearNotifications: () =>
        set({ notifications: [], unreadCount: 0 }),
    }),
    {
      name: 'xartia.store',
      partialize: (s) => ({
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        // notifications НЕ персистим — при F5 подтянем с сервера
      }),
    },
  ),
);

export const useUser = (): AuthUser | null => useStore((s) => s.user);
export const useTheme = (): 'dark' | 'light' => useStore((s) => s.theme);