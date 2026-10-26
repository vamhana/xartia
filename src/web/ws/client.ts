// F.4.99.13 — WebSocket-клиент
// Подключение к WS-серверу (порт 3001), подписки на каналы,
// автоматический reconnect с exponential backoff, heartbeat.

import {
  getAccessToken,
  refreshAccessToken,
  isAccessTokenExpired,
} from '../api/client';

// -------- Типы --------

export type MessageHandler = (event: string, payload: unknown) => void;

interface Subscription {
  channel: string;
  handler: MessageHandler;
}

export interface WSState {
  socket: WebSocket | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  reconnects: number;
  connectedAt: number | null;
  lastPingAt: number | null;
  latencyMs: number | null;
}

// -------- Внутреннее состояние --------

const WS_URL = (import.meta.env['VITE_WS_URL'] as string | undefined)
  ?? 'ws://localhost:3001/ws';

const state: WSState = {
  socket: null,
  status: 'disconnected',
  reconnects: 0,
  connectedAt: null,
  lastPingAt: null,
  latencyMs: null,
};

const subscriptions = new Set<Subscription>();
/** Последний ts события по каналу — для catch-up после разрыва. */
const lastEventTs = new Map<string, number>();
const statusListeners = new Set<(s: WSState) => void>();

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let manualClose = false;

// -------- Вспомогательные --------

function notifyStatus(): void {
  const snapshot = { ...state };
  for (const l of statusListeners) {
    try { l(snapshot); } catch { /* ignore */ }
  }
}

function setStatus(s: WSState['status']): void {
  state.status = s;
  notifyStatus();
}

function buildUrl(): string {
  const token = getAccessToken();
  if (!token) {throw new Error('No access token');}
  const sep = WS_URL.includes('?') ? '&' : '?';
  return `${WS_URL}${sep}token=${encodeURIComponent(token)}`;
}

// -------- Reconnect --------

function scheduleReconnect(): void {
  if (manualClose) {return;}
  if (reconnectTimer) {return;}

  reconnectAttempts++;
  const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 30_000);
  state.reconnects = reconnectAttempts;
  setStatus('reconnecting');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

// -------- Heartbeat --------

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.lastPingAt = Date.now();
      try {
        state.socket.send(JSON.stringify({ action: 'ping', requestId: 'hb' }));
      } catch { /* ignore */ }
    }
  }, 30_000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// -------- Основная логика --------

export async function connect(): Promise<void> {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {return;}
  if (state.socket && state.socket.readyState === WebSocket.CONNECTING) {return;}

  manualClose = false;
  setStatus('connecting');

  // Перед подключением — обновляем access-токен, если он просрочен
  // (или вот-вот истечёт). Иначе сервер отклонит серию переподключений
  // как INVALID_TOKEN / TOKEN_EXPIRED.
  // Если access-токен просрочен (или отсутствует) — обновляем.
  // Если refresh тоже отсутствует — не сдаёмся сразу: возможно, useAuth
  // ещё не загрузил токены из localStorage. Планируем reconnect через 1 сек.
  if (isAccessTokenExpired()) {
    const ok = await refreshAccessToken();
    if (!ok) {
      // Если refresh-токена вообще нет — ждём, не делаем logout.
      // Logout при неудачном refresh делает api-client при реальном 401.
      setStatus('disconnected');
      // Быстрый retry (1 сек) вместо долгого backoff.
      if (reconnectTimer) {return;}
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, 1000);
      return;
    }
  }

  let socket: WebSocket;
  try {
    socket = new WebSocket(buildUrl());
  } catch (e) {
    console.warn('[ws] connect failed:', e);
    scheduleReconnect();
    return;
  }

  state.socket = socket;

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    state.connectedAt = Date.now();
    setStatus('connected');
    startHeartbeat();

    // Переподписываемся на все каналы.
    for (const sub of subscriptions) {
      try {
        socket.send(JSON.stringify({
          action: 'subscribe',
          channel: sub.channel,
          since: lastEventTs.get(sub.channel) ?? 0,
        }));
      } catch { /* ignore */ }
    }
  });

  socket.addEventListener('message', (ev: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(ev.data) as {
        event: string;
        payload: unknown;
        channel?: string;
        ts?: number;
      };
      const { event, payload, channel } = msg;
      if (event === 'pong') {
        if (state.lastPingAt) {
          state.latencyMs = Date.now() - state.lastPingAt;
        }
        return;
      }
      if (channel && typeof msg.ts === 'number') {
        const prev = lastEventTs.get(channel) ?? 0;
        if (msg.ts > prev) {lastEventTs.set(channel, msg.ts);}
      }
      // Если сервер указал канал — доставляем только его подписчикам.
      // Без channel (participant/direction/role) — всем, как раньше.
      for (const sub of subscriptions) {
        if (channel && sub.channel !== channel) {continue;}
        try { sub.handler(event, payload); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  });

  socket.addEventListener('close', () => {
    state.socket = null;
    state.connectedAt = null;
    stopHeartbeat();
    if (manualClose) {
      setStatus('disconnected');
    } else {
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', () => {
    // close сработает следом
  });
}

export function disconnect(): void {
  manualClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  if (state.socket) {
    try { state.socket.close(1000, 'manual'); } catch { /* ignore */ }
    state.socket = null;
  }
  state.status = 'disconnected';
  notifyStatus();
}

// -------- Подписки --------

export function subscribe(channel: string, handler: MessageHandler): () => void {
  const sub: Subscription = { channel, handler };
  subscriptions.add(sub);

  // Если уже подключены — сразу подписываемся.
  if (state.socket?.readyState === WebSocket.OPEN) {
    try {
      state.socket.send(JSON.stringify({
          action: 'subscribe',
          channel,
          since: lastEventTs.get(channel) ?? 0,
        }));
    } catch { /* ignore */ }
  }

  return () => {
    subscriptions.delete(sub);
    if (state.socket?.readyState === WebSocket.OPEN) {
      try {
        state.socket.send(JSON.stringify({ action: 'unsubscribe', channel }));
      } catch { /* ignore */ }
    }
  };
}

// -------- Status --------

export function getState(): WSState {
  return { ...state };
}

export function onStatusChange(cb: (s: WSState) => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

// -------- Отправка сообщений на сервер --------

/**
 * Отправить сообщение на WS-сервер. Возвращает false, если соединение
 * не открыто или произошла ошибка сериализации/отправки.
 *
 * Не бросает — вызывающий (например, VideoCall) может игнорировать
 * неудачу, если соединение временно недоступно (reconnect).
 */
export function send(msg: object): boolean {
  const socket = state.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {return false;}
  try {
    socket.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}