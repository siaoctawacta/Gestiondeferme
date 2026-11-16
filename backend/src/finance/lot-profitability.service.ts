import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { toMoney, zero } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type {
  BatchStatus,
  BatchType,
  FinanceCategory,
  Species,
} from '../generated/prisma/enums';
import { STATUS_LABEL, TYPE_LABEL } from '../herd/batches.service';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { costPerAnimal, costPerKg, margin } from '../indicators/indicators';
import {
  FEED_COST,
  HEALTH_COST,
  LotCostRegistry,
  type LotCost,
} from '../indicators/lot-cost';
import type { ExportColumn } from '../listing/export';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { REVENUE_STATUSES } from '../sales/sale-workflow';
import type { LotsQueryDto } from './dto/finance.dto';
import { CATEGORY_LABEL, EXPENSE_CATEGORIES } from './finance-categories';
import { periodOf } from './finance-period';

type Range = { from?: Date; to?: Date };

const NOT_FOUND = 'Lot introuvable';
const BAD_STATUS = 'Le statut est invalide';
const SORTABLE = ['code', 'entryDate'];

/** What a lot sold over a period. `unweighed`: a LOT line of the period has no weight, so its kilos are unknown. */
interface LotSales {
  sold: Decimal;
  revenue: Decimal;
  kg: Decimal;
  unweighed: boolean;
}
const noSales = (): LotSales => ({
  sold: zero(),
  revenue: zero(),
  kg: zero(),
  unweighed: false,
});

export interface LotProfitability {
  /** The lot's id (the kit's row id), equal to `batchId`. */
  id: string;
  batchId: string;
  code: string;
  species: Species;
  type: BatchType;
  status: BatchStatus;
  /** Alive + sold (net), the denominator of the cost per animal. */
  animals: number;
  /** Net animals sold by the lot's LOT lines (what credit notes WITH return took back is removed). */
  sold: number;
  alive: number;
  costs: { animaux: number; aliment: number; sante: number; autres: number };
  totalCost: number;
  revenue: number;
  margin: number;
  costPerAnimal: number | null;
  costPerKg: number | null;
}

export interface LotProfitabilityDetail extends LotProfitability {
  /** The cost of the lot per finance category, in the order the screens list them. */
  lines: { category: FinanceCategory; label: string; amount: number }[];
}

export const LOT_COLUMNS: ExportColumn<LotProfitability>[] = [
  { header: 'Lot', value: (l) => l.code },
  { header: 'Type', value: (l) => TYPE_LABEL[l.type] },
  { header: 'Statut', value: (l) => STATUS_LABEL[l.status] },
  { header: 'Vendus', value: (l) => l.sold },
  { header: 'Coût total', value: (l) => l.totalCost },
  { header: 'Recettes', value: (l) => l.revenue },
  { header: 'Marge', value: (l) => l.margin },
  { header: 'Coût par animal', value: (l) => l.costPerAnimal },
  { header: 'Coût/kg', value: (l) => l.costPerKg },
];

const batchSelect = {
  id: true,
  code: true,
  species: true,
  type: true,
  status: true,
  entryDate: true,
  purchasePrice: true,
} satisfies Prisma.AnimalBatchSelect;
type BatchRow = Prisma.AnimalBatchGetPayload<{ select: typeof batchSelect }>;

/**
 * The categories of the lot view that only the system fills: the purchase price
 * of the lot (`ANIMAUX`) and what its consumption cost in the stock ledger
 * (`ALIMENT`, `SANTE`). A manual expense attributed to the lot NEVER counts
 * there whatever its own category (that category stays visible in the farm view):
 * it counts under `autres`, so `aliment` and `sante` here are the figures of
 * `batchPerformance`.
 */
const SYSTEM_CATEGORIES: FinanceCategory[] = ['ANIMAUX', 'ALIMENT', 'SANTE'];

/**
 * The finance category a cost reported by a `LotCostSource` counts under: the
 * feed and health sources (`FEED_COST`, `HEALTH_COST`) under `ALIMENT` and
 * `SANTE`, a manual expense under its own category except the system ones
 * (`AUTRE_CHARGE` instead).
 */
function categoryOf(cost: LotCost): FinanceCategory {
  if (cost.category === FEED_COST) return 'ALIMENT';
  if (cost.category === HEALTH_COST) return 'SANTE';
  const own = Object.hasOwn(CATEGORY_LABEL, cost.category)
    ? (cost.category as FinanceCategory)
    : 'AUTRE_CHARGE';
  return SYSTEM_CATEGORIES.includes(own) ? 'AUTRE_CHARGE' : own;
}

/**
 * The lot view (analytic, « Marge du lot »): what a lot cost and earned. The
 * cost is the lot's own purchase price, what its consumption cost (feed and
 * health through `LotCostRegistry`) and the manual expenses attributed to it
 * (`ManualLotCosts`); never a purchase (that money is already the farm's
 * expense). The revenue is its LOT and OEUFS invoice lines in `REVENUE_STATUSES`
 * less their credit lines. Every date-bearing amount follows the period by its
 * own date (entry date, consumption day, invoice date, credit note date); the
 * headcount is the current one. Reads are batched for the lots of a page: a
 * fixed number of queries (page + count, headcounts 2, costs 5, sales 2).
 */
@Injectable()
export class LotProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly herd: HerdLedgerService,
    private readonly costs: LotCostRegistry,
  ) {}

  private where(
    ctx: RequestContext,
    q: LotsQueryDto,
  ): Prisma.AnimalBatchWhereInput {
    if (q.status && !Object.hasOwn(STATUS_LABEL, q.status)) {
      throw new BadRequestException(BAD_STATUS);
    }
    return {
      farmId: { in: ctx.farmIds },
      ...(q.species ? { species: q.species } : {}),
      ...(q.status ? { status: q.status as BatchStatus } : {}),
      ...(q.search
        ? { code: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
  }

  listArgs(ctx: RequestContext, q: LotsQueryDto) {
    const where = this.where(ctx, q);
    const range = periodOf(q.from, q.to);
    const [[field, dir]] = Object.entries(
      orderBy(q, SORTABLE, { entryDate: 'desc' }),
    );
    return {
      find: async (page: { skip?: number; take: number }) => {
        const lots = await this.prisma.animalBatch.findMany({
          where,
          select: batchSelect,
          orderBy: [{ [field]: dir }, { code: 'asc' }, { id: 'asc' }],
          ...page,
        });
        return (await this.figures(ctx, lots, range)).map((f) => f.item);
      },
      count: () => this.prisma.animalBatch.count({ where }),
    };
  }

  async get(
    ctx: RequestContext,
    batchId: string,
    q: { from?: string; to?: string },
  ): Promise<LotProfitabilityDetail> {
    const lot = await this.prisma.animalBatch.findFirst({
      where: { id: batchId, farmId: { in: ctx.farmIds } },
      select: batchSelect,
    });
    if (!lot) throw new NotFoundException(NOT_FOUND);
    const [figures] = await this.figures(ctx, [lot], periodOf(q.from, q.to));
    return {
      ...figures.item,
      lines: EXPENSE_CATEGORIES.flatMap((category) => {
        const amount = figures.byCategory.get(category);
        return amount && !amount.isZero()
          ? [
              {
                category,
                label: CATEGORY_LABEL[category],
                amount: toMoney(amount),
              },
            ]
          : [];
      }),
    };
  }

  /** The open lots of an activity on the farms in view (the select of a manual expense). */
  async options(
    ctx: RequestContext,
    species: Species,
  ): Promise<{ items: { id: string; label: string }[] }> {
    const lots = await this.prisma.animalBatch.findMany({
      where: { farmId: { in: ctx.farmIds }, species, status: 'EN_COURS' },
      select: { id: true, code: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    return { items: lots.map((l) => ({ id: l.id, label: l.code })) };
  }

  private async figures(
    ctx: RequestContext,
    lots: BatchRow[],
    range: Range,
  ): Promise<{ item: LotProfitability; byCategory: Map<string, Decimal> }[]> {
    const ids = lots.map((l) => l.id);
    if (ids.length === 0) return [];
    const [alive, costs, sales] = await Promise.all([
      this.herd.liveCounts(ids),
      this.costs.costsFor(ids, range),
      this.salesOf(ctx, ids, range),
    ]);
    return lots.map((lot) => {
      const byCategory = new Map<string, Decimal>();
      const add = (category: string, amount: Decimal) =>
        byCategory.set(
          category,
          (byCategory.get(category) ?? zero()).add(amount),
        );
      const entered =
        (!range.from || lot.entryDate >= range.from) &&
        (!range.to || lot.entryDate <= range.to);
      if (entered && lot.purchasePrice) add('ANIMAUX', lot.purchasePrice);
      for (const c of costs.get(lot.id) ?? []) add(categoryOf(c), c.amount);

      const get = (c: string) => byCategory.get(c) ?? zero();
      const animaux = get('ANIMAUX');
      const aliment = get('ALIMENT');
      const sante = get('SANTE');
      const total = [...byCategory.values()].reduce((n, a) => n.add(a), zero());
      const autres = total.sub(animaux).sub(aliment).sub(sante);
      const s = sales.get(lot.id) ?? noSales();
      const aliveNow = alive.get(lot.id) ?? 0;
      const sold = s.sold.toNumber();
      const animals = aliveNow + sold;
      const lotMargin = margin(s.revenue, total);
      return {
        byCategory,
        item: {
          id: lot.id,
          batchId: lot.id,
          code: lot.code,
          species: lot.species,
          type: lot.type,
          status: lot.status,
          animals,
          sold,
          alive: aliveNow,
          costs: {
            animaux: toMoney(animaux),
            aliment: toMoney(aliment),
            sante: toMoney(sante),
            autres: toMoney(autres),
          },
          totalCost: toMoney(total),
          revenue: toMoney(s.revenue),
          margin: toMoney(lotMargin),
          costPerAnimal: costPerAnimal(total, animals),
          // A kilo price needs every sold bird weighed: one LOT line without a weight and there is none.
          costPerKg: s.unweighed ? null : costPerKg(total, s.kg),
        },
      };
    });
  }

  /**
   * What the lots sold: LOT and OEUFS lines of issued invoices dated in the
   * period, less the credit lines of credit notes dated in the period. A credit
   * note takes back its AMOUNT from the revenue; only a credit note WITH return
   * of the goods also takes back the animals (and their weight, pro rata): one
   * without return leaves them sold. Two queries.
   */
  private async salesOf(
    ctx: RequestContext,
    ids: string[],
    range: Range,
  ): Promise<Map<string, LotSales>> {
    const day = (r: Range) =>
      r.from || r.to ? { date: { gte: r.from, lte: r.to } } : {};
    const line = {
      batchId: { in: ids },
      kind: { in: ['LOT' as const, 'OEUFS' as const] },
      invoice: {
        farmId: { in: ctx.farmIds },
        status: { in: [...REVENUE_STATUSES] },
      },
    };
    const [lines, credits] = await Promise.all([
      this.prisma.invoiceLine.findMany({
        where: { ...line, invoice: { ...line.invoice, ...day(range) } },
        select: {
          batchId: true,
          kind: true,
          quantity: true,
          amount: true,
          weightKg: true,
        },
        relationLoadStrategy: 'join',
      }),
      this.prisma.creditNoteLine.findMany({
        where: { invoiceLine: line, creditNote: day(range) },
        select: {
          quantity: true,
          amount: true,
          creditNote: { select: { withReturn: true } },
          invoiceLine: {
            select: {
              batchId: true,
              kind: true,
              quantity: true,
              weightKg: true,
            },
          },
        },
        relationLoadStrategy: 'join',
      }),
    ]);
    const result = new Map<string, LotSales>();
    const of = (batchId: string) => {
      const found = result.get(batchId) ?? noSales();
      result.set(batchId, found);
      return found;
    };
    for (const l of lines) {
      if (!l.batchId) continue;
      const f = of(l.batchId);
      if (l.kind === 'LOT') f.sold = f.sold.add(l.quantity);
      f.revenue = f.revenue.add(l.amount);
      if (l.weightKg) f.kg = f.kg.add(l.weightKg);
      else if (l.kind === 'LOT') f.unweighed = true;
    }
    for (const c of credits) {
      const l = c.invoiceLine;
      if (!l.batchId) continue;
      const f = of(l.batchId);
      f.revenue = f.revenue.sub(c.amount);
      if (!c.creditNote.withReturn) continue;
      if (l.kind === 'LOT') f.sold = f.sold.sub(c.quantity);
      if (l.weightKg) {
        f.kg = f.kg.sub(l.weightKg.mul(c.quantity).div(l.quantity));
      }
    }
    return result;
  }
}
