import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { formatDay, requireDay } from '../herd/days';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import type {
  CreateFeedDistributionDto,
  FeedListQueryDto,
  UpdateFeedDistributionDto,
} from './dto/feed-distribution.dto';
import { formulaCostPerKg, lineCost } from './feed-cost';
import { FeedTargets } from './feed-targets';
import { FeedService } from './feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaterService } from './water.service';

type Tx = Prisma.TransactionClient;

const include = {
  batch: { select: { code: true } },
  building: { select: { name: true } },
  feedProduct: { select: { name: true } },
  formula: { select: { name: true } },
} satisfies Prisma.FeedDistributionInclude;
type Row = Prisma.FeedDistributionGetPayload<{ include: typeof include }>;

export interface FeedDistributionItem {
  id: string;
  date: string;
  /** Lot code or building name. */
  target: string;
  targetKind: 'LOT' | 'BATIMENT';
  batchId: string | null;
  buildingId: string | null;
  feedName: string;
  feedProductId: string | null;
  formulaId: string | null;
  quantityKg: number;
  /** Water recorded for the same target and date. */
  waterLiters: number | null;
  unitCost: number;
  cost: number;
  note: string | null;
}

export const DISTRIBUTION_COLUMNS: ExportColumn<FeedDistributionItem>[] = [
  { header: 'Date', value: (d) => d.date },
  { header: 'Lot / Bâtiment', value: (d) => d.target },
  { header: 'Aliment', value: (d) => d.feedName },
  { header: 'Aliment (kg)', value: (d) => d.quantityKg },
  { header: 'Eau (L)', value: (d) => d.waterLiters },
  { header: 'Coût', value: (d) => d.cost },
];

const NEED_FEED = 'Indiquez un aliment ou une formule';
const NOT_FOUND = 'Distribution introuvable';
const SORTABLE = ['date', 'quantityKg', 'cost'];

@Injectable()
export class FeedDistributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: FeedTargets,
    private readonly water: WaterService,
    private readonly feed: FeedService,
  ) {}

  private async toItems(
    rows: Row[],
    client: Tx = this.prisma,
  ): Promise<FeedDistributionItem[]> {
    const batchIds = rows.flatMap((r) => (r.batchId ? [r.batchId] : []));
    const buildingIds = rows.flatMap((r) =>
      r.buildingId ? [r.buildingId] : [],
    );
    const dates = [...new Set(rows.map((r) => r.date))];
    const waters =
      rows.length === 0
        ? []
        : await client.waterConsumption.findMany({
            where: {
              date: { in: dates },
              OR: [
                { batchId: { in: batchIds } },
                { buildingId: { in: buildingIds } },
              ],
            },
            select: {
              batchId: true,
              buildingId: true,
              date: true,
              liters: true,
            },
          });
    const key = (id: string | null, date: Date) => `${id}:${date.getTime()}`;
    const liters = new Map(
      waters.map((w) => [
        key(w.batchId ?? w.buildingId, w.date),
        Number(w.liters),
      ]),
    );
    return rows.map((r) => ({
      id: r.id,
      date: formatDay(r.date),
      target: r.batch?.code ?? r.building?.name ?? '',
      targetKind: r.batchId ? 'LOT' : 'BATIMENT',
      batchId: r.batchId,
      buildingId: r.buildingId,
      feedName: r.feedProduct?.name ?? r.formula?.name ?? '',
      feedProductId: r.feedProductId,
      formulaId: r.formulaId,
      quantityKg: Number(r.quantityKg),
      waterLiters: liters.get(key(r.batchId ?? r.buildingId, r.date)) ?? null,
      unitCost: Number(r.unitCost),
      cost: Number(r.cost),
      note: r.note,
    }));
  }

  listArgs(ctx: RequestContext, q: FeedListQueryDto) {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const where: Prisma.FeedDistributionWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search
        ? {
            OR: [
              { batch: { code: containsInsensitive(q.search) } },
              { building: { name: containsInsensitive(q.search) } },
              { feedProduct: { name: containsInsensitive(q.search) } },
              { formula: { name: containsInsensitive(q.search) } },
            ],
          }
        : {}),
    };
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        this.toItems(
          await this.prisma.feedDistribution.findMany({
            where,
            include,
            orderBy: [
              order,
              ...(Object.hasOwn(order, 'date')
                ? []
                : [{ date: 'desc' as const }]),
              { createdAt: 'desc' },
              { id: 'asc' },
            ],
            ...range,
          }),
        ),
      count: () => this.prisma.feedDistribution.count({ where }),
    };
  }

  /** The feed an entry points at (exactly one source, active, in the organisation) and its cost per kg right now. */
  private async resolveFeed(
    tx: Tx,
    ctx: RequestContext,
    ids: { feedProductId?: string | null; formulaId?: string | null },
  ) {
    if (!ids.feedProductId === !ids.formulaId) {
      throw new BadRequestException(NEED_FEED);
    }
    const organizationId = ctx.user.organizationId;
    if (ids.feedProductId) {
      const product = await tx.feedProduct.findFirst({
        where: { id: ids.feedProductId, organizationId, active: true },
      });
      if (!product) throw new BadRequestException('Aliment invalide');
      return {
        feedProductId: product.id,
        formulaId: null,
        unitCost: product.unitCost,
      };
    }
    const formula = await tx.feedFormula.findFirst({
      where: { id: ids.formulaId ?? '', organizationId, active: true },
      include: { items: { include: { feedProduct: true } } },
    });
    if (!formula) throw new BadRequestException('Formule invalide');
    return {
      feedProductId: null,
      formulaId: formula.id,
      unitCost: formulaCostPerKg(formula.items),
    };
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    const row = await tx.feedDistribution.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    item: FeedDistributionItem,
    before?: FeedDistributionItem,
    after?: FeedDistributionItem,
  ): Promise<void> {
    return this.audit.log(
      {
        ctx,
        module: 'alimentation',
        action,
        recordId: item.id,
        label: `${item.target} · ${item.date}`,
        before,
        after,
      },
      tx,
    );
  }

  create(
    ctx: RequestContext,
    dto: CreateFeedDistributionDto,
  ): Promise<FeedDistributionItem> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.targets.resolve(tx, ctx, dto);
      const date = requireDay(dto.date);
      this.targets.assertDate(target, date);
      const feed = await this.resolveFeed(tx, ctx, dto);
      const created = await tx.feedDistribution.create({
        data: {
          farmId: target.farmId,
          date,
          batchId: target.batchId,
          buildingId: target.buildingId,
          ...feed,
          quantityKg: dto.quantityKg,
          cost: lineCost(dto.quantityKg, feed.unitCost),
          note: dto.note,
        },
        include,
      });
      if (dto.waterLiters !== undefined) {
        await this.water.upsertFor(tx, ctx, target, date, dto.waterLiters);
      }
      const [item] = await this.toItems([created], tx);
      await this.log(tx, ctx, 'CREATE', item, undefined, item);
      await this.feed.afterDistributionChange(tx, null, created);
      return item;
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateFeedDistributionDto,
  ): Promise<FeedDistributionItem> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      const target = await this.targets.forRow(tx, ctx, found);
      const before = await this.find(tx, ctx, id);
      const date = dto.date ? requireDay(dto.date) : before.date;
      if (dto.date) this.targets.assertDate(target, date);
      const changesFeed =
        dto.feedProductId !== undefined || dto.formulaId !== undefined;
      const feed = changesFeed
        ? await this.resolveFeed(tx, ctx, dto)
        : {
            feedProductId: before.feedProductId,
            formulaId: before.formulaId,
            unitCost: before.unitCost,
          };
      const [was] = await this.toItems([before], tx);
      const quantityKg = dto.quantityKg ?? before.quantityKg;
      const updated = await tx.feedDistribution.update({
        where: { id },
        data: {
          date,
          ...feed,
          quantityKg,
          cost: lineCost(quantityKg, feed.unitCost),
          note: dto.note,
        },
        include,
      });
      if (dto.waterLiters !== undefined) {
        await this.water.upsertFor(tx, ctx, target, date, dto.waterLiters);
      }
      const [item] = await this.toItems([updated], tx);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      await this.feed.afterDistributionChange(tx, before, updated);
      return item;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      await this.targets.forRow(tx, ctx, found);
      const before = await this.find(tx, ctx, id);
      const [was] = await this.toItems([before], tx);
      await tx.feedDistribution.delete({ where: { id } });
      await this.log(tx, ctx, 'DELETE', was, was);
      await this.feed.afterDistributionChange(tx, before, null);
    });
  }
}
