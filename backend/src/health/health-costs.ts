import { Injectable, OnModuleInit } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import {
  HEALTH_COST,
  LotCostRegistry,
  type LotCost,
  type LotCostSource,
} from '../indicators/lot-cost';
import { PrismaService } from '../prisma/prisma.service';
import { operationCosts } from '../stock/operation-costs';

/**
 * What the medicines and vaccines used on a lot cost: the stock ledger's exits
 * written by its done acts (sourceType `HEALTH_ACT`), valued as the ledger
 * holds them NOW (a back-dated entry re-costs them) and rounded like every
 * other reader (`operationCosts`: per operation, then summed). Two queries for
 * every lot: the done acts of the lots (on the day they were done, bounds
 * inclusive), then their exits. A planned or cancelled act has no exit, and an
 * act on an animal or a building has no lot, so none of them costs a lot.
 */
@Injectable()
export class HealthCosts implements LotCostSource, OnModuleInit {
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
    const client = tx ?? this.prisma;
    const acts = await client.healthAct.findMany({
      where: {
        batchId: { in: batchIds },
        status: 'REALISE',
        ...(range.from || range.to
          ? { doneDate: { gte: range.from, lte: range.to } }
          : {}),
      },
      select: { id: true, batchId: true },
    });
    const costs = await operationCosts(client, {
      sourceType: 'HEALTH_ACT',
      sourceIds: acts.map((a) => a.id),
    });
    const totals = new Map<string, Decimal>();
    for (const a of acts) {
      const cost = costs.get(a.id);
      if (!a.batchId || !cost) continue;
      totals.set(
        a.batchId,
        (totals.get(a.batchId) ?? new Decimal(0)).add(cost),
      );
    }
    for (const [batchId, amount] of totals) {
      result.set(batchId, [{ category: HEALTH_COST, amount }]);
    }
    return result;
  }
}
