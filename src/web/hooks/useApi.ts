// Обёртка над TanStack Query + api-client.
// Один хук на все GET-запросы: useApiQuery(['passport', id], '/me/passport').

import { useQuery, type UseQueryResult , useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { apiGet , apiPost, apiPatch, apiDelete } from '../api/client';




export interface ApiQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number;
}

export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  options: ApiQueryOptions = {},
): UseQueryResult<T, Error> {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: () => apiGet<T>(path),
    enabled: options.enabled ?? true,
    ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options.refetchInterval !== undefined
      ? { refetchInterval: options.refetchInterval }
      : {}),
  });
}
export interface ApiMutationOptions {
  invalidateKeys?: readonly (readonly unknown[])[];
}

export function useApiMutation<TData, TVars>(
  pathBuilder: (vars: TVars) => string,
  method: 'POST' | 'PATCH' | 'DELETE',
  options: ApiMutationOptions = {},
): UseMutationResult<TData, Error, TVars> {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVars>({
    mutationFn: async (vars) => {
      const path = pathBuilder(vars);
      if (method === 'POST') {return apiPost<TData>(path);}
      if (method === 'PATCH') {return apiPatch<TData>(path);}
      return apiDelete<TData>(path);
    },
    onSuccess: () => {
      for (const key of options.invalidateKeys ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useInvalidateQuery(): (key: readonly unknown[]) => void {
  const queryClient = useQueryClient();
  return (key) => {
    void queryClient.invalidateQueries({ queryKey: key });
  };
}