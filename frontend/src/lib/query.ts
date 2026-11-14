import { useQuery, type QueryKey, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './auth';

/** Cache key scoped to a farm: `['farm', farmId, ...parts]`. */
export const farmKey = (farmId: string | null, ...parts: unknown[]): QueryKey => ['farm', farmId, ...parts];

/**
 * `useQuery` whose key is prefixed with the active farm id, so data of one farm can never be
 * served for another. Use it for every farm-owned query.
 */
export function useFarmQuery<T>(
  key: unknown[],
  fn: () => Promise<T>,
  options: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> = {},
): UseQueryResult<T> {
  const { farmId } = useAuth();
  return useQuery<T>({
    ...options,
    enabled: farmId !== null && (options.enabled ?? true),
    queryKey: farmKey(farmId, ...key),
    queryFn: fn,
  });
}
