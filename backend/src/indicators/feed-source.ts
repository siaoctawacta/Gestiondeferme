import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

/** Something that records feed given to batches (the feed module). Sources register themselves. */
export interface FeedSource {
  feedForBatch(
    batchId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ kg: number; cost: number }>;
}

@Injectable()
export class FeedRegistry {
  private readonly sources: FeedSource[] = [];

  register(source: FeedSource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  /** Sum over every registered source; 0 when none is registered. */
  async feedForBatch(
    batchId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ kg: number; cost: number }> {
    const parts = await Promise.all(
      this.sources.map((s) => s.feedForBatch(batchId, tx)),
    );
    return parts.reduce(
      (t, p) => ({ kg: t.kg + p.kg, cost: t.cost + p.cost }),
      { kg: 0, cost: 0 },
    );
  }
}
