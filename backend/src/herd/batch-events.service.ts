import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BatchEventItem, toEventItem } from './batch-event-item';
import { BatchesService, BatchItem } from './batches.service';
import { requireDay } from '../common/days';
import type {
  CreateEventDto,
  TransferDto,
  UpdateEventDto,
} from './dto/event.dto';
import { auditHerd } from './herd-audit';
import { HerdLedgerService } from './herd-ledger.service';

export const FROM_ELSEWHERE =
  "Cet événement provient d'une autre opération ; corrigez l'opération d'origine";

const MANUAL = ['MORTALITE', 'VENTE', 'REFORME', 'ENTREE', 'NAISSANCE'];

@Injectable()
export class BatchEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
  ) {}

  async listArgs(ctx: RequestContext, batchId: string) {
    await this.batches.speciesOf(ctx, batchId);
    const where: Prisma.BatchEventWhereInput = {
      batchId,
      farmId: { in: ctx.farmIds },
    };
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.batchEvent.findMany({
            where,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toEventItem),
      count: () => this.prisma.batchEvent.count({ where }),
    };
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
        audit: { ctx },
      });
      return toEventItem(event);
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
        toEventItem(before),
        toEventItem(after),
      );
      return toEventItem(after);
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
        toEventItem(removed),
      );
    });
  }

  /**
   * The event must belong to this batch, be a hand-entered type and not come
   * from another operation (weaning...): those are corrected at their origin.
   */
  private async manualEvent(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    batchId: string,
    eventId: string,
  ): Promise<void> {
    const event = await tx.batchEvent.findFirst({
      where: { id: eventId, batchId, farmId: { in: ctx.farmIds } },
      select: { type: true, sourceType: true },
    });
    if (!event) throw new NotFoundException('Événement introuvable');
    if (event.sourceType !== null) throw new ConflictException(FROM_ELSEWHERE);
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
