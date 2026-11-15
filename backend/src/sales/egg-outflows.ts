import { Injectable } from '@nestjs/common';
import { EggOutflowRegistry, type EggOutflowSource } from '../eggs/egg-stock';
import type { Prisma } from '../generated/prisma/client';
import { eggsOf } from './sale-lines';
import { REVENUE_STATUSES } from './sale-workflow';

/**
 * The eggs sold by invoices, for the egg balance of `eggs`: the OEUFS lines of
 * the invoices that count (issued, partly paid or settled; a draft and a
 * cancelled invoice take nothing). Registered on start.
 */
@Injectable()
export class SaleEggOutflows implements EggOutflowSource {
  constructor(registry: EggOutflowRegistry) {
    registry.register(this);
  }

  async outflows(
    tx: Prisma.TransactionClient,
    batchIds: string[],
    opts?: { excludeSourceId?: string },
  ) {
    const lines = await tx.invoiceLine.findMany({
      where: {
        kind: 'OEUFS',
        batchId: { in: batchIds },
        invoice: {
          status: { in: [...REVENUE_STATUSES] },
          ...(opts?.excludeSourceId
            ? { id: { not: opts.excludeSourceId } }
            : {}),
        },
      },
      select: {
        batchId: true,
        quantity: true,
        eggsPerUnit: true,
        invoice: { select: { id: true, date: true } },
      },
    });
    return lines.map((l) => ({
      batchId: l.batchId as string,
      date: l.invoice.date,
      eggs: eggsOf({
        quantity: l.quantity.toNumber(),
        eggsPerUnit: l.eggsPerUnit ?? 0,
      }),
      sourceId: l.invoice.id,
    }));
  }
}
