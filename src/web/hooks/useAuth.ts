// F.4.99.09 — Хук аутентификации
// login / logout / refresh. Хранение токенов через api-client.
// При инициализации восстанавливает сессию.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  loginRequest,
  logoutRequest,
  setTokens,
  loadTokensFromStorage,
  setOnUnauthorized,
  getAccessToken,
  type LoginResponse,
} from '../api/client';
import { apiGet } from '../api/client';
import { useStore } from '../store';
import type { Participant } from '../types';

// -------- Загрузка паспорта --------

interface PassportResponse extends Participant {
  direction: { id: string; number: number; name: string } | null;
  roles: Array<{ name: string; directionId: string | null; validTo: string | null }>;
}

async function fetchMyPassport(): Promise<PassportResponse> {
  return apiGet<PassportResponse>('/me/passport');
}

// -------- Публичный интерфейс --------

export interface UseAuthResult {
  user: ReturnType<typeof useStore.getState>['user'];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  // Восстановление сессии при mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadTokensFromStorage();
      if (!stored) {
        setIsLoading(false);
        return;
      }
      try {
        const passport = await fetchMyPassport();
        if (!cancelled) {
          setUser({
            participant: {
              id: passport.id,
              externalId: passport.externalId,
              name: passport.name,
              pseudonym: passport.pseudonym,
              directionId: passport.directionId,
              status: passport.status,
              isFirstArchitect: passport.isFirstArchitect,
            },
            roles: passport.roles.map((r) => r.name),
          });
        }
      } catch {
        // Токен невалиден — чистим.
        setTokens(null);
        if (!cancelled) {clearUser();}
      } finally {
        if (!cancelled) {setIsLoading(false);}
      }
    })();

    return () => { cancelled = true; };
  }, [setUser, clearUser]);

  // Регистрация обработчика 401 от api-client.
  useEffect(() => {
    setOnUnauthorized(() => {
      clearUser();
      navigate('/login', { replace: true });
    });
    return () => setOnUnauthorized(null);
  }, [clearUser, navigate]);

  const login = useCallback(async (phone: string, password: string) => {
    const data: LoginResponse = await loginRequest(phone, password);
    setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
    // Загружаем полный паспорт.
    const passport = await fetchMyPassport();
    setUser({
      participant: {
        id: passport.id,
        externalId: passport.externalId,
        name: passport.name,
        pseudonym: passport.pseudonym,
        directionId: passport.directionId,
        status: passport.status,
        isFirstArchitect: passport.isFirstArchitect,
      },
      roles: passport.roles.map((r) => r.name),
    });
  }, [setUser]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setTokens(null);
    clearUser();
    navigate('/login', { replace: true });
  }, [clearUser, navigate]);

  const refreshUser = useCallback(async () => {
    if (!getAccessToken()) {return;}
    const passport = await fetchMyPassport();
    setUser({
      participant: {
        id: passport.id,
        externalId: passport.externalId,
        name: passport.name,
        pseudonym: passport.pseudonym,
        directionId: passport.directionId,
        status: passport.status,
        isFirstArchitect: passport.isFirstArchitect,
      },
      roles: passport.roles.map((r) => r.name),
    });
  }, [setUser]);

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
    login,
    logout,
    refreshUser,
  };
}