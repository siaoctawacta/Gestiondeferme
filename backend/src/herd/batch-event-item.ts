import { formatDay } from '../common/days';
import type { BatchEvent } from '../generated/prisma/client';
import type { BatchEventType } from '../generated/prisma/enums';

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
