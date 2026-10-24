// src/web/hooks/useRights.ts
/**
 * F.4.99.10 — Хук прав.
 *
 * Проверка прав на клиенте. Синхронизация с сервером. Кэш 30 сек.
 * UI скрывает недоступное, но проверка на сервере — обязательна.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet } from '../api/client';

// ─── Локальные типы (frontend изолирован от core) ────────────────

export type FrontRole = string;
export type FrontRightAction = string;
export type FrontRightScope = string;

export interface MandateSummary {
  role: FrontRole;
  directionId: string | null;
  mandateId: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface RightsSummary {
  roles: FrontRole[];
  effective: FrontRole[];
  mandates: MandateSummary[];
  rights: Record<string, FrontRightAction[]>;
}

// ─── useRights ───────────────────────────────────────────────────

export interface UseRightsResult {
  roles: FrontRole[];
  effectiveRoles: FrontRole[];
  rights: Record<string, FrontRightAction[]>;
  isLoading: boolean;
  error: Error | null;
  hasRight: (resource: string, action: FrontRightAction, targetId?: string) => boolean;
  hasRole: (role: FrontRole) => boolean;
  hasAnyRole: (roles: FrontRole[]) => boolean;
  canAccess: (resource: string, action: FrontRightAction) => boolean;
}

export function useRights(): UseRightsResult {
  const { data, isLoading, error } = useQuery<RightsSummary>({
    queryKey: ['permissions', 'me'],
    queryFn: () => apiGet<RightsSummary>('/permissions/me'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const roles = data?.roles ?? [];
  const effectiveRoles = data?.effective ?? [];
  const rights = data?.rights ?? {};

  const hasRight = (
    resource: string,
    action: FrontRightAction,
    targetId?: string,
  ): boolean => {
    // targetId не используется для локальной проверки —
    // сервер при необходимости сам валидирует target-scope.
    void targetId;
    return (rights[resource] ?? []).includes(action);
  };

  const hasRole = (role: FrontRole): boolean => effectiveRoles.includes(role);

  const hasAnyRole = (rs: FrontRole[]): boolean =>
    rs.some((r) => effectiveRoles.includes(r));

  const canAccess = (resource: string, action: FrontRightAction): boolean =>
    hasRight(resource, action);

  return {
    roles,
    effectiveRoles,
    rights,
    isLoading,
    error: error as Error | null,
    hasRight,
    hasRole,
    hasAnyRole,
    canAccess,
  };
}

// ─── useResourceRights ───────────────────────────────────────────

export interface ResourceRights {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAudit: boolean;
}

export function useResourceRights(resource: string): ResourceRights {
  const { hasRight } = useRights();
  return {
    canView: hasRight(resource, 'V'),
    canCreate: hasRight(resource, 'C'),
    canEdit: hasRight(resource, 'E'),
    canDelete: hasRight(resource, 'D'),
    canAudit: hasRight(resource, 'A'),
  };
}

// ─── Инвалидация ─────────────────────────────────────────────────

export function useInvalidateRights(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['permissions'] });
  };
}