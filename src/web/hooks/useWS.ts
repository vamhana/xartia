// Хуки для работы с WebSocket из React-компонентов.
// useWSSubscription — подписка на канал с автоматической отпиской.
// Хендлер не пересоздаёт подписку при каждом рендере.

import { useEffect, useRef } from 'react';

import { subscribe } from '../ws/client';

export type WSHandler = (event: string, payload: unknown) => void;

/**
 * Подписка на WS-канал. Возвращает управление: не нужно делать unsubscribe.
 * Хендлер хранится в ref — если он меняется, переподписка НЕ происходит.
 */
export function useWSSubscription(channel: string, handler: WSHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = subscribe(channel, (event, payload) => {
      handlerRef.current(event, payload);
    });
    return unsub;
  }, [channel]);
}