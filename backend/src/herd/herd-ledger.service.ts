import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AnimalBatch,
  BatchEvent,
  Prisma,
} from '../generated/prisma/client';
import type { BatchEventType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { assertNotFuture, BEFORE_ENTRY } from './days';
import { OccupationRegistry, OccupationSource } from './occupation';

type Tx = Prisma.TransactionClient;

export const BATCH_CLOSED = 'Ce lot est clôturé';
export const NOT_ENOUGH = 'Effectif insuffisant';
export const BATCH_NOT_FOUND = 'Lot introuvable';
export const PARTIAL_TRANSFER =
  'Transfert partiel non pris en charge : créez un nouveau lot';

/**
 * ENTREE is an additional delivery after the opening count (initialCount);
 * it adds to the live count like NAISSANCE.
 * +1 adds animals to the batch, -1 removes them. */
export const EVENT_SIGN: Record<BatchEventType, 1 | -1> = {
  ENTREE: 1,
  NAISSANCE: 1,
  TRANSFERT_ENTREE: 1,
  MORTALITE: -1,
  VENTE: -1,
  REFORME: -1,
  TRANSFERT_SORTIE: -1,
};

export interface LedgerEntry {
  id?: string;
  date: Date;
  createdAt: Date;
  type: BatchEventType;
  quantity: number;
}

/**
 * Replays a batch's history: the initial count opens the balance on
 * `entryDate`, events apply in (date, createdAt) order, and the balance may
 * never dip below zero. Throws the same 400s the routes return.
 */
export function assertLedgerValid(
  initialCount: number,
  entryDate: Date,
  events: LedgerEntry[],
): void {
  let balance = initialCount;
  const ordered = [...events].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id ?? '').localeCompare(b.id ?? ''),
  );
  for (const e of ordered) {
    if (e.date.getTime() < entryDate.getTime()) {
      throw new BadRequestException(BEFORE_ENTRY);
    }
    balance += EVENT_SIGN[e.type] * e.quantity;
    if (balance < 0) throw new BadRequestException(NOT_ENOUGH);
  }
}

export interface RecordInput {
  farmId: string;
  batchId: string;
  date: Date;
  type: BatchEventType;
  quantity: number;
  cause?: string | null;
  note?: string | null;
  relatedBatchId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  userId: string;
}

export interface EventPatch {
  date?: Date;
  type?: BatchEventType;
  quantity?: number;
  cause?: string | null;
  note?: string | null;
}

export interface TransferInput {
  farmId: string;
  fromBatchId: string;
  toBuildingId: string;
  date: Date;
  quantity: number;
  userId: string;
}

/**
 * The only writer of headcount changes. A batch's live count is never stored:
 * it is the initial count plus the signed sum of its events.
 */
@Injectable()
export class HerdLedgerService implements OccupationSource {
  constructor(
    private readonly prisma: PrismaService,
    registry: OccupationRegistry,
  ) {
    registry.register(this);
    this.registry = registry;
  }

  private readonly registry: OccupationRegistry;

  /**
   * Takes the row lock that serialises every change to one batch, then returns
   * it. `farmIds` scopes the lookup: a batch of another farm is a 404.
   */
  async lockBatch(
    tx: Tx,
    batchId: string,
    farmIds?: string[],
  ): Promise<AnimalBatch> {
    // NO KEY UPDATE serialises writers of one batch against each other but not
    // against the FOR KEY SHARE lock a referencing insert takes on this row,
    // so a caller that inserted a child row first cannot deadlock here.
    // The farm scope is part of the locking query: another farm's row is never locked.
    if (farmIds) {
      await tx.$queryRaw`SELECT id FROM "AnimalBatch" WHERE id = ${batchId} AND "farmId" = ANY(${farmIds}::text[]) FOR NO KEY UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM "AnimalBatch" WHERE id = ${batchId} FOR NO KEY UPDATE`;
    }
    const batch = await tx.animalBatch.findFirst({
      where: { id: batchId, ...(farmIds ? { farmId: { in: farmIds } } : {}) },
    });
    if (!batch) throw new NotFoundException(BATCH_NOT_FOUND);
    return batch;
  }

  /** Same lock on the building row, taken before an occupation check so two batches cannot overfill it together. */
  async lockBuilding(tx: Tx, buildingId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Building" WHERE id = ${buildingId} FOR NO KEY UPDATE`;
  }

  assertOpen(batch: Pick<AnimalBatch, 'status'>): void {
    if (batch.status === 'CLOTURE') throw new ConflictException(BATCH_CLOSED);
  }

  /** 400 when the building's total occupation (every source) exceeds its capacity. */
  async assertCapacity(
    tx: Tx,
    farmId: string,
    buildingId: string,
  ): Promise<void> {
    await this.lockBuilding(tx, buildingId);
    const building = await tx.building.findFirst({
      where: { id: buildingId, farmId },
      select: { capacity: true },
    });
    if (!building) {
      throw new BadRequestException('Bâtiment invalide pour cette ferme');
    }
    const occupation = (
      await this.registry.occupationByBuilding([farmId], [buildingId], tx)
    ).get(buildingId);
    if ((occupation ?? 0) > building.capacity) {
      throw new BadRequestException(
        `Capacité du bâtiment dépassée (${occupation} / ${building.capacity})`,
      );
    }
  }

  private async entries(
    tx: Tx,
    batchId: string,
    skipId?: string,
  ): Promise<LedgerEntry[]> {
    return tx.batchEvent.findMany({
      where: { batchId, ...(skipId ? { id: { not: skipId } } : {}) },
      select: {
        id: true,
        date: true,
        createdAt: true,
        type: true,
        quantity: true,
      },
    });
  }

  /** Re-checks a batch's whole history against (possibly new) opening values. */
  async assertConsistent(
    tx: Tx,
    batchId: string,
    initialCount: number,
    entryDate: Date,
  ): Promise<void> {
    assertLedgerValid(initialCount, entryDate, await this.entries(tx, batchId));
  }

  async record(tx: Tx, input: RecordInput): Promise<BatchEvent> {
    const batch = await this.lockBatch(tx, input.batchId, [input.farmId]);
    this.assertOpen(batch);
    assertNotFuture(input.date);
    const createdAt = new Date();
    assertLedgerValid(batch.initialCount, batch.entryDate, [
      ...(await this.entries(tx, batch.id)),
      {
        date: input.date,
        createdAt,
        type: input.type,
        quantity: input.quantity,
      },
    ]);
    const event = await tx.batchEvent.create({
      data: {
        farmId: batch.farmId,
        batchId: batch.id,
        date: input.date,
        type: input.type,
        quantity: input.quantity,
        cause: input.cause ?? null,
        note: input.note ?? null,
        relatedBatchId: input.relatedBatchId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        createdById: input.userId,
        createdAt,
      },
    });
    if (EVENT_SIGN[input.type] > 0) {
      await this.assertCapacity(tx, batch.farmId, batch.buildingId);
    }
    return event;
  }

  async update(
    tx: Tx,
    eventId: string,
    patch: EventPatch,
    farmIds?: string[],
  ): Promise<{ before: BatchEvent; after: BatchEvent }> {
    const found = await this.findEvent(tx, eventId, farmIds);
    const batch = await this.lockBatch(tx, found.batchId, farmIds);
    const before = await tx.batchEvent.findUnique({ where: { id: eventId } });
    if (!before) throw new NotFoundException('Événement introuvable');
    this.assertOpen(batch);
    const next = {
      date: patch.date ?? before.date,
      type: patch.type ?? before.type,
      quantity: patch.quantity ?? before.quantity,
    };
    assertNotFuture(next.date);
    assertLedgerValid(batch.initialCount, batch.entryDate, [
      ...(await this.entries(tx, batch.id, eventId)),
      { id: eventId, createdAt: before.createdAt, ...next },
    ]);
    const after = await tx.batchEvent.update({
      where: { id: eventId },
      data: {
        ...next,
        ...(patch.cause !== undefined ? { cause: patch.cause } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      },
    });
    const gain =
      EVENT_SIGN[next.type] * next.quantity -
      EVENT_SIGN[before.type] * before.quantity;
    if (gain > 0) {
      await this.assertCapacity(tx, batch.farmId, batch.buildingId);
    }
    return { before, after };
  }

  async remove(
    tx: Tx,
    eventId: string,
    farmIds?: string[],
  ): Promise<BatchEvent> {
    const found = await this.findEvent(tx, eventId, farmIds);
    const batch = await this.lockBatch(tx, found.batchId, farmIds);
    const event = await tx.batchEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Événement introuvable');
    this.assertOpen(batch);
    assertLedgerValid(
      batch.initialCount,
      batch.entryDate,
      await this.entries(tx, batch.id, eventId),
    );
    await tx.batchEvent.delete({ where: { id: eventId } });
    // Removing a death or a sale puts animals back in the building.
    if (EVENT_SIGN[event.type] < 0) {
      await this.assertCapacity(tx, batch.farmId, batch.buildingId);
    }
    return event;
  }

  private async findEvent(
    tx: Tx,
    eventId: string,
    farmIds?: string[],
  ): Promise<BatchEvent> {
    const event = await tx.batchEvent.findFirst({
      where: { id: eventId, ...(farmIds ? { farmId: { in: farmIds } } : {}) },
    });
    if (!event) throw new NotFoundException('Événement introuvable');
    return event;
  }

  /**
   * Moves a whole lot to another building. Splitting a lot is out of scope:
   * the quantity must equal the live count.
   */
  async transfer(
    tx: Tx,
    input: TransferInput,
  ): Promise<{ before: AnimalBatch; after: AnimalBatch }> {
    const batch = await this.lockBatch(tx, input.fromBatchId, [input.farmId]);
    this.assertOpen(batch);
    assertNotFuture(input.date);
    if (input.date.getTime() < batch.entryDate.getTime()) {
      throw new BadRequestException(BEFORE_ENTRY);
    }
    const target = await tx.building.findFirst({
      where: { id: input.toBuildingId, farmId: batch.farmId },
      select: { id: true },
    });
    if (!target) {
      throw new BadRequestException('Bâtiment invalide pour cette ferme');
    }
    if (target.id === batch.buildingId) {
      throw new BadRequestException('Le lot est déjà dans ce bâtiment');
    }
    const alive = (await this.liveCounts([batch.id], undefined, tx)).get(
      batch.id,
    );
    if (input.quantity > (alive ?? 0))
      throw new BadRequestException(NOT_ENOUGH);
    if (input.quantity !== alive) {
      throw new BadRequestException(PARTIAL_TRANSFER);
    }
    const after = await tx.animalBatch.update({
      where: { id: batch.id },
      data: { buildingId: target.id },
    });
    await this.assertCapacity(tx, batch.farmId, target.id);
    return { before: batch, after };
  }

  /** initialCount + events up to `at` (all of them by default); 0 before the entry date. */
  async liveCounts(
    batchIds: string[],
    at?: Date,
    client: Tx = this.prisma,
  ): Promise<Map<string, number>> {
    const result = new Map(batchIds.map((id) => [id, 0]));
    if (batchIds.length === 0) return result;
    const [batches, sums] = await Promise.all([
      client.animalBatch.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, initialCount: true, entryDate: true },
      }),
      client.batchEvent.groupBy({
        by: ['batchId', 'type'],
        where: {
          batchId: { in: batchIds },
          ...(at ? { date: { lte: at } } : {}),
        },
        _sum: { quantity: true },
      }),
    ]);
    const entered = new Set<string>();
    for (const b of batches) {
      if (!at || b.entryDate.getTime() <= at.getTime()) {
        result.set(b.id, b.initialCount);
        entered.add(b.id);
      }
    }
    for (const s of sums) {
      if (!entered.has(s.batchId)) continue;
      result.set(
        s.batchId,
        (result.get(s.batchId) ?? 0) +
          EVENT_SIGN[s.type] * (s._sum.quantity ?? 0),
      );
    }
    return result;
  }

  async deaths(
    batchIds: string[],
    client: Tx = this.prisma,
  ): Promise<Map<string, number>> {
    const result = new Map(batchIds.map((id) => [id, 0]));
    if (batchIds.length === 0) return result;
    const sums = await client.batchEvent.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, type: 'MORTALITE' },
      _sum: { quantity: true },
    });
    for (const s of sums) result.set(s.batchId, s._sum.quantity ?? 0);
    return result;
  }

  /** Live animals of the `EN_COURS` batches housed in each building. */
  async occupationByBuilding(
    farmIds: string[],
    buildingIds: string[],
    tx?: Tx,
  ): Promise<Map<string, number>> {
    const client = tx ?? this.prisma;
    const result = new Map(buildingIds.map((id) => [id, 0]));
    if (buildingIds.length === 0) return result;
    const batches = await client.animalBatch.findMany({
      where: {
        farmId: { in: farmIds },
        buildingId: { in: buildingIds },
        status: 'EN_COURS',
      },
      select: { id: true, buildingId: true },
    });
    const alive = await this.liveCounts(
      batches.map((b) => b.id),
      undefined,
      client,
    );
    for (const b of batches) {
      result.set(
        b.buildingId,
        (result.get(b.buildingId) ?? 0) + (alive.get(b.id) ?? 0),
      );
    }
    return result;
  }
}
