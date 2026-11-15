import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import {
  BatchHistoryRegistry,
  type BatchHistorySource,
} from '../herd/batch-history';
import type { Prisma } from '../generated/prisma/client';
import type { FeedDistribution } from '../generated/prisma/client';
import {
  FEED_COST,
  LotCostRegistry,
  type LotCost,
  type LotCostSource,
} from '../indicators/lot-cost';
import { PrismaService } from '../prisma/prisma.service';

/** The feed of a lot: its cost for the indicators, and the history that pins the lot's entry date. */
@Injectable()
export class FeedService
  implements LotCostSource, BatchHistorySource, OnModuleInit
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: LotCostRegistry,
    private readonly history: BatchHistoryRegistry,
  ) {}

  onModuleInit(): void {
    this.costs.register(this);
    this.history.register(this);
  }

  /** Earliest feed or water record of the lot: moving the lot's entry date past it is refused. */
  async earliestDate(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<Date | null> {
    const feed = await tx.feedDistribution.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const water = await tx.waterConsumption.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const dates = [feed?.date, water?.date].filter((d) => d !== undefined);
    return dates.length ? new Date(Math.min(...dates.map((d) => +d))) : null;
  }

  /**
   * Feed given to the lots themselves (`aliment`: `amount` = cost, `quantity` = kg);
   * building-level distributions are not attributed to lots.
   */
  async costsFor(
    batchIds: string[],
    range: { from?: Date; to?: Date } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>> {
    const result = new Map<string, LotCost[]>();
    if (batchIds.length === 0) return result;
    const groups = await (tx ?? this.prisma).feedDistribution.groupBy({
      by: ['batchId'],
      where: {
        batchId: { in: batchIds },
        ...(range.from || range.to
          ? { date: { gte: range.from, lte: range.to } }
          : {}),
      },
      _sum: { quantityKg: true, cost: true },
    });
    for (const g of groups) {
      if (!g.batchId) continue;
      result.set(g.batchId, [
        {
          category: FEED_COST,
          amount: Number(g._sum.cost ?? 0),
          quantity: Number(g._sum.quantityKg ?? 0),
        },
      ]);
    }
    return result;
  }

  /**
   * Seam for slice 3's stock ledger. Called inside the distribution's
   * transaction after every create (`before` null), update and delete (`after`
   * null), BEFORE the response item and the audit row are built; the service
   * then re-reads the row, so a hook that sets `unitCost`/`cost` (slice 3:
   * weighted-average stock cost) is reflected in both. It may also return
   * `{ unitCost }` and the service reprices the row with it. A no-op until then.
   *
   * Reversal on edit or delete goes through the stock movements keyed by
   * `sourceId` (the distribution's id), never through the current formula,
   * whose composition may have changed since the feed was given.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- the seam's signature is the contract slice 3 fills */
  afterDistributionChange(
    _tx: Prisma.TransactionClient,
    _ctx: RequestContext,
    _before: FeedDistribution | null,
    _after: FeedDistribution | null,
  ): Promise<{ unitCost?: Prisma.Decimal } | void> {
    return Promise.resolve();
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
