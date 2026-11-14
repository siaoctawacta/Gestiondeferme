import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { BatchEvent, Prisma } from '../generated/prisma/client';
import type { BatchEventType } from '../generated/prisma/enums';
import type { ListQueryDto } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import { BatchesService, BatchItem } from './batches.service';
import { formatDay, requireDay } from './days';
import type {
  CreateEventDto,
  TransferDto,
  UpdateEventDto,
} from './dto/event.dto';
import { auditHerd } from './herd-audit';
import { HerdLedgerService } from './herd-ledger.service';

export interface BatchEventItem {
  id: string;
  batchId: string;
  date: string;
  type: BatchEventType;
  quantity: number;
  cause: string | null;
  note: string | null;
  relatedBatchId: string | null;
  createdById: string;
  createdAt: string;
}

const toItem = (e: BatchEvent): BatchEventItem => ({
  id: e.id,
  batchId: e.batchId,
  date: formatDay(e.date),
  type: e.type,
  quantity: e.quantity,
  cause: e.cause,
  note: e.note,
  relatedBatchId: e.relatedBatchId,
  createdById: e.createdById,
  createdAt: e.createdAt.toISOString(),
});

const MANUAL = ['MORTALITE', 'VENTE', 'REFORME', 'ENTREE', 'NAISSANCE'];

@Injectable()
export class BatchEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, batchId: string, q: ListQueryDto) {
    await this.batches.speciesOf(ctx, batchId);
    const where: Prisma.BatchEventWhereInput = {
      batchId,
      farmId: { in: ctx.farmIds },
    };
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.batchEvent.findMany({
            where,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      () => this.prisma.batchEvent.count({ where }),
    );
  }

  create(
    ctx: RequestContext,
    batchId: string,
    dto: CreateEventDto,
  ): Promise<BatchEventItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      const event = await this.ledger.record(tx, {
        farmId: batch.farmId,
        batchId,
        date: requireDay(dto.date),
        type: dto.type,
        quantity: dto.quantity,
        cause: dto.cause,
        note: dto.note,
        userId: ctx.user.id,
      });
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'CREATE',
        event.id,
        `${batch.code} · ${event.type} ${event.quantity}`,
        undefined,
        toItem(event),
      );
      return toItem(event);
    });
  }

  update(
    ctx: RequestContext,
    batchId: string,
    eventId: string,
    dto: UpdateEventDto,
  ): Promise<BatchEventItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      await this.manualEvent(tx, ctx, batchId, eventId);
      const { before, after } = await this.ledger.update(
        tx,
        eventId,
        {
          date: dto.date ? requireDay(dto.date) : undefined,
          type: dto.type,
          quantity: dto.quantity,
          cause: dto.cause,
          note: dto.note,
        },
        ctx.farmIds,
      );
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'UPDATE',
        eventId,
        `${batch.code} · ${after.type} ${after.quantity}`,
        toItem(before),
        toItem(after),
      );
      return toItem(after);
    });
  }

  remove(ctx: RequestContext, batchId: string, eventId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      await this.manualEvent(tx, ctx, batchId, eventId);
      const removed = await this.ledger.remove(tx, eventId, ctx.farmIds);
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'DELETE',
        eventId,
        `${batch.code} · ${removed.type} ${removed.quantity}`,
        toItem(removed),
      );
    });
  }

  /** The event must belong to this batch, and only hand-entered types are editable. */
  private async manualEvent(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    batchId: string,
    eventId: string,
  ): Promise<void> {
    const event = await tx.batchEvent.findFirst({
      where: { id: eventId, batchId, farmId: { in: ctx.farmIds } },
      select: { type: true },
    });
    if (!event) throw new NotFoundException('Événement introuvable');
    if (!MANUAL.includes(event.type)) {
      throw new BadRequestException(
        'Un événement de transfert ne peut pas être modifié',
      );
    }
  }

  transfer(
    ctx: RequestContext,
    batchId: string,
    dto: TransferDto,
  ): Promise<BatchItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      const { before, after } = await this.ledger.transfer(tx, {
        farmId: batch.farmId,
        fromBatchId: batchId,
        toBuildingId: dto.toBuildingId,
        date: requireDay(dto.date),
        quantity: dto.quantity,
        userId: ctx.user.id,
      });
      const item = await this.batches.toItems(
        [
          await tx.animalBatch.findUniqueOrThrow({
            where: { id: batchId },
            include: {
              breed: { select: { name: true } },
              building: { select: { name: true } },
            },
          }),
        ],
        tx,
      );
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'UPDATE',
        batchId,
        `${batch.code} · transfert`,
        { buildingId: before.buildingId },
        { buildingId: after.buildingId, date: dto.date },
      );
      return item[0];
    });
  }
}
