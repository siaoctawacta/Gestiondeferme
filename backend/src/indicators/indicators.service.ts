import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import {
  BatchPerformanceRegistry,
  type BatchPerformance,
} from '../herd/batch-performance';
import { BatchesService } from '../herd/batches.service';
import { BATCH_NOT_FOUND } from '../common/messages';
import { daysBetween } from '../common/days';
import { sumAmounts, toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { dailyGain, feedConversion } from './indicators';
import { FEED_COST, LotCostRegistry } from './lot-cost';

@Injectable()
export class IndicatorsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: BatchesService,
    private readonly costs: LotCostRegistry,
    private readonly performance: BatchPerformanceRegistry,
  ) {}

  onModuleInit(): void {
    this.performance.register(this);
  }

  /**
   * 404 when the batch is outside the caller's farm scope. The caller must
   * check the species permission (`lots` / `porcs`) itself. `feedConversion`
   * is null when no feed was recorded, or when the lot's gain is not positive.
   */
  async batchPerformance(
    ctx: RequestContext,
    batchId: string,
  ): Promise<BatchPerformance> {
    const found = (await this.batchPerformanceMany(ctx, [batchId])).get(
      batchId,
    );
    if (!found) throw new NotFoundException(BATCH_NOT_FOUND);
    return found;
  }

  /**
   * `batchPerformance` for many lots: the same figures through a fixed number
   * of queries (lots, headcounts, deaths and last weights, weighings, costs)
   * whatever the number of lots. A lot outside the caller's farms is absent
   * from the map; the caller checks the species permission itself.
   */
  async batchPerformanceMany(
    ctx: RequestContext,
    batchIds: string[],
  ): Promise<Map<string, BatchPerformance>> {
    const result = new Map<string, BatchPerformance>();
    const lots = await this.batches.getMany(ctx, batchIds);
    if (lots.length === 0) return result;
    const ids = lots.map((l) => l.id);
    const [weighings, costs] = await Promise.all([
      this.prisma.weighing.findMany({
        where: { batchId: { in: ids }, farmId: { in: ctx.farmIds } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: { batchId: true, date: true, averageWeightG: true },
      }),
      this.costs.costsFor(ids),
    ]);
    const byLot = new Map<string, typeof weighings>();
    for (const w of weighings) {
      const own = byLot.get(w.batchId);
      if (own) own.push(w);
      else byLot.set(w.batchId, [w]);
    }
    for (const batch of lots) {
      const own = byLot.get(batch.id) ?? [];
      const first = own[0];
      const last = own[own.length - 1];
      const hasRange = own.length >= 2;
      const firstWeightG = first?.averageWeightG ?? null;
      const lastWeightG = last?.averageWeightG ?? null;
      const days = hasRange ? daysBetween(first.date, last.date) : null;
      const feed = (costs.get(batch.id) ?? []).filter(
        (c) => c.category === FEED_COST,
      );
      const feedKg = feed.reduce((sum, c) => sum + (c.quantity ?? 0), 0);
      const feedCost = toMoney(sumAmounts(feed.map((c) => c.amount)));
      const lotGainKg = hasRange
        ? ((lastWeightG - firstWeightG) / 1000) * batch.alive
        : null;
      result.set(batch.id, {
        ageDays: batch.ageDays,
        alive: batch.alive,
        deaths: batch.deaths,
        mortalityRate: batch.mortalityRate,
        firstWeightG,
        lastWeightG,
        dailyGainG: hasRange
          ? dailyGain(firstWeightG, lastWeightG, days)
          : null,
        feedKg,
        feedConversion: feedKg > 0 ? feedConversion(feedKg, lotGainKg) : null,
        feedCost,
      });
    }
    return result;
  }
}
