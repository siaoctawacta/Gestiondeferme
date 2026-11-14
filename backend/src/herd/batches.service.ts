import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type {
  BatchStatus,
  BatchType,
  Species,
} from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { mortalityRate } from '../indicators/indicators';
import { nextBatchCode } from './batch-code';
import {
  assertNotFuture,
  BEFORE_ENTRY,
  daysBetween,
  formatDay,
  requireDay,
  today,
} from './days';
import type {
  BatchListQueryDto,
  CreateBatchDto,
  UpdateBatchDto,
} from './dto/batch.dto';
import { auditHerd } from './herd-audit';
import {
  BATCH_CLOSED,
  BATCH_NOT_FOUND,
  HerdLedgerService,
} from './herd-ledger.service';
import { TYPES_BY_SPECIES } from './species';

type Tx = Prisma.TransactionClient;

const include = {
  breed: { select: { name: true } },
  building: { select: { name: true } },
} satisfies Prisma.AnimalBatchInclude;

type BatchRow = Prisma.AnimalBatchGetPayload<{ include: typeof include }>;

export interface BatchItem {
  id: string;
  code: string;
  species: Species;
  type: BatchType;
  breedId: string | null;
  breedName: string | null;
  buildingId: string;
  buildingName: string;
  entryDate: string;
  initialCount: number;
  deaths: number;
  alive: number;
  /** deaths / initialCount × 100, one decimal. */
  mortalityRate: number | null;
  /** Average of the latest weighing, in grams. */
  averageWeightG: number | null;
  status: BatchStatus;
  closedAt: string | null;
  ageDays: number;
  supplierName: string | null;
  purchasePrice: number | null;
  responsibleId: string | null;
  motherAnimalId: string | null;
  notes: string | null;
}

const TYPE_LABEL: Record<BatchType, string> = {
  CHAIR: 'Chair',
  PONDEUSE: 'Pondeuse',
  POUSSIN: 'Poussin',
  REPRODUCTEUR: 'Reproducteur',
  PORCELET: 'Porcelet',
  ENGRAISSEMENT: 'Engraissement',
};
const STATUS_LABEL: Record<BatchStatus, string> = {
  EN_COURS: 'En cours',
  CLOTURE: 'Clôturé',
};

export const BATCH_COLUMNS: ExportColumn<BatchItem>[] = [
  { header: 'Code lot', value: (b) => b.code },
  { header: 'Type', value: (b) => TYPE_LABEL[b.type] },
  { header: 'Souche', value: (b) => b.breedName },
  { header: 'Bâtiment', value: (b) => b.buildingName },
  { header: "Date d'entrée", value: (b) => b.entryDate },
  { header: 'Effectif initial', value: (b) => b.initialCount },
  { header: 'Mortalité cumulée', value: (b) => b.deaths },
  { header: 'Poids moyen (g)', value: (b) => b.averageWeightG },
  { header: 'Statut', value: (b) => STATUS_LABEL[b.status] },
  { header: 'Vivants', value: (b) => b.alive },
  { header: 'Mortalité', value: (b) => b.mortalityRate },
];

const SORTABLE = ['code', 'entryDate', 'initialCount', 'status', 'createdAt'];
const HISTORY = 'Ce lot a un historique ; clôturez-le plutôt';

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext): Prisma.AnimalBatchWhereInput {
    return { farmId: { in: ctx.farmIds } };
  }

  async toItems(
    rows: BatchRow[],
    client: Tx = this.prisma,
  ): Promise<BatchItem[]> {
    const ids = rows.map((r) => r.id);
    const [alive, deaths, weighings] = await Promise.all([
      this.ledger.liveCounts(ids, undefined, client),
      this.ledger.deaths(ids, client),
      client.weighing.findMany({
        where: { batchId: { in: ids } },
        orderBy: [{ batchId: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }],
        distinct: ['batchId'],
        select: { batchId: true, averageWeightG: true },
      }),
    ]);
    const weight = new Map(weighings.map((w) => [w.batchId, w.averageWeightG]));
    return rows.map((r) => {
      const dead = deaths.get(r.id) ?? 0;
      return {
        id: r.id,
        code: r.code,
        species: r.species,
        type: r.type,
        breedId: r.breedId,
        breedName: r.breed?.name ?? null,
        buildingId: r.buildingId,
        buildingName: r.building.name,
        entryDate: formatDay(r.entryDate),
        initialCount: r.initialCount,
        deaths: dead,
        alive: alive.get(r.id) ?? 0,
        mortalityRate: mortalityRate(dead, r.initialCount),
        averageWeightG: weight.get(r.id) ?? null,
        status: r.status,
        closedAt: r.closedAt ? formatDay(r.closedAt) : null,
        ageDays: daysBetween(
          r.entryDate,
          r.closedAt ? today(r.closedAt) : undefined,
        ),
        supplierName: r.supplierName,
        purchasePrice: r.purchasePrice ? r.purchasePrice.toNumber() : null,
        responsibleId: r.responsibleId,
        motherAnimalId: r.motherAnimalId,
        notes: r.notes,
      };
    });
  }

  listArgs(ctx: RequestContext, q: BatchListQueryDto) {
    if (q.status && !Object.hasOwn(STATUS_LABEL, q.status)) {
      throw new BadRequestException('Statut de lot invalide');
    }
    if (q.type && !TYPES_BY_SPECIES[q.species].includes(q.type)) {
      throw new BadRequestException('Type de lot invalide pour cette espèce');
    }
    const where: Prisma.AnimalBatchWhereInput = {
      AND: [
        this.scope(ctx),
        { species: q.species },
        q.status ? { status: q.status as BatchStatus } : {},
        q.type ? { type: q.type } : {},
        q.search
          ? {
              OR: [
                { code: containsInsensitive(q.search) },
                { breed: { name: containsInsensitive(q.search) } },
                { building: { name: containsInsensitive(q.search) } },
              ],
            }
          : {},
      ],
    };
    const order = orderBy(q, SORTABLE, { entryDate: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        this.toItems(
          await this.prisma.animalBatch.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          }),
        ),
      count: () => this.prisma.animalBatch.count({ where }),
    };
  }

  /** Per-status totals over the species' whole scope, whatever the search, type or page. */
  async statusCounts(
    ctx: RequestContext,
    species: Species,
  ): Promise<Record<BatchStatus, number>> {
    const groups = await this.prisma.animalBatch.groupBy({
      by: ['status'],
      where: { ...this.scope(ctx), species },
      _count: { _all: true },
    });
    const counts: Record<BatchStatus, number> = { EN_COURS: 0, CLOTURE: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  /** The batch's species, for the controller's permission check (404 when out of scope). */
  async speciesOf(ctx: RequestContext, id: string): Promise<Species> {
    const batch = await this.prisma.animalBatch.findFirst({
      where: { id, ...this.scope(ctx) },
      select: { species: true },
    });
    if (!batch) throw new NotFoundException(BATCH_NOT_FOUND);
    return batch.species;
  }

  private async load(ctx: RequestContext, id: string): Promise<BatchRow> {
    const batch = await this.prisma.animalBatch.findFirst({
      where: { id, ...this.scope(ctx) },
      include,
    });
    if (!batch) throw new NotFoundException(BATCH_NOT_FOUND);
    return batch;
  }

  async get(ctx: RequestContext, id: string): Promise<BatchItem> {
    return (await this.toItems([await this.load(ctx, id)]))[0];
  }

  /** Breed of the user's organisation and the batch's species; responsible user of the same organisation. */
  private async assertRefs(
    tx: Tx,
    ctx: RequestContext,
    species: Species,
    refs: { breedId?: string | null; responsibleId?: string | null },
  ): Promise<void> {
    if (refs.breedId) {
      const breed = await tx.breed.findFirst({
        where: {
          id: refs.breedId,
          organizationId: ctx.user.organizationId,
          species,
        },
        select: { id: true },
      });
      if (!breed) throw new BadRequestException('Souche invalide');
    }
    if (refs.responsibleId) {
      const user = await tx.user.findFirst({
        where: {
          id: refs.responsibleId,
          organizationId: ctx.user.organizationId,
        },
        select: { id: true },
      });
      if (!user) throw new BadRequestException('Responsable invalide');
    }
  }

  /**
   * Creates a batch. Pass `opts.tx` to create it inside the caller's transaction
   * (hatching, farrowing): then the audit row and the capacity check share it.
   * `opts.motherAnimalId` (the sow of a farrowing) is not part of the public body.
   */
  create(
    ctx: RequestContext,
    dto: CreateBatchDto,
    opts: { tx?: Tx; motherAnimalId?: string } = {},
  ): Promise<BatchItem> {
    const { tx, motherAnimalId } = opts;
    if (tx) return this.createIn(tx, ctx, dto, motherAnimalId);
    return this.prisma.$transaction((t) =>
      this.createIn(t, ctx, dto, motherAnimalId),
    );
  }

  private async createIn(
    tx: Tx,
    ctx: RequestContext,
    dto: CreateBatchDto,
    motherAnimalId?: string,
  ): Promise<BatchItem> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
    if (!TYPES_BY_SPECIES[dto.species].includes(dto.type)) {
      throw new BadRequestException('Type de lot invalide pour cette espèce');
    }
    const entryDate = requireDay(dto.entryDate);
    assertNotFuture(entryDate);
    const building = await tx.building.findFirst({
      where: { id: dto.buildingId, farmId },
      select: { id: true },
    });
    if (!building) {
      throw new BadRequestException('Bâtiment invalide pour cette ferme');
    }
    await this.assertRefs(tx, ctx, dto.species, dto);
    const code =
      dto.code ?? (await nextBatchCode(tx, farmId, dto.type, entryDate));
    const created = await orConflict(
      () =>
        tx.animalBatch.create({
          data: {
            farmId,
            code,
            species: dto.species,
            type: dto.type,
            breedId: dto.breedId,
            buildingId: dto.buildingId,
            entryDate,
            initialCount: dto.initialCount,
            supplierName: dto.supplierName,
            purchasePrice: dto.purchasePrice,
            responsibleId: dto.responsibleId,
            motherAnimalId,
            notes: dto.notes,
          },
          include,
        }),
      'Ce code de lot existe déjà',
    );
    await this.ledger.assertCapacity(tx, farmId, created.buildingId);
    const [item] = await this.toItems([created], tx);
    await auditHerd(
      this.audit,
      tx,
      ctx,
      created.species,
      'CREATE',
      created.id,
      created.code,
      undefined,
      item,
    );
    return item;
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateBatchDto,
  ): Promise<BatchItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, id, ctx.farmIds);
      this.ledger.assertOpen(batch);
      const before = (await this.toItems([await this.rowOf(tx, id)], tx))[0];
      if (dto.buildingId !== undefined && dto.buildingId !== batch.buildingId) {
        throw new BadRequestException(
          'Utilisez le transfert pour changer de bâtiment',
        );
      }
      const entryDate = dto.entryDate
        ? requireDay(dto.entryDate)
        : batch.entryDate;
      if (dto.entryDate) assertNotFuture(entryDate);
      const initialCount = dto.initialCount ?? batch.initialCount;
      if (
        entryDate.getTime() !== batch.entryDate.getTime() ||
        initialCount !== batch.initialCount
      ) {
        await this.ledger.assertConsistent(tx, id, initialCount, entryDate);
        const early = await tx.weighing.count({
          where: { batchId: id, date: { lt: entryDate } },
        });
        if (early > 0) throw new BadRequestException(BEFORE_ENTRY);
      }
      await this.assertRefs(tx, ctx, batch.species, dto);
      const updated = await tx.animalBatch.update({
        where: { id },
        data: {
          entryDate,
          initialCount,
          breedId: dto.breedId,
          supplierName: dto.supplierName,
          purchasePrice: dto.purchasePrice,
          responsibleId: dto.responsibleId,
          notes: dto.notes,
        },
        include,
      });
      if (initialCount > batch.initialCount) {
        await this.ledger.assertCapacity(tx, batch.farmId, batch.buildingId);
      }
      const [after] = await this.toItems([updated], tx);
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'UPDATE',
        id,
        batch.code,
        before,
        after,
      );
      return after;
    });
  }

  private async rowOf(tx: Tx, id: string): Promise<BatchRow> {
    return tx.animalBatch.findUniqueOrThrow({ where: { id }, include });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const batch = await this.ledger.lockBatch(tx, id, ctx.farmIds);
        const [events, related, weighings] = await Promise.all([
          tx.batchEvent.count({ where: { batchId: id } }),
          tx.batchEvent.count({ where: { relatedBatchId: id } }),
          tx.weighing.count({ where: { batchId: id } }),
        ]);
        if (events + related + weighings > 0) {
          throw new ConflictException(HISTORY);
        }
        const before = (await this.toItems([await this.rowOf(tx, id)], tx))[0];
        await tx.animalBatch.delete({ where: { id } });
        await auditHerd(
          this.audit,
          tx,
          ctx,
          batch.species,
          'DELETE',
          id,
          batch.code,
          before,
        );
      });
    } catch (error) {
      // A record of a later module (feed, health...) still points at the batch.
      if ((error as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(HISTORY);
      }
      throw error;
    }
  }

  async close(ctx: RequestContext, id: string): Promise<BatchItem> {
    return this.setStatus(ctx, id, 'CLOTURE');
  }

  async reopen(ctx: RequestContext, id: string): Promise<BatchItem> {
    return this.setStatus(ctx, id, 'EN_COURS');
  }

  private setStatus(
    ctx: RequestContext,
    id: string,
    status: BatchStatus,
  ): Promise<BatchItem> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ledger.lockBatch(tx, id, ctx.farmIds);
      if (status === 'CLOTURE') {
        if (batch.status === 'CLOTURE') {
          throw new ConflictException(BATCH_CLOSED);
        }
      } else if (batch.status === 'EN_COURS') {
        throw new ConflictException("Ce lot n'est pas clôturé");
      }
      const before = (await this.toItems([await this.rowOf(tx, id)], tx))[0];
      const updated = await tx.animalBatch.update({
        where: { id },
        data: { status, closedAt: status === 'CLOTURE' ? new Date() : null },
        include,
      });
      // A reopened lot houses its animals again.
      if (status === 'EN_COURS') {
        await this.ledger.assertCapacity(tx, batch.farmId, batch.buildingId);
      }
      const [after] = await this.toItems([updated], tx);
      await auditHerd(
        this.audit,
        tx,
        ctx,
        batch.species,
        'UPDATE',
        id,
        batch.code,
        before,
        after,
      );
      return after;
    });
  }
}
