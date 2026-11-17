import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import {
  assertNotBeforeEntry,
  assertNotFuture,
  formatDay,
  requireDay,
} from '../common/days';
import { DUPLICATE } from '../common/messages';
import {
  BatchHistoryRegistry,
  type BatchHistorySource,
} from '../herd/batch-history';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { canLay } from '../herd/species';
import type { BatchType, Species } from '../generated/prisma/enums';
import { EggStockService } from './egg-stock';
import { breakageRate, layingRate } from '../indicators/indicators';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateEggProductionDto,
  EggListQueryDto,
  UpdateEggProductionDto,
} from './dto/egg-production.dto';
import { marketableOf } from './egg-balance';

type Tx = Prisma.TransactionClient;

const include = {
  batch: { select: { code: true } },
} satisfies Prisma.EggProductionInclude;
type Row = Prisma.EggProductionGetPayload<{ include: typeof include }>;

export interface EggProductionItem {
  id: string;
  date: string;
  batchId: string;
  batchCode: string;
  collected: number;
  broken: number;
  downgraded: number;
  toIncubation: number;
  /** collected − broken − downgraded − toIncubation. */
  marketable: number;
  /** broken / collected × 100. */
  breakageRate: number | null;
  /** collected / hens alive that day × 100. */
  layingRate: number | null;
  note: string | null;
}

export const EGG_COLUMNS: ExportColumn<EggProductionItem>[] = [
  { header: 'Date', value: (e) => e.date },
  { header: 'Lot', value: (e) => e.batchCode },
  { header: 'Œufs collectés', value: (e) => e.collected },
  { header: 'Œufs cassés', value: (e) => e.broken },
  { header: 'Mis en incubation', value: (e) => e.toIncubation },
  { header: 'Taux de casse', value: (e) => e.breakageRate },
];

export interface EggPeriodFigures {
  collected: number;
  broken: number;
  downgraded: number;
  toIncubation: number;
  /** collected − broken − downgraded − toIncubation, per record. */
  marketable: number;
  /** Hens alive on each (lot, day) that recorded eggs, summed: the denominator of the laying rate. */
  henDays: number;
}

const noEggs = (): EggPeriodFigures => ({
  collected: 0,
  broken: 0,
  downgraded: 0,
  toIncubation: 0,
  marketable: 0,
  henDays: 0,
});

const sumFigures = (
  byBatch: Map<string, EggPeriodFigures>,
): EggPeriodFigures => {
  const total = noEggs();
  for (const f of byBatch.values()) {
    for (const key of Object.keys(total) as (keyof EggPeriodFigures)[]) {
      total[key] += f[key];
    }
  }
  return total;
};

const SORTABLE = ['date', 'collected'];
export const NO_EGGS = "Ce lot ne produit pas d'œufs";
const OVER =
  'Les œufs cassés, déclassés et mis en incubation dépassent les œufs collectés';
const NOT_FOUND = 'Enregistrement introuvable';

@Injectable()
export class EggProductionService implements BatchHistorySource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly audit: AuditService,
    private readonly stock: EggStockService,
    history: BatchHistoryRegistry,
  ) {
    history.register(this);
  }

  /**
   * The egg figures of each lot between two days (both inclusive): what was
   * collected, broken, downgraded and put in incubation, what can be sold
   * (`marketableOf`) and the hen-days behind the laying rate (the hens alive on
   * each day that lot recorded eggs, summed). Three queries whatever the lots
   * and days; `periodFigures` is the sum of these, and `layingRate(collected,
   * henDays)` the one laying-rate computation of the dashboard and the reports.
   */
  periodFiguresByBatch(
    farmIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, EggPeriodFigures>> {
    return this.figuresWhere({
      farmId: { in: farmIds },
      date: { gte: from, lte: to },
    });
  }

  /**
   * The totals of given (farm, day) pairs (each farm's own latest day for the
   * dashboard): the same figures through the same queries whatever the number
   * of pairs, so the dashboard's query count does not grow with the farms.
   */
  async periodFiguresOnDays(
    pairs: { farmId: string; date: Date }[],
  ): Promise<EggPeriodFigures> {
    if (pairs.length === 0) return noEggs();
    return sumFigures(
      await this.figuresWhere({
        OR: pairs.map((p) => ({ farmId: p.farmId, date: p.date })),
      }),
    );
  }

  private async figuresWhere(
    where: Prisma.EggProductionWhereInput,
  ): Promise<Map<string, EggPeriodFigures>> {
    const rows = await this.prisma.eggProduction.groupBy({
      by: ['batchId', 'date'],
      where,
      _sum: {
        collected: true,
        broken: true,
        downgraded: true,
        toIncubation: true,
      },
    });
    const hens = await this.ledger.liveCountsOnDays(
      rows.map((r) => ({ batchId: r.batchId, date: r.date })),
    );
    const result = new Map<string, EggPeriodFigures>();
    for (const r of rows) {
      const own = result.get(r.batchId) ?? noEggs();
      const sum = {
        collected: r._sum.collected ?? 0,
        broken: r._sum.broken ?? 0,
        downgraded: r._sum.downgraded ?? 0,
        toIncubation: r._sum.toIncubation ?? 0,
      };
      own.collected += sum.collected;
      own.broken += sum.broken;
      own.downgraded += sum.downgraded;
      own.toIncubation += sum.toIncubation;
      own.marketable += marketableOf(sum);
      own.henDays += hens.get(`${r.batchId}:${r.date.getTime()}`) ?? 0;
      result.set(r.batchId, own);
    }
    return result;
  }

  /** The egg figures of the farms between two days, all lots together (`periodFiguresByBatch` summed). */
  async periodFigures(
    farmIds: string[],
    from: Date,
    to: Date,
  ): Promise<EggPeriodFigures> {
    return sumFigures(await this.periodFiguresByBatch(farmIds, from, to));
  }

  /** Earliest egg record of the lot: moving the lot's entry date past it is refused. */
  async earliestDate(tx: Tx, batchId: string): Promise<Date | null> {
    const first = await tx.eggProduction.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    return first?.date ?? null;
  }

  private async toItems(
    rows: Row[],
    client: Tx = this.prisma,
  ): Promise<EggProductionItem[]> {
    // The hens alive depend on the day: one ledger query per distinct date.
    const byDate = new Map<number, Set<string>>();
    for (const r of rows) {
      const key = r.date.getTime();
      byDate.set(key, (byDate.get(key) ?? new Set()).add(r.batchId));
    }
    const alive = new Map<string, number>();
    await Promise.all(
      [...byDate].map(async ([time, batchIds]) => {
        const counts = await this.ledger.liveCounts(
          [...batchIds],
          new Date(time),
          client,
        );
        for (const [id, n] of counts) alive.set(`${id}:${time}`, n);
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      date: formatDay(r.date),
      batchId: r.batchId,
      batchCode: r.batch.code,
      collected: r.collected,
      broken: r.broken,
      downgraded: r.downgraded,
      toIncubation: r.toIncubation,
      marketable: marketableOf(r),
      breakageRate: breakageRate(r.broken, r.collected),
      layingRate: layingRate(
        r.collected,
        alive.get(`${r.batchId}:${r.date.getTime()}`),
      ),
      note: r.note,
    }));
  }

  listArgs(ctx: RequestContext, q: EggListQueryDto) {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const where: Prisma.EggProductionWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search ? { batch: { code: containsInsensitive(q.search) } } : {}),
    };
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        this.toItems(
          await this.prisma.eggProduction.findMany({
            where,
            include,
            orderBy: [
              order,
              ...(Object.hasOwn(order, 'date')
                ? []
                : [{ date: 'desc' as const }]),
              { batch: { code: 'asc' } },
              { id: 'asc' },
            ],
            ...range,
          }),
        ),
      count: () => this.prisma.eggProduction.count({ where }),
    };
  }

  /** The farm's laying batch, locked; 400 when it is not in the caller's farm or does not lay. */
  private async layingBatch(tx: Tx, ctx: RequestContext, batchId: string) {
    const found = await tx.animalBatch.findFirst({
      where: { id: batchId, farmId: ctx.farmId ?? undefined },
      select: { id: true },
    });
    if (!found || !ctx.farmId) throw new BadRequestException('Lot invalide');
    const batch = await this.ledger.lockBatch(tx, batchId, [ctx.farmId]);
    this.assertLays(batch);
    this.ledger.assertOpen(batch);
    return batch;
  }

  private assertLays(batch: { species: Species; type: BatchType }): void {
    if (!canLay(batch)) {
      throw new BadRequestException(NO_EGGS);
    }
  }

  private assertFigures(r: {
    collected: number;
    broken: number;
    downgraded: number;
    toIncubation: number;
  }): void {
    if (r.broken + r.downgraded + r.toIncubation > r.collected) {
      throw new BadRequestException(OVER);
    }
  }

  /**
   * The lot's whole marketable production once `change` is made (a record
   * added, replaced or removed), checked against what was sold: no day of the
   * history may end below zero. Called under the lot lock.
   */
  private async assertNotSold(
    tx: Tx,
    batchId: string,
    change: {
      skipId?: string;
      add?: { date: Date; marketable: number };
    },
  ): Promise<void> {
    const rows = await tx.eggProduction.findMany({
      where: {
        batchId,
        ...(change.skipId ? { id: { not: change.skipId } } : {}),
      },
      select: {
        date: true,
        collected: true,
        broken: true,
        downgraded: true,
        toIncubation: true,
      },
    });
    const next = rows.map((r) => ({
      date: r.date,
      marketable: marketableOf(r),
    }));
    if (change.add) next.push(change.add);
    await this.stock.assertProduction(tx, batchId, next);
  }

  private assertDate(entryDate: Date, date: Date): void {
    assertNotFuture(date);
    assertNotBeforeEntry(entryDate, date);
  }

  create(
    ctx: RequestContext,
    dto: CreateEggProductionDto,
  ): Promise<EggProductionItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.layingBatch(tx, ctx, dto.batchId);
      const date = requireDay(dto.date);
      this.assertDate(batch.entryDate, date);
      const data = {
        collected: dto.collected,
        broken: dto.broken ?? 0,
        downgraded: dto.downgraded ?? 0,
        toIncubation: dto.toIncubation ?? 0,
      };
      this.assertFigures(data);
      await this.assertNotSold(tx, batch.id, {
        add: { date, marketable: marketableOf(data) },
      });
      const created = await orConflict(
        () =>
          tx.eggProduction.create({
            data: {
              farmId: batch.farmId,
              batchId: batch.id,
              date,
              ...data,
              note: dto.note,
            },
            include,
          }),
        DUPLICATE,
      );
      const [item] = await this.toItems([created], tx);
      await this.audit.log(
        {
          ctx,
          module: 'ponte',
          action: 'CREATE',
          recordId: created.id,
          label: `${batch.code} · ${item.date}`,
          after: item,
        },
        tx,
      );
      return item;
    });
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    const row = await tx.eggProduction.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateEggProductionDto,
  ): Promise<EggProductionItem> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      const batch = await this.ledger.lockBatch(tx, found.batchId, ctx.farmIds);
      this.ledger.assertOpen(batch);
      const before = await this.find(tx, ctx, id);
      const date = dto.date ? requireDay(dto.date) : before.date;
      if (dto.date) this.assertDate(batch.entryDate, date);
      const next = {
        collected: dto.collected ?? before.collected,
        broken: dto.broken ?? before.broken,
        downgraded: dto.downgraded ?? before.downgraded,
        toIncubation: dto.toIncubation ?? before.toIncubation,
      };
      this.assertFigures(next);
      await this.assertNotSold(tx, batch.id, {
        skipId: id,
        add: { date, marketable: marketableOf(next) },
      });
      const updated = await orConflict(
        () =>
          tx.eggProduction.update({
            where: { id },
            data: { date, ...next, note: dto.note },
            include,
          }),
        DUPLICATE,
      );
      const [after] = await this.toItems([updated], tx);
      const [was] = await this.toItems([before], tx);
      await this.audit.log(
        {
          ctx,
          module: 'ponte',
          action: 'UPDATE',
          recordId: id,
          label: `${batch.code} · ${after.date}`,
          before: was,
          after,
        },
        tx,
      );
      return after;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      const batch = await this.ledger.lockBatch(tx, found.batchId, ctx.farmIds);
      this.ledger.assertOpen(batch);
      const [before] = await this.toItems([await this.find(tx, ctx, id)], tx);
      await this.assertNotSold(tx, batch.id, { skipId: id });
      await tx.eggProduction.delete({ where: { id } });
      await this.audit.log(
        {
          ctx,
          module: 'ponte',
          action: 'DELETE',
          recordId: id,
          label: `${batch.code} · ${before.date}`,
          before,
        },
        tx,
      );
    });
  }
}
