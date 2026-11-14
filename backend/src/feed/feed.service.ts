import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { FeedDistribution } from '../generated/prisma/client';
import { FeedRegistry, FeedSource } from '../indicators/feed-source';
import { PrismaService } from '../prisma/prisma.service';

/** The feed of a lot, as the indicators module sums it for the lot's performance. */
@Injectable()
export class FeedService implements FeedSource, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: FeedRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Feed given to the lot itself; building-level distributions are not attributed to lots. */
  async feedForBatch(
    batchId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ kg: number; cost: number }> {
    const sum = await (tx ?? this.prisma).feedDistribution.aggregate({
      where: { batchId },
      _sum: { quantityKg: true, cost: true },
    });
    return {
      kg: Number(sum._sum.quantityKg ?? 0),
      cost: Number(sum._sum.cost ?? 0),
    };
  }

  /**
   * Seam for slice 3: called inside the distribution's transaction after every
   * create (`before` null), update and delete (`after` null). Slice 3's stock
   * ledger fills it to move stock; nothing happens here until then.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- the seam's signature is the contract slice 3 fills */
  afterDistributionChange(
    _tx: Prisma.TransactionClient,
    _before: FeedDistribution | null,
    _after: FeedDistribution | null,
  ): Promise<void> {
    return Promise.resolve();
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
