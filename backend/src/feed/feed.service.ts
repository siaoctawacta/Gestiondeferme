import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import {
  BatchHistoryRegistry,
  type BatchHistorySource,
} from '../herd/batch-history';
import { lockRow } from '../common/lock-row';
import { Prisma } from '../generated/prisma/client';
import type { FeedDistribution, FeedProduct } from '../generated/prisma/client';
import { currentCost, type CostRow } from './feed-cost';
import { FeedTargets } from './feed-targets';
import { formulaShares } from './formula-shares';
import {
  FEED_COST,
  LotCostRegistry,
  type LotCost,
  type LotCostSource,
} from '../indicators/lot-cost';
import { PrismaService } from '../prisma/prisma.service';
import { operationCosts } from '../stock/operation-costs';
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
    private readonly targets: FeedTargets,
  ) {}

  onModuleInit(): void {
    this.costs.register(this);
    this.history.register(this);
  }

  /**
   * The feed given (kg) and the water drunk (L) on the farms between two days
   * (both inclusive): the REPORTS' definition, over the rows the caller's feed
   * and water lists show (`FeedTargets.visibleRows`: a role that cannot read a
   * species' lots never counts their feed). The dashboard does not read this:
   * its farm-wide KPIs come from `dayFigures`, unscoped. Two queries.
   */
  async periodFigures(
    ctx: RequestContext,
    from: Date,
    to: Date,
  ): Promise<{ feedKg: number; waterL: number }> {
    const where = {
      farmId: { in: ctx.farmIds },
      date: { gte: from, lte: to },
      AND: [this.targets.visibleRows(ctx)],
    };
    const [feed, water] = await Promise.all([
      this.prisma.feedDistribution.aggregate({
        where,
        _sum: { quantityKg: true },
      }),
      this.prisma.waterConsumption.aggregate({
        where,
        _sum: { liters: true },
      }),
    ]);
    return {
      feedKg: Number(feed._sum.quantityKg ?? 0),
      waterL: Number(water._sum.liters ?? 0),
    };
  }

  /**
   * The feed (kg) of given (farm, day) pairs and the water (L) of others: the
   * dashboard's « last recorded day » of each farm, which differs between feed
   * and water. One aggregate per kind asked (none for an empty list), whatever
   * the number of farms.
   */
  async dayFigures(
    feedDays: { farmId: string; date: Date }[],
    waterDays: { farmId: string; date: Date }[],
  ): Promise<{ feedKg: number; waterL: number }> {
    const on = (days: { farmId: string; date: Date }[]) => ({
      OR: days.map((d) => ({ farmId: d.farmId, date: d.date })),
    });
    const [feed, water] = await Promise.all([
      feedDays.length
        ? this.prisma.feedDistribution.aggregate({
            where: on(feedDays),
            _sum: { quantityKg: true },
          })
        : null,
      waterDays.length
        ? this.prisma.waterConsumption.aggregate({
            where: on(waterDays),
            _sum: { liters: true },
          })
        : null,
    ]);
    return {
      feedKg: Number(feed?._sum.quantityKg ?? 0),
      waterL: Number(water?._sum.liters ?? 0),
    };
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
   * The CURRENT cost of distributions, from the ledger: for each row, the sum
   * of its exits' costs (sourceType `FEED_DISTRIBUTION`, by source id) plus its
   * unlinked part. The ledger re-costs exits when stock is entered back-dated
   * or an entry's cost is edited, and never writes to the distribution rows
   * (lock order), so the stored `cost`/`unitCost` are only the snapshot taken
   * at entry. One query whatever the number of rows. A row with no exit shows
   * its snapshot. Every reader of a distribution's cost goes through here.
   */
  async currentCosts(
    rows: CostRow[],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, { cost: Decimal; unitCost: Decimal }>> {
    const result = new Map<string, { cost: Decimal; unitCost: Decimal }>();
    if (rows.length === 0) return result;
    const ledger = await operationCosts(client, {
      sourceType: 'FEED_DISTRIBUTION',
      sourceIds: rows.map((r) => r.id),
    });
    for (const row of rows) {
      result.set(row.id, currentCost(row, ledger.get(row.id)));
    }
    return result;
  }

  /**
   * Feed given to the lots themselves (`aliment`: `amount` = cost, `quantity` = kg);
   * building-level distributions are not attributed to lots. The cost is the
   * current one (`currentCosts`), batched: two queries whatever the lots.
   */
  async costsFor(
    batchIds: string[],
    range: { from?: Date; to?: Date } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>> {
    const result = new Map<string, LotCost[]>();
    if (batchIds.length === 0) return result;
    const client = tx ?? this.prisma;
    const rows = await client.feedDistribution.findMany({
      where: {
        batchId: { in: batchIds },
        ...(range.from || range.to
          ? { date: { gte: range.from, lte: range.to } }
          : {}),
      },
      select: {
        id: true,
        batchId: true,
        quantityKg: true,
        unitCost: true,
        cost: true,
        unlinkedCost: true,
      },
    });
    const current = await this.currentCosts(rows, client);
    const totals = new Map<string, { amount: Decimal; kg: Decimal }>();
    for (const r of rows) {
      if (!r.batchId) continue;
      const total = totals.get(r.batchId) ?? {
        amount: new Prisma.Decimal(0),
        kg: new Prisma.Decimal(0),
      };
      total.amount = total.amount.add(current.get(r.id)?.cost ?? r.cost);
      total.kg = total.kg.add(r.quantityKg);
      totals.set(r.batchId, total);
    }
    for (const [batchId, t] of totals) {
      result.set(batchId, [
        {
          category: FEED_COST,
          amount: t.amount,
          quantity: t.kg.toNumber(),
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
   * What is returned (`cost`, `unitCost`, `unlinkedCost`) is stored on the row
   * as the SNAPSHOT of entry time. A later stock entry, even back-dated,
   * re-costs the ledger's exits but never rewrites the row (lock order):
   * readers show `currentCosts`, the ledger being the single truth for the
   * stock-valued part. An edit that changes neither quantity, date nor feed
   * leaves stock and the snapshot untouched.
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
  ): Promise<{
    unitCost?: Decimal;
    cost?: Decimal;
    /** The part of the cost the ledger does not value; 0 when omitted. */
    unlinkedCost?: Decimal;
  } | void> {
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
    // The catalogue price stays what the row was written with.
    if (!plan.anyLinked) return { unlinkedCost: new Prisma.Decimal(0) };
    const total = results.reduce(
      (sum, r) => sum.add(r.cost),
      plan.unlinkedCost,
    );
    return {
      cost: total.toDecimalPlaces(2),
      unitCost: total.div(after.quantityKg).toDecimalPlaces(2),
      unlinkedCost: plan.unlinkedCost,
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
