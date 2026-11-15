import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import {
  BatchPerformanceRegistry,
  type BatchPerformance,
} from '../herd/batch-performance';
import { BatchesService } from '../herd/batches.service';
import { daysBetween } from '../common/days';
import { PrismaService } from '../prisma/prisma.service';
import { FeedRegistry } from './feed-source';
import { dailyGain, feedConversion } from './indicators';

@Injectable()
export class IndicatorsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: BatchesService,
    private readonly feed: FeedRegistry,
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
    const batch = await this.batches.get(ctx, batchId);
    const weighings = await this.prisma.weighing.findMany({
      where: { batchId, farmId: { in: ctx.farmIds } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { date: true, averageWeightG: true },
    });
    const first = weighings[0];
    const last = weighings[weighings.length - 1];
    const hasRange = weighings.length >= 2;
    const firstWeightG = first?.averageWeightG ?? null;
    const lastWeightG = last?.averageWeightG ?? null;
    const days = hasRange ? daysBetween(first.date, last.date) : null;
    const feed = await this.feed.feedForBatch(batchId);
    const lotGainKg = hasRange
      ? ((lastWeightG - firstWeightG) / 1000) * batch.alive
      : null;
    return {
      ageDays: batch.ageDays,
      alive: batch.alive,
      deaths: batch.deaths,
      mortalityRate: batch.mortalityRate,
      firstWeightG,
      lastWeightG,
      dailyGainG: hasRange ? dailyGain(firstWeightG, lastWeightG, days) : null,
      feedKg: feed.kg,
      feedConversion: feed.kg > 0 ? feedConversion(feed.kg, lotGainKg) : null,
      feedCost: feed.cost,
    };
  }
}
