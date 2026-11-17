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
  /** Only with `?acknowledged=include`: this user masked it (and it is still hidden: not expired, not worse). */
  acknowledged?: boolean;
}

export interface AlertsResponse {
  /** The alerts this user sees open: the masked ones are not counted (badge, sidebar, dashboard all read it). */
  total: number;
  /** How many open alerts this user masked (absent from an API without masking). */
  acknowledgedCount?: number;
  items: AlertItem[];
}

/**
 * Open alerts of the active farm. Shared by the sidebar pill, the top-bar dot and the pages,
 * so they all read the same cache entry. Roles that cannot read alerts never call the API.
 */
export function useAlerts({ includeAcknowledged = false }: { includeAcknowledged?: boolean } = {}) {
  const { can } = useAuth();
  return useFarmQuery<AlertsResponse>(
    includeAcknowledged ? ['alerts', 'include'] : ['alerts'],
    () => api.get<AlertsResponse>('/alerts', includeAcknowledged ? { acknowledged: 'include' } : undefined),
    { enabled: can('alertes', 'read') },
  );
}

/** « Masquer l'alerte » / « Réafficher »: a per-user display choice kept by the API, which then decides what is visible. */
export const acknowledgeAlert = (key: string) => api.post('/alerts/ack', { key });
export const unacknowledgeAlert = (key: string) => api.post('/alerts/unack', { key });
