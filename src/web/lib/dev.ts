// Dev-вход под тестовым ником: сохранение и возврат своей сессии.
//
// Механика: перед подменой сохраняем текущие токены в sessionStorage (не в
// localStorage — чтобы подмена не переживала закрытие вкладки). После этого
// можно вернуться одним кликом из шапки.
//
// В production не используется: кнопки скрыты по import.meta.env.DEV, а
// серверные маршруты /dev/* не регистрируются при NODE_ENV=production.

import { loadTokensFromStorage, setTokens } from '../api/client';

/** Форма сохранённой сессии — та же, что принимает setTokens. */
type StoredAuth = NonNullable<Parameters<typeof setTokens>[0]>;

export const DEV_RETURN_KEY = 'xartia:dev-return';

export function saveDevReturn(): void {
  const current = loadTokensFromStorage();
  if (current) {
    sessionStorage.setItem(DEV_RETURN_KEY, JSON.stringify(current));
  }
}

export function hasDevReturn(): boolean {
  return sessionStorage.getItem(DEV_RETURN_KEY) !== null;
}

export function restoreDevReturn(): boolean {
  const raw = sessionStorage.getItem(DEV_RETURN_KEY);
  if (!raw) {return false;}
  try {
    const tokens = JSON.parse(raw) as StoredAuth;
    setTokens(tokens);
    sessionStorage.removeItem(DEV_RETURN_KEY);
    return true;
  } catch {
    sessionStorage.removeItem(DEV_RETURN_KEY);
    return false;
  }
}
