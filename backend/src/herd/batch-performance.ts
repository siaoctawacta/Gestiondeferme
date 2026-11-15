import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';

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
export class BatchPerformanceRegistry {
  private provider: BatchPerformanceProvider | null = null;

  register(provider: BatchPerformanceProvider): void {
    this.provider = provider;
  }

  /** `null` when no provider is registered. */
  async get(
    ctx: RequestContext,
    batchId: string,
  ): Promise<BatchPerformance | null> {
    return this.provider ? this.provider.batchPerformance(ctx, batchId) : null;
  }
}
