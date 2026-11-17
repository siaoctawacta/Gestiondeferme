import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma, Weighing } from '../generated/prisma/client';
import type { ExportColumn } from '../listing/export';
import { PrismaService } from '../prisma/prisma.service';
import { BatchesService } from './batches.service';
import {
  assertNotBeforeEntry,
  assertNotFuture,
  formatDay,
  requireDay,
} from '../common/days';
import type { CreateWeighingDto, UpdateWeighingDto } from './dto/weighing.dto';
import { auditHerd } from './herd-audit';
import { HerdLedgerService } from './herd-ledger.service';

export interface WeighingItem {
  id: string;
  batchId: string;
  date: string;
  sampleSize: number;
  averageWeightG: number;
  note: string | null;
}

export const WEIGHING_COLUMNS: ExportColumn<WeighingItem>[] = [
  { header: 'Date', date: true, value: (w) => w.date },
  { header: 'Échantillon', value: (w) => w.sampleSize },
  { header: 'Poids moyen (g)', value: (w) => w.averageWeightG },
];

const toItem = (w: Weighing): WeighingItem => ({
  id: w.id,
  batchId: w.batchId,
  date: formatDay(w.date),
  sampleSize: w.sampleSize,
  averageWeightG: w.averageWeightG,
  note: w.note,
});

@Injectable()
export class WeighingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
  ) {}

  async listArgs(ctx: RequestContext, batchId: string) {
    await this.batches.speciesOf(ctx, batchId);
    const where: Prisma.WeighingWhereInput = {
      batchId,
      farmId: { in: ctx.farmIds },
    };
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.weighing.findMany({
            where,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.weighing.count({ where }),
    };
  }

  create(
    ctx: RequestContext,
    batchId: string,
    dto: CreateWeighingDto,
  ): Promise<WeighingItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      this.ledger.assertOpen(batch);
      const date = requireDay(dto.date);
      assertNotFuture(date);
      assertNotBeforeEntry(batch.entryDate, date);
      const created = await tx.weighing.create({
        data: {
          farmId: batch.farmId,
          batchId,
          date,
          sampleSize: dto.sampleSize,
          averageWeightG: dto.averageWeightG,
          note: dto.note,
        },
      });
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'CREATE',
        created.id,
        `${batch.code} · pesée`,
        undefined,
        toItem(created),
      );
      return toItem(created);
    });
  }

  update(
    ctx: RequestContext,
    batchId: string,
    weighingId: string,
    dto: UpdateWeighingDto,
  ): Promise<WeighingItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      this.ledger.assertOpen(batch);
      const before = await this.find(tx, ctx, batchId, weighingId);
      let date: Date | undefined;
      if (dto.date) {
        date = requireDay(dto.date);
        assertNotFuture(date);
        assertNotBeforeEntry(batch.entryDate, date);
      }
      const updated = await tx.weighing.update({
        where: { id: weighingId },
        data: {
          date,
          sampleSize: dto.sampleSize,
          averageWeightG: dto.averageWeightG,
          note: dto.note,
        },
      });
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'UPDATE',
        weighingId,
        `${batch.code} · pesée`,
        toItem(before),
        toItem(updated),
      );
      return toItem(updated);
    });
  }

  remove(
    ctx: RequestContext,
    batchId: string,
    weighingId: string,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, batchId, ctx.farmIds);
      this.ledger.assertOpen(batch);
      const before = await this.find(tx, ctx, batchId, weighingId);
      await tx.weighing.delete({ where: { id: weighingId } });
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'DELETE',
        weighingId,
        `${batch.code} · pesée`,
        toItem(before),
      );
    });
  }

  private async find(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    batchId: string,
    id: string,
  ): Promise<Weighing> {
    const weighing = await tx.weighing.findFirst({
      where: { id, batchId, farmId: { in: ctx.farmIds } },
    });
    if (!weighing) throw new NotFoundException('Pesée introuvable');
    return weighing;
  }
}
