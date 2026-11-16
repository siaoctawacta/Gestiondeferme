import type { UseQueryResult } from '@tanstack/react-query';
import { api } from './api';
import { useFarmQuery } from './query';

/** The legal identity printed at the top of every document (`legal` setting); a field may be empty. */
export type Legal = Record<'name' | 'address' | 'nif' | 'rccm', string>;

/** `GET /settings/documents`: what documents need of the settings, readable by every signed-in role. */
export interface DocumentSettings {
  legal: Legal;
  /** Days between an invoice's date and its default due date. */
  invoiceDueDays: number;
  /** Eggs in one plateau. */
  eggsPerTray: number;
}

/**
 * The document settings, for any role (the full `/settings` needs `parametres:read`): the legal block of the printed
 * sheets and the default due date of an invoice. `enabled` false makes no request.
 */
export function useDocumentSettings(enabled = true): UseQueryResult<DocumentSettings> {
  return useFarmQuery<DocumentSettings>(['settings', 'documents'], () => api.get<DocumentSettings>('/settings/documents'), { enabled });
}
