import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import NotFound from '../NotFound';

/**
 * What every detail screen shows before its record is there: a skeleton while it loads, the not-found card for an unknown
 * (404) or malformed (400) id, a retry card for any other error, then `children` with the loaded record.
 */
export function DetailGate<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}
