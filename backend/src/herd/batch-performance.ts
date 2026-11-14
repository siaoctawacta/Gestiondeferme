import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';

export type PerformanceMetrics = object;

/**
 * Computes the `performance` block of `GET /batches/:id`. The indicators module
 * registers itself, so `herd` never imports it (same inversion as `OccupationRegistry`).
 */
export interface BatchPerformanceProvider {
  batchPerformance(
    ctx: RequestContext,
    batchId: string,
  ): Promise<PerformanceMetrics>;
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
  ): Promise<PerformanceMetrics | null> {
    return this.provider ? this.provider.batchPerformance(ctx, batchId) : null;
  }
}
