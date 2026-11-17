import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { lockRow } from '../common/lock-row';
import { BATCH_NOT_FOUND } from '../common/messages';
import { AuditService } from '../audit/audit.service';
import type {
  AnimalBatch,
  BatchEvent,
  Prisma,
} from '../generated/prisma/client';
import type { BatchEventType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { toEventItem } from './batch-event-item';
import { auditHerd } from './herd-audit';
import { assertBuildingFits } from './species';
import { assertNotFuture, BEFORE_ENTRY, formatDay } from '../common/days';
import { lowestBalance } from '../common/balance';
import { LitterWeaningRegistry } from './litter-weaning';
import { OccupationRegistry, OccupationSource } from './occupation';

type Tx = Prisma.TransactionClient;

export const BATCH_CLOSED = 'Ce lot est clôturé';
export const NOT_ENOUGH = 'Effectif insuffisant';
export { BATCH_NOT_FOUND };
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
  /**
   * When given, the ledger writes the event's audit row itself, in the same
   * transaction: every caller (the events route, weaning, later sales) then
   * audits the same way.
   */
  audit?: { ctx: RequestContext };
  /**
   * An event that adds animals checks its building's capacity (locking the
   * building) right after the write. A caller that records several events, or
   * holds other locks to take first (the sales module: lots -> animals ->
   * buildings ascending), passes `true` and calls `assertCapacities` itself,
   * once all its lot and animal locks are held. Never skip the check.
   */
  deferCapacity?: boolean;
}

/** Options of the removals and the other writes whose capacity check the caller may take over (see `RecordInput.deferCapacity`). */
export interface DeferCapacity {
  deferCapacity?: boolean;
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
    private readonly audit: AuditService,
    private readonly weanings: LitterWeaningRegistry,
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
    await lockRow(tx, 'AnimalBatch', batchId, farmIds);
    const batch = await tx.animalBatch.findFirst({
      where: { id: batchId, ...(farmIds ? { farmId: { in: farmIds } } : {}) },
    });
    if (!batch) throw new NotFoundException(BATCH_NOT_FOUND);
    return batch;
  }

  /**
   * Locks several batches, always in ascending id order whatever the order of
   * `batchIds`, so two transactions touching the same lots (an invoice with
   * several lots) cannot deadlock. Returns the rows in that order; a batch
   * outside `farmIds` (or missing) is a 404 and nothing stays locked.
   */
  async lockBatches(
    tx: Tx,
    batchIds: string[],
    farmIds?: string[],
  ): Promise<AnimalBatch[]> {
    const rows: AnimalBatch[] = [];
    for (const id of [...new Set(batchIds)].sort()) {
      rows.push(await this.lockBatch(tx, id, farmIds));
    }
    return rows;
  }

  /** Same lock on the building row, taken before an occupation check so two batches cannot overfill it together. */
  async lockBuilding(tx: Tx, buildingId: string): Promise<void> {
    await lockRow(tx, 'Building', buildingId);
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

  /**
   * `assertCapacity` for several buildings of one farm, always in ascending
   * id order (each building is locked, then checked, before the next): the one
   * way a path that holds several lots or animals may lock buildings, so two
   * of them cannot take the same buildings in opposite orders. Call it AFTER
   * every lot and animal lock of the path and BEFORE its stock-ledger call.
   */
  async assertCapacities(
    tx: Tx,
    farmId: string,
    buildingIds: string[],
  ): Promise<void> {
    for (const id of [...new Set(buildingIds)].sort()) {
      await this.assertCapacity(tx, farmId, id);
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

  /**
   * A weaned litter keeps the animals that were weaned: a change (a death, an
   * edit, a removal) may not lower the live count AT THE WEANING POSITION
   * below `min(weanedCount, that count before the change)`. The weaning sits
   * in its day like a ledger operation: events of earlier days count, and so
   * do same-day events created before it was recorded; a same-day event
   * created later (a sale or death after the weaning) does not. A same-day
   * event entered late cannot be told from a later one by its date alone: it
   * is allowed. A litter already out of step (data from before this rule) is
   * not frozen: only a change that makes it worse is refused. Called under the
   * batch lock with the history AFTER the change; a no-op for a batch that
   * cannot be a litter.
   */
  private async assertWeaned(
    tx: Tx,
    batch: AnimalBatch,
    after: LedgerEntry[],
  ): Promise<void> {
    if (batch.sourceType !== 'FARROWING') return;
    const weaning = await this.weanings.weaningOf(tx, batch.id);
    if (!weaning) return;
    const aliveAt = (events: LedgerEntry[]): number => {
      const day = weaning.date.getTime();
      let alive = batch.entryDate.getTime() <= day ? batch.initialCount : 0;
      for (const e of events) {
        const t = e.date.getTime();
        if (t < day || (t === day && e.createdAt < weaning.at)) {
          alive += EVENT_SIGN[e.type] * e.quantity;
        }
      }
      return alive;
    };
    const alive = aliveAt(after);
    if (
      alive < weaning.count &&
      alive < aliveAt(await this.entries(tx, batch.id))
    ) {
      throw new BadRequestException(
        `Cette portée a été sevrée : ${weaning.count} porcelets sevrés le ${formatDay(weaning.date)}`,
      );
    }
  }

  /**
   * Records one event. A SALE (`VENTE`, source `SALE`) does not check the
   * withdrawal period: the caller must call `WithdrawalRegistry.assertClear`
   * for the lot first (the sales module's `sale-effects` does).
   */
  async record(tx: Tx, input: RecordInput): Promise<BatchEvent> {
    const batch = await this.lockBatch(tx, input.batchId, [input.farmId]);
    this.assertOpen(batch);
    assertNotFuture(input.date);
    const createdAt = new Date();
    const history = [
      ...(await this.entries(tx, batch.id)),
      {
        date: input.date,
        createdAt,
        type: input.type,
        quantity: input.quantity,
      },
    ];
    assertLedgerValid(batch.initialCount, batch.entryDate, history);
    await this.assertWeaned(tx, batch, history);
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
    if (EVENT_SIGN[input.type] > 0 && !input.deferCapacity) {
      await this.assertCapacity(tx, batch.farmId, batch.buildingId);
    }
    if (input.audit) {
      await auditHerd(
        this.audit,
        tx,
        input.audit.ctx,
        batch.species,
        'CREATE',
        event.id,
        `${batch.code} · ${event.type} ${event.quantity}`,
        undefined,
        toEventItem(event),
      );
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
    const history = [
      ...(await this.entries(tx, batch.id, eventId)),
      { id: eventId, createdAt: before.createdAt, ...next },
    ];
    assertLedgerValid(batch.initialCount, batch.entryDate, history);
    await this.assertWeaned(tx, batch, history);
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
    const left = await this.entries(tx, batch.id, eventId);
    assertLedgerValid(batch.initialCount, batch.entryDate, left);
    await this.assertWeaned(tx, batch, left);
    await tx.batchEvent.delete({ where: { id: eventId } });
    // Removing a death or a sale puts animals back in the building.
    if (EVENT_SIGN[event.type] < 0) {
      await this.assertCapacity(tx, batch.farmId, batch.buildingId);
    }
    return event;
  }

  /**
   * Removes every event a later module wrote for one operation (a sale, a
   * treatment...), to reverse it. Each affected batch's history is replayed
   * without them first (400 when a later event would no longer fit; nothing is
   * removed then), batches are locked in id order, and a removal that puts
   * animals back is capacity-checked, the buildings in ascending id order
   * (`assertCapacities`) — unless `deferCapacity` says the caller does it,
   * after its own animal locks. Returns the removed events.
   */
  async removeBySource(
    tx: Tx,
    sourceType: string,
    sourceId: string,
    farmIds?: string[],
    opts: DeferCapacity = {},
  ): Promise<BatchEvent[]> {
    const events = await tx.batchEvent.findMany({
      where: {
        sourceType,
        sourceId,
        ...(farmIds ? { farmId: { in: farmIds } } : {}),
      },
    });
    if (events.length === 0) return [];
    const batches = await this.lockBatches(
      tx,
      events.map((e) => e.batchId),
      farmIds,
    );
    const removedIds = events.map((e) => e.id);
    for (const batch of batches) {
      this.assertOpen(batch);
      const left = await tx.batchEvent.findMany({
        where: { batchId: batch.id, id: { notIn: removedIds } },
        select: {
          id: true,
          date: true,
          createdAt: true,
          type: true,
          quantity: true,
        },
      });
      assertLedgerValid(batch.initialCount, batch.entryDate, left);
      await this.assertWeaned(tx, batch, left);
    }
    await tx.batchEvent.deleteMany({ where: { id: { in: removedIds } } });
    if (!opts.deferCapacity) {
      const byFarm = new Map<string, string[]>();
      for (const batch of batches) {
        if (
          events.some((e) => e.batchId === batch.id && EVENT_SIGN[e.type] < 0)
        ) {
          byFarm.set(batch.farmId, [
            ...(byFarm.get(batch.farmId) ?? []),
            batch.buildingId,
          ]);
        }
      }
      for (const [farmId, buildingIds] of byFarm) {
        await this.assertCapacities(tx, farmId, buildingIds);
      }
    }
    return events;
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
      select: { id: true, type: true },
    });
    if (!target) {
      throw new BadRequestException('Bâtiment invalide pour cette ferme');
    }
    assertBuildingFits(target, batch.species);
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

  /**
   * What a sale dated `date` may take from each batch: the live count on that
   * date, and no more than any later day can spare (a sale on `date` lowers
   * every later count too, in (date, createdAt) order: a lot of 40 with 30 sold
   * since has 10). Never negative; a fixed number of queries. A picker's
   * figure, not the ledger's rule: it ignores the weaned-litter floor
   * (`assertWeaned`: a litter weaned later cannot be sold below its weaned
   * count before the weaning), so it may list a quantity that the issue then
   * refuses with that message.
   */
  async availableAt(
    batchIds: string[],
    date: Date,
    client: Tx = this.prisma,
  ): Promise<Map<string, number>> {
    const alive = await this.liveCounts(batchIds, date, client);
    const later = batchIds.length
      ? await client.batchEvent.findMany({
          where: { batchId: { in: batchIds }, date: { gt: date } },
          select: {
            id: true,
            batchId: true,
            date: true,
            createdAt: true,
            type: true,
            quantity: true,
          },
        })
      : [];
    const byBatch = new Map<string, typeof later>();
    for (const e of later) {
      const list = byBatch.get(e.batchId) ?? [];
      list.push(e);
      byBatch.set(e.batchId, list);
    }
    const result = new Map<string, number>();
    for (const id of batchIds) {
      const deltas = (byBatch.get(id) ?? [])
        .sort(
          (a, b) =>
            a.date.getTime() - b.date.getTime() ||
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((e) => EVENT_SIGN[e.type] * e.quantity);
      result.set(
        id,
        Math.max(0, lowestBalance(alive.get(id) ?? 0, deltas).toNumber()),
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

  /**
   * `liveCounts` for many (batch, day) pairs at once: two queries whatever the
   * number of pairs. The answer for a pair is exactly `liveCounts([batchId],
   * date)`; it is keyed `${batchId}:${date.getTime()}`.
   */
  async liveCountsOnDays(
    pairs: { batchId: string; date: Date }[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (pairs.length === 0) return result;
    const ids = [...new Set(pairs.map((p) => p.batchId))];
    const last = Math.max(...pairs.map((p) => p.date.getTime()));
    const [batches, sums] = await Promise.all([
      this.prisma.animalBatch.findMany({
        where: { id: { in: ids } },
        select: { id: true, initialCount: true, entryDate: true },
      }),
      this.prisma.batchEvent.groupBy({
        by: ['batchId', 'date', 'type'],
        where: { batchId: { in: ids }, date: { lte: new Date(last) } },
        _sum: { quantity: true },
      }),
    ]);
    const batch = new Map(batches.map((b) => [b.id, b]));
    const events = new Map<string, { time: number; delta: number }[]>();
    for (const s of sums) {
      const list = events.get(s.batchId) ?? [];
      list.push({
        time: s.date.getTime(),
        delta: EVENT_SIGN[s.type] * (s._sum.quantity ?? 0),
      });
      events.set(s.batchId, list);
    }
    for (const { batchId, date } of pairs) {
      const key = `${batchId}:${date.getTime()}`;
      const b = batch.get(batchId);
      if (result.has(key)) continue;
      if (!b || b.entryDate.getTime() > date.getTime()) {
        result.set(key, 0);
        continue;
      }
      result.set(
        key,
        (events.get(batchId) ?? []).reduce(
          (n, e) => (e.time <= date.getTime() ? n + e.delta : n),
          b.initialCount,
        ),
      );
    }
    return result;
  }

  /**
   * What each batch's ledger recorded between two days (both inclusive), per
   * event type: every requested batch is present with all the types at 0. One
   * query.
   */
  async eventTotals(
    batchIds: string[],
    from: Date,
    to: Date,
    client: Tx = this.prisma,
  ): Promise<Map<string, Record<BatchEventType, number>>> {
    const zero = (): Record<BatchEventType, number> => ({
      ENTREE: 0,
      NAISSANCE: 0,
      MORTALITE: 0,
      VENTE: 0,
      TRANSFERT_SORTIE: 0,
      TRANSFERT_ENTREE: 0,
      REFORME: 0,
    });
    const result = new Map(batchIds.map((id) => [id, zero()]));
    if (batchIds.length === 0) return result;
    const sums = await client.batchEvent.groupBy({
      by: ['batchId', 'type'],
      where: { batchId: { in: batchIds }, date: { gte: from, lte: to } },
      _sum: { quantity: true },
    });
    for (const s of sums) {
      const totals = result.get(s.batchId);
      if (totals) totals[s.type] = s._sum.quantity ?? 0;
    }
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
