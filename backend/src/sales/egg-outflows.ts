import { Injectable } from '@nestjs/common';
import { EggOutflowRegistry, type EggOutflowSource } from '../eggs/egg-stock';
import type { Prisma } from '../generated/prisma/client';
import { eggsOf } from './sale-lines';
import { REVENUE_STATUSES } from './sale-workflow';

/**
 * The eggs sold by invoices, for the egg balance of `eggs`: the OEUFS lines of
 * the invoices that count (issued, partly paid or settled; a draft and a
 * cancelled invoice take nothing), and, as NEGATIVE outflows dated the credit
 * note's date, the eggs of the credit notes made with return of the goods (a
 * credit note without return gives nothing back). A credit note is never dated
 * before its invoice and never takes more than the line sold, so the eggs sold
 * net of returns cannot be negative on any date. Registered on start.
 */
@Injectable()
export class SaleEggOutflows implements EggOutflowSource {
  constructor(registry: EggOutflowRegistry) {
    registry.register(this);
  }

  async outflows(tx: Prisma.TransactionClient, batchIds: string[]) {
    const lines = await tx.invoiceLine.findMany({
      where: {
        kind: 'OEUFS',
        batchId: { in: batchIds },
        invoice: {
          status: { in: [...REVENUE_STATUSES] },
        },
      },
      select: {
        batchId: true,
        quantity: true,
        eggsPerUnit: true,
        invoice: { select: { id: true, date: true } },
      },
    });
    const returns = await tx.creditNoteLine.findMany({
      where: {
        creditNote: { withReturn: true },
        invoiceLine: { kind: 'OEUFS', batchId: { in: batchIds } },
      },
      select: {
        quantity: true,
        invoiceLine: { select: { batchId: true, eggsPerUnit: true } },
        creditNote: { select: { id: true, date: true } },
      },
    });
    return [
      ...lines.map((l) => ({
        batchId: l.batchId as string,
        date: l.invoice.date,
        eggs: eggsOf({
          quantity: l.quantity.toNumber(),
          eggsPerUnit: l.eggsPerUnit ?? 0,
        }),
        sourceId: l.invoice.id,
      })),
      ...returns.map((r) => ({
        batchId: r.invoiceLine.batchId as string,
        date: r.creditNote.date,
        eggs: -eggsOf({
          quantity: r.quantity.toNumber(),
          eggsPerUnit: r.invoiceLine.eggsPerUnit ?? 0,
        }),
        sourceId: r.creditNote.id,
      })),
    ];
  }
}
