// F.4.99.16 — Глобальная реактивность: события WS инвалидируют кэш запросов.
//
// Без этого страницы обновлялись только по таймеру/ручному refetch, хотя
// W-модули уже шлют task.assigned, signal.created, treasury.* и т.д.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { subscribe } from '../ws/client';

/** Канал WS → какие корни React Query перезапрашивать. */
const CHANNEL_KEYS: Record<string, string[]> = {
  tasks: ['tasks', 'workspace', 'naryad', 'balance', 'cells'],
  signals: ['signals', 'balance', 'workspace'],
  balance: ['balance', 'workspace'],
  treasury: ['treasury', 'operations'],
  council: ['councils', 'council', 'treasury'],
  otc: ['otc', 'tasks'],
  regimes: ['regimes'],
  crisis: ['balance', 'regimes', 'tasks'],
  semantic: ['semantic'],
  connectivity: ['collective', 'connections'],
  psy: ['psy'],
  pulse: ['planetary', 'pulse'],
};

export function useRealtimeInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribers = Object.entries(CHANNEL_KEYS).map(([channel, keys]) =>
      subscribe(channel, () => {
        for (const key of keys) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }),
    );
    return () => {
      for (const unsub of unsubscribers) {unsub();}
    };
  }, [queryClient]);
}
