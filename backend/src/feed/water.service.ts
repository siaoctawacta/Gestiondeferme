import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { formatDay, requireDay } from '../herd/days';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import type { FeedListQueryDto } from './dto/feed-distribution.dto';
import type { CreateWaterDto, UpdateWaterDto } from './dto/water.dto';
import { FeedTarget, FeedTargets } from './feed-targets';

type Tx = Prisma.TransactionClient;

const include = {
  batch: { select: { code: true } },
  building: { select: { name: true } },
} satisfies Prisma.WaterConsumptionInclude;
type Row = Prisma.WaterConsumptionGetPayload<{ include: typeof include }>;

export interface WaterItem {
  id: string;
  date: string;
  target: string;
  targetKind: 'LOT' | 'BATIMENT';
  batchId: string | null;
  buildingId: string | null;
  liters: number;
}

export const WATER_DUPLICATE = 'Un enregistrement existe déjà pour cette date';
const NOT_FOUND = 'Enregistrement introuvable';
const SORTABLE = ['date', 'liters'];

const toItem = (r: Row): WaterItem => ({
  id: r.id,
  date: formatDay(r.date),
  target: r.batch?.code ?? r.building?.name ?? '',
  targetKind: r.batchId ? 'LOT' : 'BATIMENT',
  batchId: r.batchId,
  buildingId: r.buildingId,
  liters: Number(r.liters),
});

@Injectable()
export class WaterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: FeedTargets,
  ) {}

  list(ctx: RequestContext, q: FeedListQueryDto) {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const where: Prisma.WaterConsumptionWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search
        ? {
            OR: [
              { batch: { code: containsInsensitive(q.search) } },
              { building: { name: containsInsensitive(q.search) } },
            ],
          }
        : {}),
    };
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.waterConsumption.findMany({
            where,
            include,
            relationLoadStrategy: 'join',
            orderBy: [
              order,
              ...(Object.hasOwn(order, 'date')
                ? []
                : [{ date: 'desc' as const }]),
              { id: 'asc' },
            ],
            ...range,
          })
        ).map(toItem),
      () => this.prisma.waterConsumption.count({ where }),
    );
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: AuditAction,
    row: Row,
    before?: WaterItem,
  ): Promise<void> {
    const item = toItem(row);
    return this.audit.log(
      {
        ctx,
        module: 'alimentation',
        action,
        recordId: row.id,
        label: `Eau · ${item.target} · ${item.date}`,
        before,
        after: action === 'DELETE' ? undefined : item,
      },
      tx,
    );
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    const row = await tx.waterConsumption.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** Creates the water record of `target` on `date`, or updates the one that exists. */
  async upsertFor(
    tx: Tx,
    ctx: RequestContext,
    target: FeedTarget,
    date: Date,
    liters: number,
  ): Promise<void> {
    const existing = await tx.waterConsumption.findFirst({
      where: target.batchId
        ? { batchId: target.batchId, date }
        : { buildingId: target.buildingId, date },
      include,
      relationLoadStrategy: 'join',
    });
    if (existing) {
      const updated = await tx.waterConsumption.update({
        where: { id: existing.id },
        data: { liters },
        include,
        relationLoadStrategy: 'join',
      });
      await this.log(tx, ctx, 'UPDATE', updated, toItem(existing));
      return;
    }
    const created = await orConflict(
      () =>
        tx.waterConsumption.create({
          data: {
            farmId: target.farmId,
            batchId: target.batchId,
            buildingId: target.buildingId,
            date,
            liters,
          },
          include,
        }),
      WATER_DUPLICATE,
    );
    await this.log(tx, ctx, 'CREATE', created);
  }

  create(ctx: RequestContext, dto: CreateWaterDto): Promise<WaterItem> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.targets.resolve(tx, ctx, dto);
      const date = requireDay(dto.date);
      this.targets.assertDate(target, date);
      const created = await orConflict(
        () =>
          tx.waterConsumption.create({
            data: {
              farmId: target.farmId,
              batchId: target.batchId,
              buildingId: target.buildingId,
              date,
              liters: dto.liters,
            },
            include,
            relationLoadStrategy: 'join',
          }),
        WATER_DUPLICATE,
      );
      await this.log(tx, ctx, 'CREATE', created);
      return toItem(created);
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateWaterDto,
  ): Promise<WaterItem> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      const target = await this.targets.forRow(tx, ctx, found);
      const before = await this.find(tx, ctx, id);
      const date = dto.date ? requireDay(dto.date) : before.date;
      if (dto.date) this.targets.assertDate(target, date);
      const updated = await orConflict(
        () =>
          tx.waterConsumption.update({
            where: { id },
            data: { date, liters: dto.liters },
            include,
            relationLoadStrategy: 'join',
          }),
        WATER_DUPLICATE,
      );
      await this.log(tx, ctx, 'UPDATE', updated, toItem(before));
      return toItem(updated);
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      await this.targets.forRow(tx, ctx, found);
      const before = await this.find(tx, ctx, id);
      await tx.waterConsumption.delete({ where: { id } });
      await this.log(tx, ctx, 'DELETE', before, toItem(before));
    });
  }
}
