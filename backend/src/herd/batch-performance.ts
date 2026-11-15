import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { SourceRegistry } from '../common/source-registry';

/** The `performance` block of `GET /batches/:id`. */
export interface BatchPerformance {
  ageDays: number;
  alive: number;
  deaths: number;
  mortalityRate: number | null;
  firstWeightG: number | null;
  lastWeightG: number | null;
  dailyGainG: number | null;
  feedKg: number;
  feedConversion: number | null;
  feedCost: number;
}

/**
 * Computes the `performance` block of `GET /batches/:id`. The indicators module
 * registers itself, so `herd` never imports it (same inversion as `OccupationRegistry`).
 */
export interface BatchPerformanceProvider {
  batchPerformance(
    ctx: RequestContext,
    batchId: string,
  ): Promise<BatchPerformance>;
}

@Injectable()
export class BatchPerformanceRegistry extends SourceRegistry<BatchPerformanceProvider> {
  constructor() {
    super('performance des lots', { mandatory: true });
  }

  /** The caller must check the species permission (`lots` / `porcs`) itself. */
  get(ctx: RequestContext, batchId: string): Promise<BatchPerformance> {
    return this.single().batchPerformance(ctx, batchId);
  }
}
