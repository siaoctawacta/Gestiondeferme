import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import {
  assertNotBeforeBirth,
  assertNotBeforeEntry,
  assertNotFuture,
  formatDay,
  formatDayOrNull,
  requireDay,
} from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { QuarantineStatus } from '../generated/prisma/enums';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateQuarantineDto,
  LiftQuarantineDto,
  QuarantineQueryDto,
  UpdateQuarantineDto,
} from './dto/quarantine.dto';
import { HealthTargets } from './health-targets';

type Tx = Prisma.TransactionClient;

const include = {
  batch: { select: { code: true, entryDate: true } },
  animal: { select: { tag: true, birthDate: true } },
} satisfies Prisma.QuarantineInclude;
type Row = Prisma.QuarantineGetPayload<{ include: typeof include }>;

export interface QuarantineItem {
  id: string;
  /** Lot code or animal tag. */
  target: string;
  batchId: string | null;
  animalId: string | null;
  startDate: string;
  endDate: string | null;
  reason: string;
  status: QuarantineStatus;
}

const NOT_FOUND = 'Quarantaine introuvable';
const LIFTED = 'Cette quarantaine est déjà levée';
const NEED_TARGET = 'Indiquez un lot ou un animal';
const END_BEFORE_START = 'La fin ne peut pas précéder le début';
const OPEN = 'Une quarantaine est déjà en cours';
const STATUSES: QuarantineStatus[] = ['EN_COURS', 'LEVEE'];
const SORTABLE = ['startDate', 'endDate', 'status', 'createdAt'];

const toItem = (r: Row): QuarantineItem => ({
  id: r.id,
  target: r.batch?.code ?? r.animal?.tag ?? '',
  batchId: r.batchId,
  animalId: r.animalId,
  startDate: formatDay(r.startDate),
  endDate: formatDayOrNull(r.endDate),
  reason: r.reason,
  status: r.status,
});

/**
 * Quarantines of a lot or an animal (daily entries). Lifting and deleting lock
 * the quarantine row alone: a lot closed while quarantined can still be
 * lifted. Creating, and editing a start date, lock the target (lot or animal,
 * `HealthTargets`) first and the quarantine row second, like feed.
 */
@Injectable()
export class QuarantinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: HealthTargets,
  ) {}

  private scope(ctx: RequestContext): Prisma.QuarantineWhereInput {
    return {
      farmId: { in: ctx.farmIds },
      AND: [this.targets.visibleBatch(ctx), this.targets.visibleAnimal(ctx)],
    };
  }

  listArgs(ctx: RequestContext, q: QuarantineQueryDto) {
    if (q.status && !STATUSES.includes(q.status as QuarantineStatus)) {
      throw new BadRequestException('Statut invalide');
    }
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const where: Prisma.QuarantineWhereInput = {
      ...this.scope(ctx),
      ...(q.status ? { status: q.status as QuarantineStatus } : {}),
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.animalId ? { animalId: q.animalId } : {}),
      ...(from || to ? { startDate: { gte: from, lte: to } } : {}),
      ...(q.search
        ? {
            OR: [
              { reason: containsInsensitive(q.search) },
              { batch: { code: containsInsensitive(q.search) } },
              { animal: { tag: containsInsensitive(q.search) } },
            ],
          }
        : {}),
    };
    const order = orderBy(q, SORTABLE, { startDate: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.quarantine.findMany({
            where,
            include,
            relationLoadStrategy: 'join',
            orderBy: [order, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.quarantine.count({ where }),
    };
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    const row = await tx.quarantine.findFirst({
      where: { id, ...this.scope(ctx) },
      include,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** Finds the quarantine, locks it, and reads it again under the lock. */
  private async lock(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    await this.find(tx, ctx, id);
    await lockRow(tx, 'Quarantine', id, ctx.farmIds);
    return this.find(tx, ctx, id);
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    item: QuarantineItem,
    before?: QuarantineItem,
    after?: QuarantineItem,
  ) {
    return this.audit.logChange(
      {
        ctx,
        module: 'sante',
        action,
        recordId: item.id,
        label: `${item.target} · ${item.startDate}`,
        before,
        after,
      },
      tx,
    );
  }

  /** Not before the lot entered or the animal was born. */
  private assertStart(row: Row, start: Date): void {
    if (row.batch) assertNotBeforeEntry(row.batch.entryDate, start);
    else if (row.animal?.birthDate) {
      assertNotBeforeBirth(row.animal.birthDate, start);
    }
  }

  create(
    ctx: RequestContext,
    dto: CreateQuarantineDto,
  ): Promise<QuarantineItem> {
    if (!dto.batchId === !dto.animalId)
      throw new BadRequestException(NEED_TARGET);
    const start = requireDay(dto.startDate);
    const end = dto.endDate ? requireDay(dto.endDate) : null;
    if (end && end < start) throw new BadRequestException(END_BEFORE_START);
    return orConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const target = await this.targets.resolve(
            tx,
            ctx,
            { batchId: dto.batchId, animalId: dto.animalId },
            start,
          );
          // The target is locked: no other quarantine of it can open meanwhile.
          const open = await tx.quarantine.count({
            where: {
              status: 'EN_COURS',
              ...(target.kind === 'LOT'
                ? { batchId: target.id }
                : { animalId: target.id }),
            },
          });
          if (open > 0) throw new ConflictException(OPEN);
          const created = await tx.quarantine.create({
            data: {
              farmId: target.farmId,
              batchId: target.kind === 'LOT' ? target.id : null,
              animalId: target.kind === 'ANIMAL' ? target.id : null,
              startDate: start,
              endDate: end,
              reason: dto.reason,
            },
            include,
            relationLoadStrategy: 'join',
          });
          const item = toItem(created);
          await this.log(tx, ctx, 'CREATE', item, undefined, item);
          return item;
        }),
      OPEN,
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateQuarantineDto,
  ): Promise<QuarantineItem> {
    return this.prisma.$transaction(async (tx) => {
      // Moving the start locks the lot or animal first, like feed (target, then row).
      if (dto.startDate) {
        await this.targets.forRow(tx, ctx, await this.find(tx, ctx, id));
      }
      const before = await this.lock(tx, ctx, id);
      if (before.status === 'LEVEE') throw new ConflictException(LIFTED);
      const start = dto.startDate
        ? requireDay(dto.startDate)
        : before.startDate;
      if (dto.startDate) {
        assertNotFuture(start);
        this.assertStart(before, start);
      }
      const end =
        dto.endDate === undefined
          ? before.endDate
          : dto.endDate === null
            ? null
            : requireDay(dto.endDate);
      if (end && end < start) throw new BadRequestException(END_BEFORE_START);
      const updated = await tx.quarantine.update({
        where: { id },
        data: { startDate: start, endDate: end, reason: dto.reason },
        include,
        relationLoadStrategy: 'join',
      });
      const was = toItem(before);
      const item = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }

  /** Ends the quarantine on `date` (not in the future, not before its start). */
  lift(
    ctx: RequestContext,
    id: string,
    dto: LiftQuarantineDto,
  ): Promise<QuarantineItem> {
    const date = requireDay(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      if (before.status === 'LEVEE') throw new ConflictException(LIFTED);
      assertNotFuture(date);
      if (date < before.startDate) {
        throw new BadRequestException('La levée ne peut pas précéder le début');
      }
      const updated = await tx.quarantine.update({
        where: { id },
        data: { status: 'LEVEE', endDate: date },
        include,
        relationLoadStrategy: 'join',
      });
      const was = toItem(before);
      const item = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      await tx.quarantine.delete({ where: { id } });
      const was = toItem(before);
      await this.log(tx, ctx, 'DELETE', was, was);
    });
  }
}
