import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { addDays, assertNotFuture, formatDay, today } from '../common/days';
import { lockRow } from '../common/lock-row';
import { Prisma } from '../generated/prisma/client';
import type {
  StockBatch,
  StockItem,
  StockMovement,
} from '../generated/prisma/client';
import type {
  AuditAction,
  StockMovementType,
  StockReason,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  allocateExit,
  AllocationError,
  headrooms,
  type Piece,
} from './allocation';
import {
  assertBucketsNonNegative,
  INSUFFICIENT,
  replay,
  type ReplayMovement,
} from './valuation';

type Tx = Prisma.TransactionClient;
type Dec = Prisma.Decimal;
type Num = number | string | Dec;

const D = (v: Num): Dec => new Prisma.Decimal(v);
const ZERO = D(0);

const EXPIRED_BATCH = 'Lot périmé';
const PARTLY_EXPIRED = 'Stock insuffisant (une partie du stock est périmée)';
const INVALID_ITEM = 'Article invalide pour cette ferme';
export const INVALID_BATCH = 'Lot invalide pour cet article';
export const MOVEMENT_NOT_FOUND = 'Mouvement introuvable';

/** Reasons that consume stock for production (the daily consumption, alerts). */
const CONSUMPTION_REASONS: StockReason[] = ['CONSOMMATION', 'TRAITEMENT'];

/**
 * The expiry rule per reason: an exit for one of these may not draw on an
 * expired lot (`Lot périmé`), because the goods leave to be used or sold.
 * Every other reason (a loss, a count, a correction) may take expired stock
 * out of the books.
 */
const REFUSES_EXPIRED_LOTS: StockReason[] = [...CONSUMPTION_REASONS, 'VENTE'];

/** The operations that write ledger movements (`sourceType`); each task that adds one adds it here. */
export const STOCK_SOURCES = [
  'INVENTORY',
  'FEED_DISTRIBUTION',
  'HEALTH_ACT',
  'PURCHASE',
  'SALE',
  'CREDIT_NOTE',
] as const;
export type StockSourceType = (typeof STOCK_SOURCES)[number];

export const levelKey = (farmId: string, stockItemId: string): string =>
  `${farmId}:${stockItemId}`;

export interface RecordInput {
  farmId: string;
  stockItemId: string;
  date: Date;
  type: StockMovementType;
  /** Signed: positive in, negative out. */
  quantity: Num;
  /**
   * Required on an `ENTREE`. On a positive `AJUSTEMENT`, left out it means "at
   * the running average". Ignored on exits: they are valued at the average.
   */
  unitCost?: Num | null;
  reason: StockReason;
  stockBatchId?: string | null;
  sourceType?: StockSourceType | null;
  sourceId?: string | null;
  note?: string | null;
  userId: string;
  /**
   * When given, the ledger writes this input's audit row itself, in the same
   * transaction: one row per input, whatever the number of movements (pieces)
   * it ends up as.
   */
  audit?: { ctx: RequestContext };
}

export interface RecordResult {
  /** One per batch the stock was taken from (several when FEFO splits an exit; they share `operationId`). */
  movements: StockMovement[];
  /** The cost per unit: the running average for an exit (the same on every part), the given cost for an entry. */
  unitCost: Dec;
  /** `Σ |quantity| × unitCost`, 2 decimals. */
  cost: Dec;
}

export interface MovementPatch {
  date?: Date;
  /** Signed, same sign as the movement; for an exit, the quantity of the whole operation (all its pieces). */
  quantity?: Num;
  /** Entries only. */
  unitCost?: Num;
  note?: string | null;
  /** On the batch of an entry. */
  lotNumber?: string | null;
  expiryDate?: Date | null;
}

export interface StockLevel {
  quantity: Dec;
  averageCost: Dec;
  /** `quantity × averageCost`, 2 decimals. */
  value: Dec;
}

export interface BatchLevel {
  batch: StockBatch;
  quantity: Dec;
}

export interface NewBatch {
  farmId: string;
  stockItemId: string;
  lotNumber?: string | null;
  expiryDate?: Date | null;
  receivedDate: Date;
}

interface Pair {
  farmId: string;
  stockItemId: string;
}

/** A movement of one (farm, item) history, as the ledger holds it while it validates a change. */
interface Work extends ReplayMovement {
  id: string;
  farmId: string;
  stockItemId: string;
  stockBatchId: string | null;
  reason: StockReason;
  sourceType: string | null;
  sourceId: string | null;
  operationId: string;
  lotExplicit: boolean;
  note: string | null;
  createdById: string;
  fresh: boolean;
  removed: boolean;
  /** Where the row sat in the history when it was loaded (null for a new row). */
  origin: { date: Date; createdAt: Date } | null;
  /** The cost in the database, to write only what changed. */
  storedCost: Dec | null;
  patch: Prisma.StockMovementUncheckedUpdateInput;
}

interface State {
  pair: Pair;
  item: StockItem;
  rows: Work[];
  batches: Map<string, StockBatch>;
  /** Changes to write to batches (applied in memory to `batches` too, so validation sees them). */
  batchPatches: Map<string, Prisma.StockBatchUpdateInput>;
  /** Lots whose expiry this operation changes: the consumptions drawn from them are re-checked. */
  expiryChanged: Set<string>;
  /** Creation time of the next new movement: after everything already written. */
  next: number;
  /**
   * The latest validated inventory of this pair: the history before it is
   * closed. `at` is when it was validated: on the count day, a movement created
   * before that moment was part of what was counted, one created after is not.
   */
  count: { date: Date; at: Date } | null;
}

type AddBase = Pick<
  Work,
  | 'date'
  | 'type'
  | 'reason'
  | 'sourceType'
  | 'sourceId'
  | 'operationId'
  | 'lotExplicit'
  | 'note'
  | 'createdById'
  | 'unitCost'
> & { createdAt?: Date };

const isEntry = (m: { quantity: Dec }): boolean => m.quantity.gt(0);

/**
 * The only writer of stock movements. A quantity is never stored: it is the
 * signed sum of a (farm, item)'s movements, replayed in (date, createdAt, id)
 * order so the weighted-average cost, the cost of every exit and the "never
 * below zero" rule hold at every point of the history, whatever is inserted,
 * edited or removed. Every change locks the (farm, item) rows first, in
 * ascending item order, validates the resulting history of EVERY affected
 * (farm, item), and only then writes.
 *
 * Write interface for the modules that own an operation (purchase, feed
 * distribution, health act, inventory), one transaction each:
 * - create: `record` / `recordMany` (one call for all the lines);
 * - edit: `replaceBySource` (never `reverseBySource` then `record`);
 * - delete: `reverseBySource`.
 * Never chain two ledger calls that touch different items in one transaction:
 * the locks of each call are ordered only within the call, so two such
 * transactions could deadlock. `replaceBySource` and `reverseBySource` read the
 * source's movements BEFORE taking the stock locks: the owning module must
 * first lock its own source row (the distribution, the purchase...) so two
 * edits of one source cannot interleave.
 */
@Injectable()
export class StockLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- writes

  async record(tx: Tx, input: RecordInput): Promise<RecordResult> {
    return (await this.recordMany(tx, [input]))[0];
  }

  /**
   * Records several movements as one operation (the ingredients of a formula,
   * the lines of a reception): every involved (farm, item) is locked first, in
   * ascending item order, every resulting history is validated, then either
   * every input is written or none. Results line up with `inputs`.
   */
  async recordMany(tx: Tx, inputs: RecordInput[]): Promise<RecordResult[]> {
    const normalised = inputs.map((i) => this.normalise(i));
    const states = await this.lockAndLoad(
      tx,
      normalised.map((i) => i.pair),
    );
    const planned = normalised.map((input) => ({
      input,
      rows: this.plan(states.get(pairKey(input.pair))!, input),
    }));
    const created = await this.commit(tx, states);
    return this.results(tx, states, planned, created);
  }

  /**
   * Edits an operation: replaces everything `sourceType`/`sourceId` wrote with
   * `inputs` (which get that source), under ONE set of locks (the union of the
   * old and new items, in ascending order) and one validation. A source owner
   * calls this on edit instead of reversing then recording; it audits itself.
   * Nothing is written when a resulting history is refused. Results line up
   * with `inputs`.
   */
  async replaceBySource(
    tx: Tx,
    sourceType: StockSourceType,
    sourceId: string,
    inputs: Omit<RecordInput, 'sourceType' | 'sourceId' | 'audit'>[],
    farmIds?: string[],
  ): Promise<RecordResult[]> {
    const old = await tx.stockMovement.findMany({
      where: {
        sourceType,
        sourceId,
        ...(farmIds ? { farmId: { in: farmIds } } : {}),
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const normalised = inputs.map((i) =>
      this.normalise({ ...i, sourceType, sourceId }),
    );
    const states = await this.lockAndLoad(tx, [
      ...old,
      ...normalised.map((i) => i.pair),
    ]);
    const oldIds = new Set(old.map((m) => m.id));
    const oldRows: Work[] = [];
    for (const state of states.values()) {
      for (const row of state.rows) {
        if (oldIds.has(row.id)) {
          row.removed = true;
          oldRows.push(row);
        }
      }
    }
    // An input that finds an old operation of the same article, direction and
    // date takes it over: its rows keep their place in the day and their ids.
    const operations = new Map<string, Work[]>();
    for (const row of oldRows) {
      operations.set(row.operationId, [
        ...(operations.get(row.operationId) ?? []),
        row,
      ]);
    }
    const planned = normalised.map((input) => {
      const state = states.get(pairKey(input.pair))!;
      let claimed: Work[] = [];
      for (const [id, rows] of operations) {
        const head = rows[0];
        if (
          pairKey(head) === pairKey(input.pair) &&
          head.type === input.raw.type &&
          head.quantity.gt(0) === input.quantity.gt(0) &&
          head.date.getTime() === input.raw.date.getTime()
        ) {
          claimed = rows;
          operations.delete(id);
          break;
        }
      }
      return { input, rows: this.plan(state, input, claimed) };
    });
    const created = await this.commit(tx, states);
    return this.results(tx, states, planned, created);
  }

  /** A lot received; its quantity is the sum of the movements that carry it. */
  async createBatch(tx: Tx, batch: NewBatch): Promise<StockBatch> {
    await this.assertItem(tx, batch.farmId, batch.stockItemId);
    assertExpiryAfterReception(batch.expiryDate ?? null, batch.receivedDate);
    return tx.stockBatch.create({
      data: {
        farmId: batch.farmId,
        stockItemId: batch.stockItemId,
        lotNumber: batch.lotNumber ?? null,
        expiryDate: batch.expiryDate ?? null,
        receivedDate: batch.receivedDate,
      },
    });
  }

  /**
   * Edits a hand-entered operation. An entry changes its own row (and its
   * lot). An exit is re-planned as a whole under one lock: its pieces are
   * dropped and its quantity (the whole operation's, signed) is allocated
   * again from the lots as of the new date: FEFO is re-run, except for an exit
   * that named its lot (`lotExplicit`), which stays strictly on that lot. A
   * bigger quantity can therefore draw on other lots. The operation keeps its
   * `operationId`.
   */
  async update(
    tx: Tx,
    movementId: string,
    patch: MovementPatch,
    farmIds?: string[],
    audit?: { ctx: RequestContext },
  ): Promise<{ before: StockMovement[]; after: StockMovement[] }> {
    const { state, rows } = await this.lockOperation(tx, movementId, farmIds);
    const before = await tx.stockMovement.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const first = rows[0];
    const entering = isEntry(first);
    if (patch.date) assertNotFuture(patch.date);

    if (patch.note !== undefined) {
      for (const r of rows) r.patch.note = patch.note;
    }
    if (entering) {
      const row = first;
      if (patch.date) {
        row.date = patch.date;
        row.patch.date = patch.date;
      }
      if (patch.quantity !== undefined) {
        const quantity = D(patch.quantity);
        assertSign(row.type, quantity);
        if (quantity.isNeg()) {
          throw new BadRequestException(
            'Le sens du mouvement ne peut pas changer',
          );
        }
        row.quantity = quantity;
        row.patch.quantity = quantity;
      }
      if (patch.unitCost !== undefined) {
        row.unitCost = checkedCost(patch.unitCost);
        row.patch.unitCost = row.unitCost;
      }
      const touchesLot =
        patch.lotNumber !== undefined || patch.expiryDate !== undefined;
      const batch = row.stockBatchId
        ? state.batches.get(row.stockBatchId)
        : undefined;
      if (touchesLot && !batch) {
        throw new BadRequestException(
          'Seule l’entrée d’un lot peut changer son numéro ou sa péremption',
        );
      }
      if (batch && (touchesLot || patch.date)) {
        const next: StockBatch = {
          ...batch,
          ...(patch.lotNumber !== undefined
            ? { lotNumber: patch.lotNumber }
            : {}),
          ...(patch.expiryDate !== undefined
            ? { expiryDate: patch.expiryDate }
            : {}),
          ...(patch.date ? { receivedDate: patch.date } : {}),
        };
        assertExpiryAfterReception(next.expiryDate, next.receivedDate);
        if (patch.expiryDate !== undefined) state.expiryChanged.add(batch.id);
        state.batches.set(batch.id, next);
        state.batchPatches.set(batch.id, {
          lotNumber: next.lotNumber,
          expiryDate: next.expiryDate,
          receivedDate: next.receivedDate,
        });
      }
    } else {
      if (patch.unitCost !== undefined) {
        throw new BadRequestException(
          'Le coût d’une sortie est calculé automatiquement',
        );
      }
      if (patch.lotNumber !== undefined || patch.expiryDate !== undefined) {
        throw new BadRequestException(
          'Seule l’entrée d’un lot peut changer son numéro ou sa péremption',
        );
      }
      if (patch.quantity !== undefined || patch.date) {
        const total = rows.reduce((s, r) => s.add(r.quantity), ZERO);
        const wanted = patch.quantity !== undefined ? D(patch.quantity) : total;
        assertSign(first.type, wanted);
        if (wanted.gt(0)) {
          throw new BadRequestException(
            'Le sens du mouvement ne peut pas changer',
          );
        }
        for (const r of rows) r.removed = true;
        const date = patch.date ?? first.date;
        // A lot asked for explicitly stays the only lot; FEFO is run again otherwise.
        const pieces = this.exitPieces(state, {
          date,
          needed: wanted.abs(),
          reason: first.reason,
          batchId: first.lotExplicit ? first.stockBatchId : null,
          anchor:
            date.getTime() === first.date.getTime()
              ? first.createdAt
              : undefined,
        });
        this.place(
          state,
          pieces,
          {
            date,
            type: first.type,
            reason: first.reason,
            sourceType: first.sourceType,
            sourceId: first.sourceId,
            operationId: first.operationId,
            lotExplicit: first.lotExplicit,
            note: patch.note !== undefined ? patch.note : first.note,
            createdById: first.createdById,
            unitCost: null,
          },
          rows,
        );
      }
    }

    await this.commit(tx, new Map([[pairKey(state.pair), state]]));
    const after = await tx.stockMovement.findMany({
      where: { operationId: first.operationId, farmId: first.farmId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (audit) {
      await this.log(
        tx,
        audit.ctx,
        'UPDATE',
        first.farmId,
        first.operationId,
        `${state.item.name} · ${first.type} ${signed(after)} ${state.item.unit}`,
        before.map(toAudit),
        after.map(toAudit),
      );
    }
    return { before, after };
  }

  /** Removes a hand-entered operation: every piece of the movement's operation. */
  async remove(
    tx: Tx,
    movementId: string,
    farmIds?: string[],
    audit?: { ctx: RequestContext },
  ): Promise<StockMovement[]> {
    const { state, rows } = await this.lockOperation(tx, movementId, farmIds);
    const removed = await tx.stockMovement.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const r of rows) r.removed = true;
    await this.commit(tx, new Map([[pairKey(state.pair), state]]));
    if (audit) {
      await this.log(
        tx,
        audit.ctx,
        'DELETE',
        removed[0].farmId,
        removed[0].operationId,
        `${state.item.name} · ${removed[0].type} ${signed(removed)} ${state.item.unit}`,
        removed.map(toAudit),
      );
    }
    return removed;
  }

  /**
   * Reverses an operation: deletes every movement it wrote (FEFO may have split
   * it, a formula wrote one per ingredient), then re-costs the later exits of
   * each affected (farm, item). Items are locked in ascending order. A later
   * exit that would go negative refuses the whole reversal (400), and nothing
   * is written. Returns the removed movements.
   */
  async reverseBySource(
    tx: Tx,
    sourceType: StockSourceType,
    sourceId: string,
    farmIds?: string[],
  ): Promise<StockMovement[]> {
    const found = await tx.stockMovement.findMany({
      where: {
        sourceType,
        sourceId,
        ...(farmIds ? { farmId: { in: farmIds } } : {}),
      },
    });
    if (found.length === 0) return [];
    const states = await this.lockAndLoad(tx, found);
    const ids = new Set(found.map((m) => m.id));
    for (const state of states.values()) {
      for (const row of state.rows) if (ids.has(row.id)) row.removed = true;
    }
    await this.commit(tx, states);
    return found;
  }

  // ----------------------------------------------------------------- reads

  /**
   * Quantity, weighted-average cost and value of each (farm, item) the ledger
   * knows, read from the cache `commit` keeps on `FarmStockItem`: no replay, a
   * fixed number of queries whatever the history. A pair whose average cost is
   * not cached yet (rows from before the cache) is replayed leniently, for this
   * read only: the next write to the pair persists it. Never throws.
   */
  async levels(
    farmIds: string[],
    itemIds?: string[],
    client: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, StockLevel>> {
    const result = new Map<string, StockLevel>();
    if (farmIds.length === 0 || itemIds?.length === 0) return result;
    const cached = await client.farmStockItem.findMany({
      where: {
        farmId: { in: farmIds },
        ...(itemIds ? { stockItemId: { in: itemIds } } : {}),
      },
      select: {
        farmId: true,
        stockItemId: true,
        quantity: true,
        averageCost: true,
      },
    });
    const uncached = cached.filter((c) => c.averageCost === null);
    const replayed = new Map<string, { quantity: Dec; averageCost: Dec }>();
    if (uncached.length > 0) {
      const rows = await client.stockMovement.findMany({
        where: {
          OR: uncached.map((c) => ({
            farmId: c.farmId,
            stockItemId: c.stockItemId,
          })),
        },
        select: {
          id: true,
          farmId: true,
          stockItemId: true,
          date: true,
          createdAt: true,
          type: true,
          quantity: true,
          unitCost: true,
        },
      });
      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const k = levelKey(r.farmId, r.stockItemId);
        const group = groups.get(k);
        if (group) group.push(r);
        else groups.set(k, [r]);
      }
      for (const [k, history] of groups) {
        replayed.set(k, replay(history, { strict: false }));
      }
    }
    for (const c of cached) {
      const k = levelKey(c.farmId, c.stockItemId);
      const known =
        c.averageCost === null
          ? (replayed.get(k) ?? { quantity: ZERO, averageCost: ZERO })
          : { quantity: c.quantity, averageCost: c.averageCost };
      result.set(k, {
        quantity: known.quantity,
        averageCost: known.averageCost,
        value: known.quantity.mul(known.averageCost).toDecimalPlaces(2),
      });
    }
    return result;
  }

  /**
   * The batches of the given farms (and items), each with the quantity it still
   * holds. A lot with no movement left (its entry was deleted: the ledger keeps
   * the empty lot) holds nothing and has no history: it is not listed. A lot
   * that is empty but has movements stays.
   */
  async batchLevels(
    farmIds: string[],
    itemIds?: string[],
    client: Tx | PrismaService = this.prisma,
  ): Promise<BatchLevel[]> {
    if (farmIds.length === 0 || itemIds?.length === 0) return [];
    const batches = await client.stockBatch.findMany({
      where: {
        farmId: { in: farmIds },
        ...(itemIds ? { stockItemId: { in: itemIds } } : {}),
      },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    if (batches.length === 0) return [];
    const sums = await client.stockMovement.groupBy({
      by: ['stockBatchId'],
      where: { stockBatchId: { in: batches.map((b) => b.id) } },
      _sum: { quantity: true },
    });
    const held = new Map(
      sums.map((s) => [s.stockBatchId, s._sum.quantity ?? ZERO]),
    );
    return batches.flatMap((batch) =>
      held.has(batch.id)
        ? [{ batch, quantity: held.get(batch.id) ?? ZERO }]
        : [],
    );
  }

  /**
   * What a sale dated `date` may take of each item in `farmId`: the sum, over
   * the lots that are not expired on `date` and the stock held in no lot, of
   * what `allocateExit` would give each of them (`headrooms`: its own lowest
   * balance from `date` to the end of its history; a lot received after `date`
   * gives nothing), so the picker and the ledger share one rule. Two queries
   * whatever the items, no lock. A read for pickers: the ledger still
   * validates the real exit (a validated inventory, for one, is not looked at).
   */
  async sellableAt(
    farmId: string,
    itemIds: string[],
    date: Date,
    client: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, Dec>> {
    const result = new Map(itemIds.map((id) => [id, ZERO]));
    if (itemIds.length === 0) return result;
    const where = { farmId, stockItemId: { in: itemIds } };
    const moves = await client.stockMovement.findMany({
      where,
      select: {
        id: true,
        stockItemId: true,
        stockBatchId: true,
        date: true,
        createdAt: true,
        quantity: true,
      },
    });
    const batches = await client.stockBatch.findMany({
      where,
      select: { id: true, expiryDate: true },
    });
    const expired = new Set(
      batches
        .filter((b) => b.expiryDate && b.expiryDate.getTime() < date.getTime())
        .map((b) => b.id),
    );
    const byItem = new Map<string, typeof moves>();
    for (const m of moves) {
      byItem.set(m.stockItemId, [...(byItem.get(m.stockItemId) ?? []), m]);
    }
    for (const id of itemIds) {
      let total = ZERO;
      for (const [bucket, room] of headrooms(byItem.get(id) ?? [], date)) {
        if (bucket === null || !expired.has(bucket)) total = total.add(room);
      }
      result.set(id, total);
    }
    return result;
  }

  /** Quantity held on `date` (movements dated on or before it), per item. */
  async quantitiesAt(
    farmId: string,
    itemIds: string[],
    date: Date,
    client: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, Dec>> {
    const result = new Map(itemIds.map((id) => [id, ZERO]));
    if (itemIds.length === 0) return result;
    const sums = await client.stockMovement.groupBy({
      by: ['stockItemId'],
      where: { farmId, stockItemId: { in: itemIds }, date: { lte: date } },
      _sum: { quantity: true },
    });
    for (const s of sums) result.set(s.stockItemId, s._sum.quantity ?? ZERO);
    return result;
  }

  /**
   * Average daily consumption per (farm, item) over the last `days` days up to
   * today: `Σ |quantity|` of the exits for consumption or treatment, divided
   * by `days`. Pairs with no consumption are absent.
   */
  async dailyConsumption(
    farmIds: string[],
    itemIds: string[],
    days = 30,
    client: Tx | PrismaService = this.prisma,
    now: Date = new Date(),
  ): Promise<Map<string, Dec>> {
    const result = new Map<string, Dec>();
    if (farmIds.length === 0 || itemIds.length === 0) return result;
    const sums = await client.stockMovement.groupBy({
      by: ['farmId', 'stockItemId'],
      where: {
        farmId: { in: farmIds },
        stockItemId: { in: itemIds },
        type: 'SORTIE',
        reason: { in: CONSUMPTION_REASONS },
        date: { gte: addDays(today(now), -(days - 1)), lte: today(now) },
      },
      _sum: { quantity: true },
    });
    for (const s of sums) {
      result.set(
        levelKey(s.farmId, s.stockItemId),
        (s._sum.quantity ?? ZERO).abs().div(days),
      );
    }
    return result;
  }

  // -------------------------------------------------------------- internals

  private normalise(raw: RecordInput) {
    const quantity = D(raw.quantity);
    if (raw.type === 'TRANSFERT_ENTREE' || raw.type === 'TRANSFERT_SORTIE') {
      throw new BadRequestException(
        'Les transferts entre fermes ne sont pas pris en charge',
      );
    }
    assertSign(raw.type, quantity);
    assertNotFuture(raw.date);
    let unitCost: Dec | null = null;
    if (quantity.gt(0)) {
      if (raw.unitCost === undefined || raw.unitCost === null) {
        if (raw.type === 'ENTREE') {
          throw new BadRequestException('Le coût unitaire est requis');
        }
      } else {
        unitCost = checkedCost(raw.unitCost);
      }
    }
    return {
      raw,
      quantity,
      unitCost,
      pair: { farmId: raw.farmId, stockItemId: raw.stockItemId },
    };
  }

  private async assertItem(
    tx: Tx,
    farmId: string,
    stockItemId: string,
  ): Promise<StockItem> {
    const item = await tx.stockItem.findFirst({
      where: {
        id: stockItemId,
        organization: { farms: { some: { id: farmId } } },
      },
    });
    if (!item) throw new BadRequestException(INVALID_ITEM);
    // Held to the end of the transaction: the article cannot be deleted, nor
    // retyped (`FOR UPDATE`), under a write in flight.
    const held = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "StockItem" WHERE id = ${stockItemId} FOR KEY SHARE`;
    // Deleted between the read and the lock: the insert would fail on the FK.
    if (held.length === 0) throw new BadRequestException(INVALID_ITEM);
    return item;
  }

  /**
   * Locks the `FarmStockItem` row of every pair (created on demand), always in
   * ascending item order, then loads each history. Two operations touching the
   * same articles in opposite orders therefore cannot deadlock.
   */
  private async lockAndLoad(
    tx: Tx,
    pairs: Pair[],
  ): Promise<Map<string, State>> {
    const items = await this.lockPairs(tx, pairs);
    const counts = await this.latestCounts(
      tx,
      [...items.values()].map((i) => i.pair),
    );
    const states = new Map<string, State>();
    for (const [key, { pair, item }] of items) {
      states.set(key, await this.load(tx, pair, item, counts.get(key) ?? null));
    }
    return states;
  }

  /**
   * Takes the stock locks of several articles of one operation (an inventory
   * validation) before it reads the quantities it will act on; `record*` then
   * re-takes them for free. Same ascending order as every other caller.
   */
  async lockItems(
    tx: Tx,
    farmId: string,
    stockItemIds: string[],
  ): Promise<void> {
    await this.lockPairs(
      tx,
      stockItemIds.map((stockItemId) => ({ farmId, stockItemId })),
    );
  }

  private async lockPairs(
    tx: Tx,
    pairs: Pair[],
  ): Promise<Map<string, { pair: Pair; item: StockItem }>> {
    const unique = new Map<string, Pair>();
    for (const p of pairs) {
      unique.set(pairKey(p), { farmId: p.farmId, stockItemId: p.stockItemId });
    }
    const ordered = [...unique.values()].sort(
      (a, b) =>
        a.stockItemId.localeCompare(b.stockItemId) ||
        a.farmId.localeCompare(b.farmId),
    );
    const items = new Map<string, StockItem>();
    for (const p of ordered) {
      items.set(pairKey(p), await this.assertItem(tx, p.farmId, p.stockItemId));
    }
    const locked = new Map<string, { pair: Pair; item: StockItem }>();
    for (const p of ordered) {
      const lock = await ensureFarmStockItem(tx, p.farmId, p.stockItemId);
      await lockRow(tx, 'FarmStockItem', lock.id);
      locked.set(pairKey(p), { pair: p, item: items.get(pairKey(p))! });
    }
    return locked;
  }

  /**
   * The latest validated count of each pair, from the validated inventory
   * lines: one query for all the pairs (a count with no difference wrote no
   * movement, the lines are what says it happened).
   */
  private async latestCounts(
    tx: Tx,
    pairs: Pair[],
  ): Promise<Map<string, { date: Date; at: Date }>> {
    const counts = new Map<string, { date: Date; at: Date }>();
    if (pairs.length === 0) return counts;
    const wanted = new Set(pairs.map(pairKey));
    const lines = await tx.inventoryLine.findMany({
      where: {
        stockItemId: { in: [...new Set(pairs.map((p) => p.stockItemId))] },
        session: {
          status: 'VALIDEE',
          farmId: { in: [...new Set(pairs.map((p) => p.farmId))] },
        },
      },
      select: {
        stockItemId: true,
        session: { select: { farmId: true, date: true, validatedAt: true } },
      },
    });
    for (const { stockItemId, session } of lines) {
      const key = levelKey(session.farmId, stockItemId);
      if (!wanted.has(key)) continue;
      const at = session.validatedAt ?? session.date;
      const known = counts.get(key);
      if (
        !known ||
        session.date.getTime() > known.date.getTime() ||
        (session.date.getTime() === known.date.getTime() &&
          at.getTime() > known.at.getTime())
      ) {
        counts.set(key, { date: session.date, at });
      }
    }
    return counts;
  }

  private async load(
    tx: Tx,
    pair: Pair,
    item: StockItem,
    count: { date: Date; at: Date } | null,
  ): Promise<State> {
    const [rows, batches] = await Promise.all([
      tx.stockMovement.findMany({
        where: pair,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      tx.stockBatch.findMany({ where: pair }),
    ]);
    const latest = rows.reduce(
      (max, r) => Math.max(max, r.createdAt.getTime()),
      0,
    );
    return {
      pair,
      item,
      batches: new Map(batches.map((b) => [b.id, b])),
      batchPatches: new Map(),
      expiryChanged: new Set(),
      next: Math.max(Date.now(), latest + 1),
      count,
      rows: rows.map((r) => ({
        id: r.id,
        farmId: r.farmId,
        stockItemId: r.stockItemId,
        stockBatchId: r.stockBatchId,
        date: r.date,
        createdAt: r.createdAt,
        type: r.type,
        quantity: r.quantity,
        unitCost: r.unitCost,
        reason: r.reason,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        operationId: r.operationId,
        lotExplicit: r.lotExplicit,
        note: r.note,
        createdById: r.createdById,
        fresh: false,
        removed: false,
        origin: { date: r.date, createdAt: r.createdAt },
        storedCost: r.unitCost,
        patch: {},
      })),
    };
  }

  /** Locks the stock of a hand-entered movement and returns its whole operation (all pieces). */
  private async lockOperation(tx: Tx, movementId: string, farmIds?: string[]) {
    const found = await tx.stockMovement.findFirst({
      where: {
        id: movementId,
        ...(farmIds ? { farmId: { in: farmIds } } : {}),
      },
    });
    if (!found) throw new NotFoundException(MOVEMENT_NOT_FOUND);
    const pair = { farmId: found.farmId, stockItemId: found.stockItemId };
    const state = (await this.lockAndLoad(tx, [pair])).get(pairKey(pair))!;
    // The row may have gone between the read and the lock.
    if (!state.rows.some((r) => r.id === movementId)) {
      throw new NotFoundException(MOVEMENT_NOT_FOUND);
    }
    const rows = state.rows
      .filter((r) => r.operationId === found.operationId)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    return { state, rows };
  }

  /**
   * Adds the movement(s) of one input to its history, allocating an exit
   * across lots. `claimed` are the rows of the operation this input replaces:
   * they keep their ids (where the lot survives) and their place in the day.
   */
  private plan(
    state: State,
    input: ReturnType<StockLedgerService['normalise']>,
    claimed: Work[] = [],
  ): Work[] {
    const { raw, quantity, unitCost } = input;
    if (raw.stockBatchId && !state.batches.has(raw.stockBatchId)) {
      throw new BadRequestException(INVALID_BATCH);
    }
    const entering = quantity.gt(0);
    const pieces: Piece[] = entering
      ? [{ batchId: raw.stockBatchId ?? null, quantity }]
      : this.exitPieces(state, {
          date: raw.date,
          needed: quantity.abs(),
          reason: raw.reason,
          batchId: raw.stockBatchId,
          anchor: claimed[0]?.createdAt,
        });
    return this.place(
      state,
      pieces,
      {
        date: raw.date,
        type: raw.type,
        reason: raw.reason,
        sourceType: raw.sourceType ?? null,
        sourceId: raw.sourceId ?? null,
        operationId: claimed[0]?.operationId ?? randomUUID(),
        lotExplicit: !entering && !!raw.stockBatchId,
        note: raw.note ?? null,
        createdById: raw.userId,
        unitCost,
      },
      claimed,
    );
  }

  /**
   * Writes the pieces of an exit operation. Where `old` (already marked
   * removed) has a row on the same lot it is reused: same id, only the changed
   * fields written. An operation keeps its place in its day (the first old
   * row's creation time) when its date is unchanged; one that moves to another
   * day goes to the end of that day like a new movement. (An entry edited by
   * `update` does not come through here: it changes its own row and keeps its
   * creation time, so on a new day it sorts among that day's movements by when
   * it was first created.)
   */
  private place(
    state: State,
    pieces: Piece[],
    base: AddBase,
    old: Work[],
  ): Work[] {
    const free = [...old].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    const sameDay =
      free.length > 0 && free[0].date.getTime() === base.date.getTime();
    const anchor = sameDay ? free[0].createdAt : undefined;
    return pieces.map((piece) => {
      const at = free.findIndex(
        (r) =>
          r.stockBatchId === piece.batchId &&
          r.quantity.gt(0) === piece.quantity.gt(0),
      );
      if (at < 0) {
        return this.addRows(state, [piece], { ...base, createdAt: anchor })[0];
      }
      const [row] = free.splice(at, 1);
      row.removed = false;
      const set = <
        K extends keyof Work & keyof Prisma.StockMovementUncheckedUpdateInput,
      >(
        key: K,
        value: Work[K],
      ) => {
        const now = row[key] as unknown;
        const same =
          value instanceof Prisma.Decimal
            ? now instanceof Prisma.Decimal && now.eq(value)
            : value instanceof Date
              ? now instanceof Date && now.getTime() === value.getTime()
              : now === value;
        if (same) return;
        row[key] = value;
        // A cost left to the average is not stored: flush rewrites the cost.
        if (key !== 'unitCost' || value !== null) {
          (row.patch as Record<string, unknown>)[key] = value;
        }
      };
      set('quantity', piece.quantity);
      set('date', base.date);
      set('reason', base.reason);
      set('note', base.note);
      set('lotExplicit', base.lotExplicit);
      if (piece.quantity.gt(0)) set('unitCost', base.unitCost);
      if (!sameDay) set('createdAt', new Date(state.next++));
      return row;
    });
  }

  private addRows(state: State, pieces: Piece[], base: AddBase): Work[] {
    return pieces.map((piece) => {
      const row: Work = {
        ...base,
        id: randomUUID(),
        farmId: state.pair.farmId,
        stockItemId: state.pair.stockItemId,
        stockBatchId: piece.batchId,
        createdAt: base.createdAt ?? new Date(state.next++),
        quantity: piece.quantity,
        unitCost: piece.quantity.gt(0) ? base.unitCost : null,
        fresh: true,
        removed: false,
        origin: null,
        storedCost: null,
        patch: {},
      };
      state.rows.push(row);
      return row;
    });
  }

  /** Where an exit of `needed` units on `date` takes its stock from, mapped to the 400 the routes answer. */
  private exitPieces(
    state: State,
    opts: {
      date: Date;
      needed: Dec;
      reason: StockReason;
      batchId?: string | null;
      anchor?: Date;
    },
  ): Piece[] {
    try {
      return allocateExit({
        rows: state.rows.filter((r) => !r.removed),
        batches: [...state.batches.values()],
        date: opts.date,
        needed: opts.needed,
        consumption: REFUSES_EXPIRED_LOTS.includes(opts.reason),
        batchId: opts.batchId,
        anchor: opts.anchor,
      });
    } catch (error) {
      if (!(error instanceof AllocationError)) throw error;
      if (error.kind === 'EXPIRED') {
        throw new BadRequestException(EXPIRED_BATCH);
      }
      if (error.kind === 'PARTLY_EXPIRED') {
        throw new BadRequestException(PARTLY_EXPIRED);
      }
      const lot = opts.batchId
        ? `, lot ${state.batches.get(opts.batchId)?.lotNumber ?? opts.batchId}`
        : '';
      throw new BadRequestException(
        `${INSUFFICIENT} pour ${state.item.name}${lot} (disponible ${error.available.toString()} ${state.item.unit})`,
      );
    }
  }

  /** Reads back what `recordMany`/`replaceBySource` wrote, and audits each input once (keyed by its operation). */
  private async results(
    tx: Tx,
    states: Map<string, State>,
    planned: {
      input: ReturnType<StockLedgerService['normalise']>;
      rows: Work[];
    }[],
    created: Map<string, StockMovement>,
  ): Promise<RecordResult[]> {
    const results: RecordResult[] = [];
    // Rows an edit reused were updated, not created: read them back.
    const reused = planned.flatMap((p) => p.rows.filter((r) => !r.fresh));
    if (reused.length > 0) {
      for (const m of await tx.stockMovement.findMany({
        where: { id: { in: reused.map((r) => r.id) } },
      })) {
        created.set(m.id, m);
      }
    }
    for (const { input, rows } of planned) {
      const movements = rows.map((r) => created.get(r.id)!);
      const cost = movements.reduce(
        (sum, m) => sum.add(m.quantity.abs().mul(m.unitCost)),
        ZERO,
      );
      results.push({
        movements,
        unitCost: movements[0].unitCost,
        cost: cost.toDecimalPlaces(2),
      });
      if (input.raw.audit) {
        const state = states.get(pairKey(input.pair))!;
        await this.log(
          tx,
          input.raw.audit.ctx,
          'CREATE',
          input.pair.farmId,
          movements[0].operationId,
          `${state.item.name} · ${input.raw.type} ${signed(movements)} ${state.item.unit}`,
          undefined,
          movements.map(toAudit),
        );
      }
    }
    return results;
  }

  /**
   * A validated inventory closes the past of its (farm, article): what was
   * counted would otherwise be shifted by a later write that lands before it.
   * Refuses (409) any row this operation adds, removes or moves (its quantity,
   * date or place) whose position, before or after the change, is before
   * the latest count: an earlier day, or the count day but created before the
   * count was validated. Same-day writes after the count, and edits that keep
   * a position after it, pass.
   */
  private assertAfterCount(state: State): void {
    const { count } = state;
    if (!count) return;
    const before = (p: { date: Date; createdAt: Date }): boolean =>
      p.date.getTime() < count.date.getTime() ||
      (p.date.getTime() === count.date.getTime() &&
        p.createdAt.getTime() < count.at.getTime());
    for (const r of state.rows) {
      const positions: { date: Date; createdAt: Date }[] = r.fresh
        ? [r]
        : r.removed
          ? [r.origin!]
          : MOVES_STOCK.some((key) => key in r.patch)
            ? [r.origin!, r]
            : [];
      if (positions.some(before)) {
        throw new ConflictException(
          `Un inventaire validé le ${formatDay(count.date)} verrouille les mouvements antérieurs de ${state.item.name}`,
        );
      }
    }
  }

  /** Replays the live movements of a history; throws when it breaks a rule (closed past, quantity, lot, expiry). */
  private validate(state: State) {
    this.assertAfterCount(state);
    const live = state.rows.filter((r) => !r.removed);
    // Only what this operation writes, or draws from a lot whose expiry it
    // changes, is checked: an old consumption already past its lot's expiry
    // must not block unrelated writes to the item.
    for (const r of live) {
      const touched =
        r.fresh ||
        'date' in r.patch ||
        'quantity' in r.patch ||
        (r.stockBatchId !== null && state.expiryChanged.has(r.stockBatchId));
      if (
        touched &&
        r.quantity.lt(0) &&
        REFUSES_EXPIRED_LOTS.includes(r.reason)
      ) {
        this.assertNotExpired(
          r.stockBatchId ? state.batches.get(r.stockBatchId) : undefined,
          r.date,
        );
      }
    }
    assertBucketsNonNegative(live, state.item.name);
    return replay(live);
  }

  private assertNotExpired(batch: StockBatch | undefined, date: Date): void {
    if (batch?.expiryDate && batch.expiryDate.getTime() < date.getTime()) {
      throw new BadRequestException(EXPIRED_BATCH);
    }
  }

  /**
   * Validates EVERY state, then writes them: nothing is written when any
   * history is refused. Returns the created rows by id.
   */
  private async commit(
    tx: Tx,
    states: Map<string, State>,
  ): Promise<Map<string, StockMovement>> {
    const plans = [...states.values()].map((state) => ({
      state,
      replayed: this.validate(state),
    }));
    const created = new Map<string, StockMovement>();
    for (const { state, replayed } of plans) {
      for (const [id, m] of await this.flush(tx, state, replayed)) {
        created.set(id, m);
      }
    }
    return created;
  }

  /**
   * Writes the difference of a validated history: batch changes, removed rows
   * deleted, new rows created with their final cost, only the rows whose
   * fields or cost changed updated, and the (farm, article) cache of quantity
   * and average cost refreshed, under the lock the caller holds. A lot left
   * with no movement is kept (deleting it would race with a reader naming it).
   */
  private async flush(
    tx: Tx,
    state: State,
    replayed: ReturnType<typeof replay<Work>>,
  ): Promise<Map<string, StockMovement>> {
    const { timeline } = replayed;
    const created = new Map<string, StockMovement>();
    for (const [id, data] of state.batchPatches) {
      await tx.stockBatch.update({ where: { id }, data });
    }
    const gone = state.rows.filter((r) => r.removed && !r.fresh);
    if (gone.length > 0) {
      await tx.stockMovement.deleteMany({
        where: { id: { in: gone.map((r) => r.id) } },
      });
    }
    for (const step of timeline) {
      const row = step.movement;
      // An entry keeps its own cost; an exit (or an entry left to the average) takes the replayed one.
      const cost =
        isEntry(row) && row.unitCost !== null
          ? row.unitCost
          : step.unitCost.toDecimalPlaces(2);
      if (row.fresh) {
        created.set(
          row.id,
          await tx.stockMovement.create({
            data: {
              id: row.id,
              farmId: row.farmId,
              stockItemId: row.stockItemId,
              stockBatchId: row.stockBatchId,
              date: row.date,
              type: row.type,
              quantity: row.quantity,
              unitCost: cost,
              reason: row.reason,
              sourceType: row.sourceType,
              sourceId: row.sourceId,
              operationId: row.operationId,
              lotExplicit: row.lotExplicit,
              note: row.note,
              createdById: row.createdById,
              createdAt: row.createdAt,
            },
          }),
        );
        continue;
      }
      const data: Prisma.StockMovementUncheckedUpdateInput = { ...row.patch };
      if (!row.storedCost?.eq(cost)) data.unitCost = cost;
      if (Object.keys(data).length > 0) {
        await tx.stockMovement.update({ where: { id: row.id }, data });
      }
    }
    await tx.farmStockItem.update({
      where: { farmId_stockItemId: state.pair },
      data: { quantity: replayed.quantity, averageCost: replayed.averageCost },
    });
    return created;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: AuditAction,
    farmId: string,
    recordId: string,
    label: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    return this.audit.log(
      { ctx, module: 'stocks', action, farmId, recordId, label, before, after },
      tx,
    );
  }
}

const pairKey = (p: Pair): string => levelKey(p.farmId, p.stockItemId);

/**
 * Edits that move stock (its quantity, its day, its place in the day): refused
 * before a validated count. A cost-only correction passes: a count fixes
 * quantities, not values.
 */
const MOVES_STOCK = ['date', 'quantity', 'createdAt'] as const;

function assertExpiryAfterReception(expiry: Date | null, received: Date): void {
  if (expiry && expiry.getTime() < received.getTime()) {
    throw new BadRequestException(
      'La péremption ne peut pas précéder la réception du lot',
    );
  }
}

function signed(movements: StockMovement[]): string {
  return movements.reduce((sum, m) => sum.add(m.quantity), ZERO).toString();
}

function assertSign(type: StockMovementType, quantity: Dec): void {
  if (quantity.isZero()) {
    throw new BadRequestException('La quantité ne peut pas être nulle');
  }
  if (type === 'ENTREE' && quantity.lt(0)) {
    throw new BadRequestException(
      'Une entrée doit avoir une quantité positive',
    );
  }
  if (type === 'SORTIE' && quantity.gt(0)) {
    throw new BadRequestException(
      'Une sortie doit avoir une quantité négative',
    );
  }
}

function checkedCost(value: Num): Dec {
  const cost = D(value);
  if (cost.lt(0)) {
    throw new BadRequestException('Le coût unitaire doit être positif ou nul');
  }
  return cost.toDecimalPlaces(2);
}

const toAudit = (m: StockMovement) => ({
  id: m.id,
  date: m.date,
  stockItemId: m.stockItemId,
  stockBatchId: m.stockBatchId,
  type: m.type,
  quantity: m.quantity,
  unitCost: m.unitCost,
  reason: m.reason,
  sourceType: m.sourceType,
  sourceId: m.sourceId,
  operationId: m.operationId,
  note: m.note,
});

/**
 * The `FarmStockItem` row of a (farm, item), created with no thresholds when
 * missing. ON CONFLICT DO NOTHING makes two transactions racing on a new
 * article agree on one row (the loser waits for the winner's commit).
 */
export async function ensureFarmStockItem(
  tx: Tx,
  farmId: string,
  stockItemId: string,
): Promise<{ id: string }> {
  await tx.$executeRaw`INSERT INTO "FarmStockItem" ("id", "farmId", "stockItemId", "averageCost", "updatedAt")
    VALUES (${randomUUID()}, ${farmId}, ${stockItemId}, 0, now())
    ON CONFLICT ("farmId", "stockItemId") DO NOTHING`;
  return tx.farmStockItem.findUniqueOrThrow({
    where: { farmId_stockItemId: { farmId, stockItemId } },
    select: { id: true },
  });
}
