import { api } from './api';
import { useAuth } from './auth';
import { useFarmQuery } from './query';

export type AlertLevel = 'A_VOIR' | 'URGENT';

export interface AlertItem {
  key: string;
  title: string;
  detail: string;
  level: AlertLevel;
  module: string;
}

export interface AlertsResponse {
  total: number;
  items: AlertItem[];
}

/**
 * Open alerts of the active farm. Shared by the sidebar pill, the top-bar dot and the pages,
 * so they all read the same cache entry. Roles that cannot read alerts never call the API.
 */
export function useAlerts() {
  const { can } = useAuth();
  return useFarmQuery<AlertsResponse>(['alerts'], () => api.get<AlertsResponse>('/alerts'), {
    enabled: can('alertes', 'read'),
  });
}
