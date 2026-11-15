import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import {
  BatchHistoryRegistry,
  type BatchHistorySource,
} from '../herd/batch-history';
import { lockRow } from '../common/lock-row';
import { Prisma } from '../generated/prisma/client';
import type { FeedDistribution, FeedProduct } from '../generated/prisma/client';
import { formulaShares } from './formula-shares';
import {
  FEED_COST,
  LotCostRegistry,
  type LotCost,
  type LotCostSource,
} from '../indicators/lot-cost';
import { PrismaService } from '../prisma/prisma.service';
import {
  StockLedgerService,
  type RecordInput,
  type RecordResult,
} from '../stock/stock-ledger.service';

type Decimal = Prisma.Decimal;

/** The feed of a lot: its cost for the indicators, and the history that pins the lot's entry date. */
@Injectable()
export class FeedService
  implements LotCostSource, BatchHistorySource, OnModuleInit
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: LotCostRegistry,
    private readonly history: BatchHistoryRegistry,
    private readonly ledger: StockLedgerService,
  ) {}

  onModuleInit(): void {
    this.costs.register(this);
    this.history.register(this);
  }

  /** Earliest feed or water record of the lot: moving the lot's entry date past it is refused. */
  async earliestDate(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<Date | null> {
    const feed = await tx.feedDistribution.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const water = await tx.waterConsumption.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const dates = [feed?.date, water?.date].filter((d) => d !== undefined);
    return dates.length ? new Date(Math.min(...dates.map((d) => +d))) : null;
  }

  /**
   * Feed given to the lots themselves (`aliment`: `amount` = cost, `quantity` = kg);
   * building-level distributions are not attributed to lots.
   */
  async costsFor(
    batchIds: string[],
    range: { from?: Date; to?: Date } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>> {
    const result = new Map<string, LotCost[]>();
    if (batchIds.length === 0) return result;
    const groups = await (tx ?? this.prisma).feedDistribution.groupBy({
      by: ['batchId'],
      where: {
        batchId: { in: batchIds },
        ...(range.from || range.to
          ? { date: { gte: range.from, lte: range.to } }
          : {}),
      },
      _sum: { quantityKg: true, cost: true },
    });
    for (const g of groups) {
      if (!g.batchId) continue;
      result.set(g.batchId, [
        {
          category: FEED_COST,
          amount: Number(g._sum.cost ?? 0),
          quantity: Number(g._sum.quantityKg ?? 0),
        },
      ]);
    }
    return result;
  }

  /**
   * Locks what prices a distribution, in the fixed order formula, then
   * products by id, and reads it once under those locks. A link change
   * (`FeedProductsService`) takes the product lock too, so a distribution
   * never sees a link half-changed. Called BEFORE the distribution row is
   * inserted or its feed changed: the row's foreign key takes a key-share lock
   * on the product, which would deadlock with a link change that holds the
   * product lock and waits to update the unique column.
   */
  async lockFeed(
    tx: Prisma.TransactionClient,
    ids: { feedProductId?: string | null; formulaId?: string | null },
  ): Promise<{ product: FeedProduct; percentage: Decimal }[]> {
    if (!ids.feedProductId === !ids.formulaId) return [];
    let shares: { productId: string; percentage: Decimal }[];
    if (ids.feedProductId) {
      shares = [
        { productId: ids.feedProductId, percentage: new Prisma.Decimal(100) },
      ];
    } else {
      const formulaId = ids.formulaId ?? '';
      await lockRow(tx, 'FeedFormula', formulaId);
      shares = (
        await tx.feedFormulaItem.findMany({
          where: { formulaId },
          orderBy: [{ percentage: 'desc' }, { id: 'asc' }],
        })
      ).map((i) => ({ productId: i.feedProductId, percentage: i.percentage }));
    }
    for (const id of shares.map((x) => x.productId).sort()) {
      await lockRow(tx, 'FeedProduct', id);
    }
    const products = new Map(
      (
        await tx.feedProduct.findMany({
          where: { id: { in: shares.map((x) => x.productId) } },
        })
      ).map((p) => [p.id, p]),
    );
    return shares.flatMap((x) => {
      const product = products.get(x.productId);
      return product ? [{ product, percentage: x.percentage }] : [];
    });
  }

  /**
   * Called inside the distribution's transaction after every create (`before`
   * null), update and delete (`after` null), BEFORE the response item and the
   * audit row are built. The service then reprices the row with what it returns.
   *
   * A product linked to a stock item consumes it: one `SORTIE` (reason
   * `CONSOMMATION`, source `FEED_DISTRIBUTION`) of `quantityKg`, on the
   * distribution's farm, valued by the ledger at the weighted-average cost. A
   * formula writes one exit per linked ingredient; the quantity is shared by
   * largest remainder (`formulaShares`) so the shares add up to `quantityKg`
   * to the hundredth. Unlinked ingredients contribute their catalogue price x
   * share and move no stock. The returned `cost` is the sum of the ledger's
   * exit costs and those shares, and the unit cost is `cost / quantityKg` (2
   * decimals). A feed with no linked ingredient returns nothing: the service
   * keeps the catalogue price.
   *
   * The cost is frozen when the distribution is written: a later stock entry,
   * even back-dated, re-costs the ledger's exits but does not rewrite the
   * distribution (accepted limitation). An edit that changes neither quantity,
   * date nor feed leaves stock and cost untouched.
   *
   * Create = `recordMany`, edit = `replaceBySource`, delete =
   * `reverseBySource`, one ledger call per transaction. Locks, in order: the
   * lot (a building has no row lock), the distribution row on edit and delete
   * (the service), the formula, the products by id (`lockFeed`), then the
   * ledger's (farm, article) locks by article id. Reversal goes through the
   * movements keyed by the distribution's id, never through the current formula.
   */
  async afterDistributionChange(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    before: FeedDistribution | null,
    after: FeedDistribution | null,
  ): Promise<{ unitCost?: Decimal; cost?: Decimal } | void> {
    if (!after) {
      if (before) {
        await this.ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', before.id, [
          before.farmId,
        ]);
      }
      return;
    }
    if (
      before &&
      before.quantityKg.equals(after.quantityKg) &&
      before.date.getTime() === after.date.getTime() &&
      before.feedProductId === after.feedProductId &&
      before.formulaId === after.formulaId
    ) {
      return;
    }
    const plan = await this.plan(tx, ctx, after);
    let results: RecordResult[] = [];
    if (before) {
      if (plan.inputs.length === 0) {
        await this.ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', after.id, [
          after.farmId,
        ]);
      } else {
        results = await this.ledger.replaceBySource(
          tx,
          'FEED_DISTRIBUTION',
          after.id,
          plan.inputs,
          [after.farmId],
        );
      }
    } else if (plan.inputs.length > 0) {
      results = await this.ledger.recordMany(
        tx,
        plan.inputs.map((i) => ({
          ...i,
          sourceType: 'FEED_DISTRIBUTION' as const,
          sourceId: after.id,
        })),
      );
    }
    if (!plan.anyLinked) return;
    const total = results.reduce(
      (sum, r) => sum.add(r.cost),
      plan.unlinkedCost,
    );
    return {
      cost: total.toDecimalPlaces(2),
      unitCost: total.div(after.quantityKg).toDecimalPlaces(2),
    };
  }

  /** The exits a distribution writes, and what its unlinked ingredients cost. */
  private async plan(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    d: FeedDistribution,
  ): Promise<{
    inputs: Omit<RecordInput, 'sourceType' | 'sourceId' | 'audit'>[];
    unlinkedCost: Decimal;
    anyLinked: boolean;
  }> {
    const lines = await this.lockFeed(tx, d);
    const shares = formulaShares(
      d.quantityKg,
      lines.map((l) => l.percentage),
    );
    const inputs: Omit<RecordInput, 'sourceType' | 'sourceId' | 'audit'>[] = [];
    let unlinkedCost = new Prisma.Decimal(0);
    lines.forEach(({ product }, i) => {
      const share = shares[i];
      if (!product.stockItemId) {
        unlinkedCost = unlinkedCost.add(share.mul(product.unitCost));
      } else if (!share.isZero()) {
        inputs.push({
          farmId: d.farmId,
          stockItemId: product.stockItemId,
          date: d.date,
          type: 'SORTIE',
          quantity: share.neg(),
          reason: 'CONSOMMATION',
          userId: ctx.user.id,
        });
      }
    });
    return {
      inputs,
      unlinkedCost,
      anyLinked: lines.some((l) => l.product.stockItemId),
    };
  }
}
