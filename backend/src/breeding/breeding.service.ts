import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { BreedingStatus } from '../generated/prisma/enums';
import { BatchesService } from '../herd/batches.service';
import { assertNotFuture, formatDay, requireDay, today } from '../herd/days';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BreedingListQueryDto,
  CreateBreedingDto,
  FailBreedingDto,
  FarrowingDto,
  UpdateBreedingDto,
  WeaningDto,
} from './dto/breeding.dto';

type Tx = Prisma.TransactionClient;

const MS_PER_DAY = 86_400_000;
const DEFAULT_GESTATION_DAYS = 114;
const NOT_FOUND = 'Saillie introuvable';
export const STEP_DONE = 'Cette étape a déjà été enregistrée';
const NOT_PREGNANT = "Cette saillie n'est plus en gestation";
const EXITED = 'Cet animal est sorti du cheptel';
const BEFORE_SERVICE = 'La date est antérieure à la saillie';
const STATUSES: BreedingStatus[] = [
  'GESTATION',
  'MISE_BAS',
  'SEVRAGE',
  'ECHEC',
];
const STATUS_LABEL: Record<BreedingStatus, string> = {
  GESTATION: 'Gestation',
  MISE_BAS: 'Mise bas',
  SEVRAGE: 'Sevrage',
  ECHEC: 'Échec',
};
const SORTABLE = [
  'serviceDate',
  'expectedFarrowingDate',
  'status',
  'createdAt',
];

const include = {
  sow: { select: { tag: true } },
  boar: { select: { tag: true } },
} satisfies Prisma.BreedingRecordInclude;
type Row = Prisma.BreedingRecordGetPayload<{ include: typeof include }>;

export interface BreedingItem {
  id: string;
  sowId: string;
  sowTag: string;
  /** Boar tag, or `IA {semence}`. */
  sire: string;
  method: Row['method'];
  boarId: string | null;
  semenLabel: string | null;
  serviceDate: string;
  expectedFarrowingDate: string;
  farrowingDate: string | null;
  bornTotal: number | null;
  bornAlive: number | null;
  stillborn: number | null;
  litterBatchId: string | null;
  weaningDate: string | null;
  weanedCount: number | null;
  failureDate: string | null;
  note: string | null;
  status: BreedingStatus;
  /** Expected farrowing − today while in gestation (negative when overdue), else null. */
  daysToFarrowing: number | null;
}

export const BREEDING_COLUMNS: ExportColumn<BreedingItem>[] = [
  { header: 'Truie', value: (b) => b.sowTag },
  { header: 'Verrat / IA', value: (b) => b.sire },
  { header: 'Date saillie', value: (b) => b.serviceDate },
  { header: 'Nés totaux', value: (b) => b.bornTotal },
  { header: 'Nés vivants', value: (b) => b.bornAlive },
  { header: 'Sevrés', value: (b) => b.weanedCount },
  { header: 'Statut', value: (b) => STATUS_LABEL[b.status] },
  { header: 'Mise bas prévue', value: (b) => b.expectedFarrowingDate },
];

const day = (d: Date | null) => (d ? formatDay(d) : null);

export function toItem(r: Row): BreedingItem {
  return {
    id: r.id,
    sowId: r.sowId,
    sowTag: r.sow.tag,
    sire: r.boar ? r.boar.tag : `IA ${r.semenLabel ?? ''}`.trim(),
    method: r.method,
    boarId: r.boarId,
    semenLabel: r.semenLabel,
    serviceDate: formatDay(r.serviceDate),
    expectedFarrowingDate: formatDay(r.expectedFarrowingDate),
    farrowingDate: day(r.farrowingDate),
    bornTotal: r.bornTotal,
    bornAlive: r.bornAlive,
    stillborn: r.stillborn,
    litterBatchId: r.litterBatchId,
    weaningDate: day(r.weaningDate),
    weanedCount: r.weanedCount,
    failureDate: day(r.failureDate),
    note: r.note,
    status: r.status,
    daysToFarrowing:
      r.status === 'GESTATION'
        ? Math.round(
            (r.expectedFarrowingDate.getTime() - today().getTime()) /
              MS_PER_DAY,
          )
        : null,
  };
}

const average = (values: number[]): number | null =>
  values.length === 0
    ? null
    : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

@Injectable()
export class BreedingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
  ) {}

  listArgs(ctx: RequestContext, q: BreedingListQueryDto) {
    if (q.status && !STATUSES.includes(q.status as BreedingStatus)) {
      throw new BadRequestException('Statut de saillie invalide');
    }
    const where: Prisma.BreedingRecordWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.status ? { status: q.status as BreedingStatus } : {}),
      ...(q.search ? { sow: { tag: containsInsensitive(q.search) } } : {}),
    };
    const order = orderBy(q, SORTABLE, { serviceDate: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.breedingRecord.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.breedingRecord.count({ where }),
    };
  }

  /** Per-status totals over the whole scope, whatever the search or page. */
  async statusCounts(
    ctx: RequestContext,
  ): Promise<Record<BreedingStatus, number>> {
    const groups = await this.prisma.breedingRecord.groupBy({
      by: ['status'],
      where: { farmId: { in: ctx.farmIds } },
      _count: { _all: true },
    });
    const counts: Record<BreedingStatus, number> = {
      GESTATION: 0,
      MISE_BAS: 0,
      SEVRAGE: 0,
      ECHEC: 0,
    };
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  /** The sow's records (newest service first) with the litter totals. */
  async history(ctx: RequestContext, animalId: string) {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId: { in: ctx.farmIds } },
      select: { id: true },
    });
    if (!animal) throw new NotFoundException('Animal introuvable');
    const rows = await this.prisma.breedingRecord.findMany({
      where: { sowId: animalId },
      include,
      orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }],
    });
    const records = rows.map(toItem);
    const litters = records.filter((r) => r.farrowingDate !== null);
    return {
      records,
      // Same list under the name the animal screen reads.
      items: records,
      totals: {
        litters: litters.length,
        averageBornAlive: average(litters.map((r) => r.bornAlive ?? 0)),
        averageWeaned: average(
          litters.flatMap((r) =>
            r.weanedCount === null ? [] : [r.weanedCount],
          ),
        ),
      },
    };
  }

  private async gestationDays(tx: Tx, organizationId: string): Promise<number> {
    const setting = await tx.setting.findUnique({
      where: { organizationId_key: { organizationId, key: 'gestationDays' } },
    });
    return typeof setting?.value === 'number'
      ? setting.value
      : DEFAULT_GESTATION_DAYS;
  }

  private expected(serviceDate: Date, days: number): Date {
    return new Date(serviceDate.getTime() + days * MS_PER_DAY);
  }

  /**
   * Locks a record's sow, then the record (the order every breeding transition
   * and the animal exit follow, so they cannot deadlock), and returns both
   * freshly read. 404 outside the caller's farms.
   */
  private async lockRecord(tx: Tx, ctx: RequestContext, id: string) {
    const pre = await tx.breedingRecord.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      select: { sowId: true },
    });
    if (!pre) throw new NotFoundException(NOT_FOUND);
    await tx.$queryRaw`SELECT id FROM "Animal" WHERE id = ${pre.sowId} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM "BreedingRecord" WHERE id = ${id} FOR NO KEY UPDATE`;
    const row = await tx.breedingRecord.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    const sow = await tx.animal.findUniqueOrThrow({ where: { id: row.sowId } });
    return { row, sow };
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    row: Pick<BreedingItem, 'id' | 'sowTag'>,
    before?: BreedingItem,
    after?: BreedingItem,
  ) {
    return this.audit.log(
      {
        ctx,
        module: 'reproduction',
        action,
        recordId: row.id,
        label: row.sowTag,
        before,
        after,
      },
      tx,
    );
  }

  /** Moves the sow from one status to another; a sow that is not in `from` is left alone (she may have left the herd). */
  private async moveSow(
    tx: Tx,
    sowId: string,
    from: 'ACTIF' | 'GESTANTE' | 'ALLAITANTE',
    data: Prisma.AnimalUpdateManyMutationInput,
  ): Promise<number> {
    const { count } = await tx.animal.updateMany({
      where: { id: sowId, status: from },
      data,
    });
    return count;
  }

  private async reload(tx: Tx, id: string): Promise<BreedingItem> {
    return toItem(
      await tx.breedingRecord.findUniqueOrThrow({ where: { id }, include }),
    );
  }

  create(ctx: RequestContext, dto: CreateBreedingDto): Promise<BreedingItem> {
    return this.prisma.$transaction(async (tx) => {
      const farmId = ctx.farmId;
      if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
      const serviceDate = requireDay(dto.serviceDate);
      assertNotFuture(serviceDate);
      if (dto.method === 'SAILLIE') {
        if (!dto.boarId) throw new BadRequestException('Le verrat est requis');
        if (dto.semenLabel) {
          throw new BadRequestException(
            "La semence ne s'applique qu'à l'insémination",
          );
        }
      } else {
        if (!dto.semenLabel) {
          throw new BadRequestException('La semence est requise');
        }
        if (dto.boarId) {
          throw new BadRequestException(
            "Le verrat ne s'applique qu'à la saillie",
          );
        }
      }
      await tx.$queryRaw`SELECT id FROM "Animal" WHERE id = ${dto.sowId} AND "farmId" = ${farmId} FOR NO KEY UPDATE`;
      const sow = await tx.animal.findFirst({
        where: { id: dto.sowId, farmId },
      });
      if (!sow) throw new BadRequestException('Truie invalide');
      if (sow.sex !== 'F') {
        throw new BadRequestException('Seule une femelle peut être saillie');
      }
      if (sow.status === 'GESTANTE' || sow.status === 'ALLAITANTE') {
        throw new ConflictException(
          'Cette truie est déjà gestante ou allaitante',
        );
      }
      if (sow.status !== 'ACTIF') throw new ConflictException(EXITED);
      if (sow.birthDate && serviceDate < sow.birthDate) {
        throw new BadRequestException(
          "La date est antérieure à la naissance de l'animal",
        );
      }
      if (dto.boarId) {
        const boar = await tx.animal.findFirst({
          where: { id: dto.boarId, farmId, sex: 'M', status: 'ACTIF' },
          select: { id: true },
        });
        if (!boar) {
          throw new BadRequestException(
            'Verrat invalide (un mâle actif de la ferme)',
          );
        }
      }
      const days = await this.gestationDays(tx, ctx.user.organizationId);
      const moved = await this.moveSow(tx, sow.id, 'ACTIF', {
        status: 'GESTANTE',
      });
      if (moved === 0) {
        throw new ConflictException(
          'Cette truie est déjà gestante ou allaitante',
        );
      }
      const created = await tx.breedingRecord.create({
        data: {
          farmId,
          sowId: sow.id,
          method: dto.method,
          boarId: dto.boarId,
          semenLabel: dto.semenLabel,
          serviceDate,
          expectedFarrowingDate: this.expected(serviceDate, days),
        },
        include,
      });
      const item = toItem(created);
      await this.log(tx, ctx, 'CREATE', item, undefined, item);
      return item;
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateBreedingDto,
  ): Promise<BreedingItem> {
    return this.prisma.$transaction(async (tx) => {
      const { row, sow } = await this.lockRecord(tx, ctx, id);
      if (row.status !== 'GESTATION') throw new ConflictException(NOT_PREGNANT);
      const serviceDate = requireDay(dto.serviceDate);
      assertNotFuture(serviceDate);
      if (sow.birthDate && serviceDate < sow.birthDate) {
        throw new BadRequestException(
          "La date est antérieure à la naissance de l'animal",
        );
      }
      const days = await this.gestationDays(tx, ctx.user.organizationId);
      await tx.breedingRecord.update({
        where: { id },
        data: {
          serviceDate,
          expectedFarrowingDate: this.expected(serviceDate, days),
        },
      });
      const before = toItem(row);
      const after = await this.reload(tx, id);
      await this.log(tx, ctx, 'UPDATE', after, before, after);
      return after;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const { row } = await this.lockRecord(tx, ctx, id);
      if (row.status !== 'GESTATION') throw new ConflictException(NOT_PREGNANT);
      await tx.breedingRecord.delete({ where: { id } });
      await this.moveSow(tx, row.sowId, 'GESTANTE', { status: 'ACTIF' });
      const item = toItem(row);
      await this.log(tx, ctx, 'DELETE', item, item);
    });
  }

  /** One transaction: the record, the sow (a cochette becomes a truie) and the piglet batch. */
  farrowing(
    ctx: RequestContext,
    id: string,
    dto: FarrowingDto,
  ): Promise<BreedingItem> {
    return this.prisma.$transaction(async (tx) => {
      const { row, sow } = await this.lockRecord(tx, ctx, id);
      if (row.status !== 'GESTATION') throw new ConflictException(STEP_DONE);
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (date < row.serviceDate) throw new BadRequestException(BEFORE_SERVICE);
      if (dto.bornAlive + dto.stillborn > dto.bornTotal) {
        throw new BadRequestException(
          'Nés vivants et mort-nés dépassent les nés totaux',
        );
      }
      if (dto.bornAlive > 0 && !dto.buildingId) {
        throw new BadRequestException('Le bâtiment de la portée est requis');
      }
      const moved = await this.moveSow(tx, sow.id, 'GESTANTE', {
        status: 'ALLAITANTE',
        ...(sow.category === 'COCHETTE' ? { category: 'TRUIE' } : {}),
      });
      if (moved === 0) throw new ConflictException(STEP_DONE);
      let litterBatchId: string | null = null;
      if (dto.bornAlive > 0) {
        const batch = await this.batches.create(
          ctx,
          {
            species: 'PORCIN',
            type: 'PORCELET',
            buildingId: dto.buildingId!,
            entryDate: dto.date,
            initialCount: dto.bornAlive,
          },
          tx,
          sow.id,
        );
        litterBatchId = batch.id;
      }
      const { count } = await tx.breedingRecord.updateMany({
        where: { id, status: 'GESTATION' },
        data: {
          status: 'MISE_BAS',
          farrowingDate: date,
          bornTotal: dto.bornTotal,
          bornAlive: dto.bornAlive,
          stillborn: dto.stillborn,
          litterBatchId,
        },
      });
      if (count === 0) throw new ConflictException(STEP_DONE);
      const after = await this.reload(tx, id);
      await this.log(tx, ctx, 'UPDATE', after, toItem(row), after);
      return after;
    });
  }

  /** Records the weaning; piglets of the litter not weaned are written off as deaths through the ledger. */
  weaning(
    ctx: RequestContext,
    id: string,
    dto: WeaningDto,
  ): Promise<BreedingItem> {
    return this.prisma.$transaction(async (tx) => {
      const { row } = await this.lockRecord(tx, ctx, id);
      if (row.status !== 'MISE_BAS') throw new ConflictException(STEP_DONE);
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (row.farrowingDate && date < row.farrowingDate) {
        throw new BadRequestException('La date est antérieure à la mise bas');
      }
      if (row.litterBatchId) {
        const alive =
          (await this.ledger.liveCounts([row.litterBatchId], date, tx)).get(
            row.litterBatchId,
          ) ?? 0;
        if (dto.weanedCount > alive) {
          throw new BadRequestException(
            `Les sevrés dépassent l'effectif de la portée (${alive})`,
          );
        }
        if (alive > dto.weanedCount) {
          await this.ledger.record(tx, {
            farmId: row.farmId,
            batchId: row.litterBatchId,
            date,
            type: 'MORTALITE',
            quantity: alive - dto.weanedCount,
            cause: 'Écart au sevrage',
            sourceType: 'BREEDING',
            sourceId: id,
            userId: ctx.user.id,
          });
        }
      } else if (dto.weanedCount > 0) {
        throw new BadRequestException(
          'Aucun porcelet né vivant : le nombre de sevrés doit être 0',
        );
      }
      const { count } = await tx.breedingRecord.updateMany({
        where: { id, status: 'MISE_BAS' },
        data: {
          status: 'SEVRAGE',
          weaningDate: date,
          weanedCount: dto.weanedCount,
        },
      });
      if (count === 0) throw new ConflictException(STEP_DONE);
      // A sow that died or left while nursing stays as she is.
      await this.moveSow(tx, row.sowId, 'ALLAITANTE', { status: 'ACTIF' });
      const after = await this.reload(tx, id);
      await this.log(tx, ctx, 'UPDATE', after, toItem(row), after);
      return after;
    });
  }

  fail(
    ctx: RequestContext,
    id: string,
    dto: FailBreedingDto,
  ): Promise<BreedingItem> {
    return this.prisma.$transaction(async (tx) => {
      const { row } = await this.lockRecord(tx, ctx, id);
      if (row.status !== 'GESTATION') throw new ConflictException(STEP_DONE);
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (date < row.serviceDate) throw new BadRequestException(BEFORE_SERVICE);
      const { count } = await tx.breedingRecord.updateMany({
        where: { id, status: 'GESTATION' },
        data: {
          status: 'ECHEC',
          failureDate: date,
          note: dto.note ?? row.note,
        },
      });
      if (count === 0) throw new ConflictException(STEP_DONE);
      await this.moveSow(tx, row.sowId, 'GESTANTE', { status: 'ACTIF' });
      const after = await this.reload(tx, id);
      await this.log(tx, ctx, 'UPDATE', after, toItem(row), after);
      return after;
    });
  }
}
