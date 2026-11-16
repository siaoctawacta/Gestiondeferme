import { Injectable, OnModuleInit } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import {
  LotCostRegistry,
  type LotCost,
  type LotCostSource,
} from '../indicators/lot-cost';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the manual expenses attributed to a lot cost it: one grouped read of
 * `FinanceEntry` (never of the ledger view: a lot is charged for its own
 * entries, not for purchases). The cost category is the entry's finance category
 * (`TRANSPORT`, `ALIMENT`, ...), in capitals, apart from the lower-case `aliment`
 * / `sante` the feed and health sources report; the lot view (`categoryOf`) counts
 * a manual entry under `autres` whatever its category, so its `aliment` and
 * `sante` stay the stock-ledger figures.
 */
@Injectable()
export class ManualLotCosts implements LotCostSource, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: LotCostRegistry,
  ) {}

  onModuleInit(): void {
    this.costs.register(this);
  }

  async costsFor(
    batchIds: string[],
    range: { from?: Date; to?: Date } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>> {
    const result = new Map<string, LotCost[]>();
    if (batchIds.length === 0) return result;
    const rows = await (tx ?? this.prisma).financeEntry.groupBy({
      by: ['batchId', 'category'],
      where: {
        batchId: { in: batchIds },
        ...(range.from || range.to
          ? { date: { gte: range.from, lte: range.to } }
          : {}),
      },
      _sum: { amount: true },
    });
    for (const r of rows) {
      if (!r.batchId) continue;
      const list = result.get(r.batchId) ?? [];
      list.push({
        category: r.category,
        amount: r._sum.amount ?? new Decimal(0),
      });
      result.set(r.batchId, list);
    }
    return result;
  }
}
