import { Injectable, OnModuleInit } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { formatDay } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import {
  HEALTH_COST,
  LotCostRegistry,
  type LotCost,
  type LotCostSource,
} from '../indicators/lot-cost';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the medicines and vaccines used on a lot cost: the stock ledger's exits
 * written by its done acts (sourceType `HEALTH_ACT`), valued as the ledger
 * holds them NOW (a back-dated entry re-costs them). One query for every lot,
 * on the date the act was done; a planned or cancelled act has no exit, and an
 * act on an animal or a building has no lot, so none of them costs a lot.
 */
@Injectable()
export class HealthCosts implements LotCostSource, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs?: LotCostRegistry,
  ) {}

  onModuleInit(): void {
    this.costs?.register(this);
  }

  async costsFor(
    batchIds: string[],
    range: { from?: Date; to?: Date } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>> {
    const result = new Map<string, LotCost[]>();
    if (batchIds.length === 0) return result;
    const client = tx ?? this.prisma;
    // Both bounds inclusive, on the day the act was done; an absent bound is no bound.
    const from = range.from ? formatDay(range.from) : null;
    const to = range.to ? formatDay(range.to) : null;
    const rows = await client.$queryRaw<{ batchId: string; amount: Decimal }[]>`
      SELECT a."batchId", ROUND(SUM(ABS(m."quantity") * m."unitCost"), 2) AS amount
      FROM "StockMovement" m
      JOIN "HealthAct" a ON a."id" = m."sourceId"
      WHERE m."sourceType" = 'HEALTH_ACT'
        AND a."status" = 'REALISE'
        AND a."batchId" = ANY(${batchIds}::text[])
        AND (${from}::date IS NULL OR a."doneDate" >= ${from}::date)
        AND (${to}::date IS NULL OR a."doneDate" <= ${to}::date)
      GROUP BY a."batchId"`;
    for (const r of rows) {
      result.set(r.batchId, [
        { category: HEALTH_COST, amount: new Decimal(r.amount) },
      ]);
    }
    return result;
  }
}
