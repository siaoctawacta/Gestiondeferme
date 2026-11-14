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
import { BatchesService } from '../herd/batches.service';
import { assertNotFuture, formatDay, requireDay } from '../herd/days';
import { hatchRate, ratio } from '../indicators/indicators';
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
const MS_PER_DAY = 86_400_000;
const NOT_FOUND = 'Incubation introuvable';
export const FINISHED = 'Cette incubation est terminée';
const BEFORE_START = "La date est antérieure au début de l'incubation";
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

/** fertile eggs / eggs set × 100 (indicators has no dedicated function; `ratio` is its shared rounding). */
const fertilityRate = (fertile: number | null, eggsSet: number) =>
  fertile === null ? null : ratio(fertile * 100, eggsSet);

const day = (d: Date | null) => (d ? formatDay(d) : null);

function toItem(r: RowWithSource): IncubationItem {
  return {
    id: r.id,
    code: r.code,
    sourceBatchId: r.sourceBatchId,
    sourceBatchCode: r.sourceBatch?.code ?? null,
    incubator: r.incubator,
    startDate: formatDay(r.startDate),
    eggsSet: r.eggsSet,
    candlingDate: day(r.candlingDate),
    fertileEggs: r.fertileEggs,
    expectedHatchDate: formatDay(r.expectedHatchDate),
    status: r.status,
    hatchDate: day(r.hatchDate),
    chicksHatched: r.chicksHatched,
    chickBatchId: r.chickBatchId,
    fertilityRate: fertilityRate(r.fertileEggs, r.eggsSet),
    hatchRate: hatchRate(r.chicksHatched, r.eggsSet),
    note: r.note,
  };
}

const expectedHatch = (start: Date) =>
  new Date(start.getTime() + INCUBATION_DAYS * MS_PER_DAY);

@Injectable()
export class IncubationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
  ) {}

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
    await tx.$queryRaw`SELECT id FROM "Incubation" WHERE id = ${id} AND "farmId" = ANY(${ctx.farmIds}::text[]) FOR NO KEY UPDATE`;
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

  private async assertSource(tx: Tx, farmId: string, id: string) {
    const batch = await tx.animalBatch.findFirst({
      where: { id, farmId, type: { in: ['PONDEUSE', 'REPRODUCTEUR'] } },
      select: { id: true },
    });
    if (!batch) throw new BadRequestException('Lot source invalide');
  }

  private async nextCode(tx: Tx, farmId: string, start: Date) {
    const prefix = `INC-${start.getUTCFullYear()}-`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incubation-code:${farmId}:${prefix}`}, 0))`;
    const rows = await tx.incubation.findMany({
      where: { farmId, code: { startsWith: prefix } },
      select: { code: true },
    });
    let max = 0;
    for (const { code } of rows) {
      const rest = code.slice(prefix.length);
      if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
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
      if (dto.sourceBatchId)
        await this.assertSource(tx, farmId, dto.sourceBatchId);
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
      if (dto.sourceBatchId) {
        await this.assertSource(tx, row.farmId, dto.sourceBatchId);
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
          { tx },
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
