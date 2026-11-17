import { formatDay } from '../common/days';
import type { BatchEvent } from '../generated/prisma/client';
import type { BatchEventType } from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';

export interface BatchEventItem {
  id: string;
  batchId: string;
  date: string;
  type: BatchEventType;
  quantity: number;
  cause: string | null;
  note: string | null;
  relatedBatchId: string | null;
  createdById: string;
  createdAt: string;
}

const EVENT_LABEL: Record<BatchEventType, string> = {
  MORTALITE: 'Mortalité',
  VENTE: 'Vente',
  REFORME: 'Réforme',
  ENTREE: 'Entrée',
  NAISSANCE: 'Naissance',
  TRANSFERT_SORTIE: 'Transfert (sortie)',
  TRANSFERT_ENTREE: 'Transfert (entrée)',
};

export const EVENT_COLUMNS: ExportColumn<BatchEventItem>[] = [
  { header: 'Date', date: true, value: (e) => e.date },
  { header: 'Type', value: (e) => EVENT_LABEL[e.type] },
  { header: 'Quantité', value: (e) => e.quantity },
  { header: 'Cause', value: (e) => e.cause },
];

export const toEventItem = (e: BatchEvent): BatchEventItem => ({
  id: e.id,
  batchId: e.batchId,
  date: formatDay(e.date),
  type: e.type,
  quantity: e.quantity,
  cause: e.cause,
  note: e.note,
  relatedBatchId: e.relatedBatchId,
  createdById: e.createdById,
  createdAt: e.createdAt.toISOString(),
});
