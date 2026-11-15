import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { IncubationStatus } from '../generated/prisma/enums';
import {
  BatchHistoryRegistry,
  type BatchHistorySource,
} from '../herd/batch-history';
import { BatchesService } from '../herd/batches.service';
import { LAYING_TYPES } from '../herd/species';
import {
  addDays,
  assertNotBeforeEntry,
  assertNotFuture,
  formatDay,
  formatDayOrNull,
  requireDay,
} from '../common/days';
import { lockRow } from '../common/lock-row';
import { nextNumberedCode } from '../common/next-code';
import { fertilityRate, hatchRate } from '../indicators/indicators';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CandlingDto,
  CreateIncubationDto,
  FailDto,
  HatchDto,
  IncubationListQueryDto,
  UpdateIncubationDto,
} from './dto/incubation.dto';

type Tx = Prisma.TransactionClient;
type Row = Prisma.IncubationGetPayload<object>;

const INCUBATION_DAYS = 21;
const NOT_FOUND = 'Incubation introuvable';
export const FINISHED = 'Cette incubation est terminée';
const BEFORE_START = "La date est antérieure au début de l'incubation";
const BEFORE_CANDLING = 'La date est antérieure au mirage';
const STATUSES: IncubationStatus[] = ['EN_COURS', 'ECLOSE', 'ECHEC'];
const SORTABLE = ['startDate', 'code', 'expectedHatchDate', 'status'];

export interface IncubationItem {
  id: string;
  code: string;
  sourceBatchId: string | null;
  sourceBatchCode: string | null;
  incubator: string | null;
  startDate: string;
  eggsSet: number;
  candlingDate: string | null;
  fertileEggs: number | null;
  expectedHatchDate: string;
  status: IncubationStatus;
  hatchDate: string | null;
  chicksHatched: number | null;
  chickBatchId: string | null;
  /** fertile eggs / eggs set × 100. */
  fertilityRate: number | null;
  /** chicks hatched / eggs set × 100. */
  hatchRate: number | null;
  note: string | null;
}

const include = {
  sourceBatch: { select: { code: true } },
} satisfies Prisma.IncubationInclude;
type RowWithSource = Prisma.IncubationGetPayload<{ include: typeof include }>;

function toItem(r: RowWithSource): IncubationItem {
  return {
    id: r.id,
    code: r.code,
    sourceBatchId: r.sourceBatchId,
    sourceBatchCode: r.sourceBatch?.code ?? null,
    incubator: r.incubator,
    startDate: formatDay(r.startDate),
    eggsSet: r.eggsSet,
    candlingDate: formatDayOrNull(r.candlingDate),
    fertileEggs: r.fertileEggs,
    expectedHatchDate: formatDay(r.expectedHatchDate),
    status: r.status,
    hatchDate: formatDayOrNull(r.hatchDate),
    chicksHatched: r.chicksHatched,
    chickBatchId: r.chickBatchId,
    fertilityRate: fertilityRate(r.fertileEggs, r.eggsSet),
    hatchRate: hatchRate(r.chicksHatched, r.eggsSet),
    note: r.note,
  };
}

const expectedHatch = (start: Date) => addDays(start, INCUBATION_DAYS);

@Injectable()
export class IncubationsService implements BatchHistorySource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
    history: BatchHistoryRegistry,
  ) {
    history.register(this);
  }

  /** Earliest incubation set from the lot's eggs: moving the lot's entry date past it is refused. */
  async earliestDate(tx: Tx, batchId: string): Promise<Date | null> {
    const first = await tx.incubation.findFirst({
      where: { sourceBatchId: batchId },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });
    return first?.startDate ?? null;
  }

  listArgs(ctx: RequestContext, q: IncubationListQueryDto) {
    if (q.status && !STATUSES.includes(q.status as IncubationStatus)) {
      throw new BadRequestException("Statut d'incubation invalide");
    }
    const where: Prisma.IncubationWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.status ? { status: q.status as IncubationStatus } : {}),
      ...(q.search ? { code: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { startDate: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.incubation.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.incubation.count({ where }),
    };
  }

  /** Per-status totals over the whole scope, whatever the search or page. */
  async statusCounts(
    ctx: RequestContext,
  ): Promise<Record<IncubationStatus, number>> {
    const groups = await this.prisma.incubation.groupBy({
      by: ['status'],
      where: { farmId: { in: ctx.farmIds } },
      _count: { _all: true },
    });
    const counts: Record<IncubationStatus, number> = {
      EN_COURS: 0,
      ECLOSE: 0,
      ECHEC: 0,
    };
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  async get(ctx: RequestContext, id: string): Promise<IncubationItem> {
    const row = await this.prisma.incubation.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return toItem(row);
  }

  /** Takes the row lock that serialises changes to one incubation; 404 outside the caller's farms. */
  private async lock(tx: Tx, ctx: RequestContext, id: string) {
    await lockRow(tx, 'Incubation', id, ctx.farmIds);
    const row = await tx.incubation.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private assertOngoing(row: Pick<Row, 'status'>): void {
    if (row.status !== 'EN_COURS') throw new ConflictException(FINISHED);
  }

  /** The source lot lays eggs, is in the farm, and entered before the incubation started. */
  private async assertSource(
    tx: Tx,
    farmId: string,
    id: string,
    startDate: Date,
  ) {
    const batch = await tx.animalBatch.findFirst({
      where: { id, farmId, species: 'AVICOLE', type: { in: LAYING_TYPES } },
      select: { id: true, entryDate: true },
    });
    if (!batch) throw new BadRequestException('Lot source invalide');
    assertNotBeforeEntry(batch.entryDate, startDate);
  }

  private nextCode(tx: Tx, farmId: string, start: Date) {
    const prefix = `INC-${start.getUTCFullYear()}-`;
    return nextNumberedCode(tx, {
      lockKey: `incubation-code:${farmId}:${prefix}`,
      prefix,
      width: 2,
      existing: async () =>
        (
          await tx.incubation.findMany({
            where: { farmId, code: { startsWith: prefix } },
            select: { code: true },
          })
        ).map((r) => r.code),
    });
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    code: string,
    id: string,
    before?: IncubationItem,
    after?: IncubationItem,
  ) {
    return this.audit.log(
      {
        ctx,
        module: 'ponte',
        action,
        recordId: id,
        label: code,
        before,
        after,
      },
      tx,
    );
  }

  create(
    ctx: RequestContext,
    dto: CreateIncubationDto,
  ): Promise<IncubationItem> {
    return this.prisma.$transaction(async (tx) => {
      const farmId = ctx.farmId;
      if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
      const startDate = requireDay(dto.startDate);
      assertNotFuture(startDate);
      if (dto.sourceBatchId) {
        await this.assertSource(tx, farmId, dto.sourceBatchId, startDate);
      }
      const code = dto.code ?? (await this.nextCode(tx, farmId, startDate));
      const created = await orConflict(
        () =>
          tx.incubation.create({
            data: {
              farmId,
              code,
              sourceBatchId: dto.sourceBatchId,
              incubator: dto.incubator,
              startDate,
              eggsSet: dto.eggsSet,
              expectedHatchDate: expectedHatch(startDate),
              note: dto.note,
            },
            include,
          }),
        'Ce code d’incubation existe déjà',
      );
      const item = toItem(created);
      await this.log(tx, ctx, 'CREATE', code, created.id, undefined, item);
      return item;
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateIncubationDto,
  ): Promise<IncubationItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      this.assertOngoing(row);
      const startDate = dto.startDate
        ? requireDay(dto.startDate)
        : row.startDate;
      if (dto.startDate) {
        assertNotFuture(startDate);
        if (row.candlingDate && row.candlingDate < startDate) {
          throw new BadRequestException(BEFORE_START);
        }
      }
      const eggsSet = dto.eggsSet ?? row.eggsSet;
      if (row.fertileEggs !== null && row.fertileEggs > eggsSet) {
        throw new BadRequestException(
          'Les œufs fertiles dépassent les œufs mis en incubation',
        );
      }
      const sourceBatchId = dto.sourceBatchId ?? row.sourceBatchId;
      if (sourceBatchId && (dto.sourceBatchId || dto.startDate)) {
        await this.assertSource(tx, row.farmId, sourceBatchId, startDate);
      }
      const updated = await tx.incubation.update({
        where: { id },
        data: {
          sourceBatchId: dto.sourceBatchId,
          incubator: dto.incubator,
          startDate,
          eggsSet,
          expectedHatchDate: expectedHatch(startDate),
          note: dto.note,
        },
        include,
      });
      const after = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', row.code, id, toItem(row), after);
      return after;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      if (row.status === 'ECLOSE') throw new ConflictException(FINISHED);
      await tx.incubation.delete({ where: { id } });
      await this.log(tx, ctx, 'DELETE', row.code, id, toItem(row));
    });
  }

  candling(
    ctx: RequestContext,
    id: string,
    dto: CandlingDto,
  ): Promise<IncubationItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      this.assertOngoing(row);
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (date < row.startDate) throw new BadRequestException(BEFORE_START);
      if (dto.fertileEggs > row.eggsSet) {
        throw new BadRequestException(
          'Les œufs fertiles dépassent les œufs mis en incubation',
        );
      }
      const updated = await tx.incubation.update({
        where: { id },
        data: { candlingDate: date, fertileEggs: dto.fertileEggs },
        include,
      });
      const after = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', row.code, id, toItem(row), after);
      return after;
    });
  }

  fail(ctx: RequestContext, id: string, dto: FailDto): Promise<IncubationItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      this.assertOngoing(row);
      const updated = await tx.incubation.update({
        where: { id },
        data: { status: 'ECHEC', note: dto.note ?? row.note },
        include,
      });
      const after = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', row.code, id, toItem(row), after);
      return after;
    });
  }

  /** Marks the incubation hatched and creates the chicks' batch in the same transaction. */
  hatch(
    ctx: RequestContext,
    id: string,
    dto: HatchDto,
  ): Promise<IncubationItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      this.assertOngoing(row);
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (date < row.startDate) throw new BadRequestException(BEFORE_START);
      if (row.candlingDate && date < row.candlingDate) {
        throw new BadRequestException(BEFORE_CANDLING);
      }
      const limit = row.fertileEggs ?? row.eggsSet;
      if (dto.chicksHatched > limit) {
        throw new BadRequestException(
          row.fertileEggs === null
            ? 'Les poussins dépassent les œufs mis en incubation'
            : 'Les poussins dépassent les œufs fertiles',
        );
      }
      let chickBatchId: string | null = null;
      if (dto.chicksHatched > 0) {
        const batch = await this.batches.create(
          ctx,
          {
            species: 'AVICOLE',
            type: 'POUSSIN',
            buildingId: dto.buildingId,
            breedId: dto.breedId,
            entryDate: dto.date,
            initialCount: dto.chicksHatched,
          },
          { tx, source: { type: 'HATCH', id } },
        );
        chickBatchId = batch.id;
      }
      const updated = await tx.incubation.update({
        where: { id },
        data: {
          status: 'ECLOSE',
          hatchDate: date,
          chicksHatched: dto.chicksHatched,
          chickBatchId,
        },
        include,
      });
      const after = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', row.code, id, toItem(row), after);
      return after;
    });
  }
}
