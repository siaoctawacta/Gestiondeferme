import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { formatDay } from '../../common/days';
import { PrismaService } from '../../prisma/prisma.service';
import { StockLedgerService } from '../../stock/stock-ledger.service';
import { AlertsRegistry } from './alerts-registry';
import {
  stockAlertRules,
  type ExpiringBatch,
  type StockAlertData,
  type StockLevelRow,
} from './stock-alerts';

/**
 * Reads the stock tables for the stock and expiry alert rules and registers
 * them. A fixed number of queries whatever the number of articles and lots:
 * the thresholds with their cached quantities, the lots with their quantities,
 * and the names of the articles of those lots.
 */
@Injectable()
export class StockAlertsService implements StockAlertData, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly registry: AlertsRegistry,
  ) {}

  /** The clock the rules read; a test replaces it. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    for (const rule of stockAlertRules(this, () => this.now()))
      this.registry.register(rule);
  }

  /** Every active article with a minimum in the request's farms, with its quantity there (none yet is 0). */
  async levels(ctx: RequestContext): Promise<StockLevelRow[]> {
    const limits = await this.prisma.farmStockItem.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        minQty: { gt: 0 },
        stockItem: { active: true },
      },
      select: {
        farmId: true,
        stockItemId: true,
        minQty: true,
        quantity: true,
        farm: { select: { name: true } },
        stockItem: { select: { name: true, unit: true } },
      },
      relationLoadStrategy: 'join',
    });
    // The quantity is the ledger's cache on the same row: no replay.
    return limits.map((l) => ({
      farmId: l.farmId,
      itemId: l.stockItemId,
      name: l.stockItem.name,
      unit: l.stockItem.unit,
      quantity: l.quantity.toNumber(),
      minQty: l.minQty.toNumber(),
      ...(ctx.farmIds.length > 1 ? { farmName: l.farm.name } : {}),
    }));
  }

  /** The lots with an expiry date and something left in them. */
  async batches(ctx: RequestContext): Promise<ExpiringBatch[]> {
    const held = (await this.ledger.batchLevels(ctx.farmIds)).filter(
      (b) => b.batch.expiryDate && b.quantity.gt(0),
    );
    if (held.length === 0) return [];
    const [items, farms] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: {
          id: { in: [...new Set(held.map((b) => b.batch.stockItemId))] },
        },
        select: { id: true, name: true },
      }),
      this.prisma.farm.findMany({
        where: { id: { in: ctx.farmIds } },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(items.map((i) => [i.id, i.name]));
    const farmNames = new Map(farms.map((f) => [f.id, f.name]));
    const several = ctx.farmIds.length > 1;
    return held.flatMap(({ batch, quantity }) =>
      batch.expiryDate
        ? [
            {
              id: batch.id,
              itemName: names.get(batch.stockItemId) ?? '',
              lotNumber: batch.lotNumber,
              expiryDate: formatDay(batch.expiryDate),
              quantity: quantity.toNumber(),
              ...(several ? { farmName: farmNames.get(batch.farmId) } : {}),
            },
          ]
        : [],
    );
  }
}
