import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { addDays, assertNotFuture, today } from '../common/days';
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
import { allocateExit, AllocationError, type Piece } from './allocation';
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

export const EXPIRED_BATCH = 'Lot périmé';
export const PARTLY_EXPIRED =
  'Stock insuffisant (une partie du stock est périmée)';
export const INVALID_ITEM = 'Article invalide pour cette ferme';
export const INVALID_BATCH = 'Lot invalide pour cet article';
export const MOVEMENT_NOT_FOUND = 'Mouvement introuvable';

/** Reasons that consume stock for production: they may not draw on an expired lot. */
export const CONSUMPTION_REASONS: StockReason[] = [
  'CONSOMMATION',
  'TRAITEMENT',
];

/** The operations that write ledger movements (`sourceType`); each task that adds one adds it here. */
export const STOCK_SOURCES = [
  'INVENTORY',
  'FEED_DISTRIBUTION',
  'HEALTH_ACT',
  'PURCHASE',
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
   * When given, the ledger writes the operation's audit row itself, in the same
   * transaction (one row per call, whatever the number of movements).
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
  note: string | null;
  createdById: string;
  fresh: boolean;
  removed: boolean;
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
  /** Creation time of the next new movement: after everything already written. */
  next: number;
}

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
 * transactions could deadlock.
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
   * calls this on edit instead of reversing then recording. Nothing is
   * written when a resulting history is refused.
   */
  async replaceBySource(
    tx: Tx,
    sourceType: StockSourceType,
    sourceId: string,
    inputs: Omit<RecordInput, 'sourceType' | 'sourceId' | 'audit'>[],
    audit?: { ctx: RequestContext },
    farmIds?: string[],
  ): Promise<{ removed: StockMovement[]; results: RecordResult[] }> {
    const old = await tx.stockMovement.findMany({
      where: {
        sourceType,
        sourceId,
        ...(farmIds ? { farmId: { in: farmIds } } : {}),
      },
    });
    const normalised = inputs.map((i) =>
      this.normalise({ ...i, sourceType, sourceId }),
    );
    const states = await this.lockAndLoad(tx, [
      ...old,
      ...normalised.map((i) => i.pair),
    ]);
    const oldIds = new Set(old.map((m) => m.id));
    for (const state of states.values()) {
      for (const row of state.rows) if (oldIds.has(row.id)) row.removed = true;
    }
    const planned = normalised.map((input) => ({
      input,
      rows: this.plan(states.get(pairKey(input.pair))!, input),
    }));
    const created = await this.commit(tx, states);
    const results = await this.results(tx, states, planned, created, false);
    const first = old[0] ?? results[0]?.movements[0];
    if (audit && first) {
      await this.log(
        tx,
        audit.ctx,
        'UPDATE',
        first.farmId,
        sourceId,
        `${sourceType} · ${old.length} → ${results.reduce((n, r) => n + r.movements.length, 0)} mouvement(s) de stock`,
        old.map(toAudit),
        results.flatMap((r) => r.movements).map(toAudit),
      );
    }
    return { removed: old, results };
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
   * again from the lots as of the new date (a single-lot exit keeps that lot
   * first), so a bigger quantity can draw on other lots. The operation keeps
   * its `operationId`.
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
        const pieces = this.exitPieces(state, {
          date,
          needed: wanted.abs(),
          reason: first.reason,
          prefer: rows.length === 1 ? first.stockBatchId : null,
        });
        this.addRows(state, pieces, {
          date,
          type: first.type,
          reason: first.reason,
          sourceType: first.sourceType,
          sourceId: first.sourceId,
          operationId: first.operationId,
          note: patch.note !== undefined ? patch.note : first.note,
          createdById: first.createdById,
          unitCost: null,
        });
      }
    }

    const created = await this.commit(
      tx,
      new Map([[pairKey(state.pair), state]]),
    );
    void created;
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
    audit?: { ctx: RequestContext },
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
    if (audit) {
      await this.log(
        tx,
        audit.ctx,
        'DELETE',
        found[0].farmId,
        sourceId,
        `Annulation ${sourceType} · ${found.length} mouvement(s) de stock`,
        found.map(toAudit),
      );
    }
    return found;
  }

  // ----------------------------------------------------------------- reads

  /** Quantity, weighted-average cost and value of each (farm, item) that has movements. */
  async levels(
    farmIds: string[],
    itemIds?: string[],
    client: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, StockLevel>> {
    const result = new Map<string, StockLevel>();
    if (farmIds.length === 0 || itemIds?.length === 0) return result;
    const rows = await client.stockMovement.findMany({
      where: {
        farmId: { in: farmIds },
        ...(itemIds ? { stockItemId: { in: itemIds } } : {}),
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
      const { quantity, averageCost } = replay(history);
      result.set(k, {
        quantity,
        averageCost,
        value: quantity.mul(averageCost).toDecimalPlaces(2),
      });
    }
    return result;
  }

  /** The batches of the given farms (and items), each with the quantity it still holds. */
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
    return batches.map((batch) => ({
      batch,
      quantity: held.get(batch.id) ?? ZERO,
    }));
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
        date: { gte: addDays(today(), -(days - 1)), lte: today() },
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
    const states = new Map<string, State>();
    for (const [key, { pair, item }] of items) {
      states.set(key, await this.load(tx, pair, item));
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

  private async load(tx: Tx, pair: Pair, item: StockItem): Promise<State> {
    const [rows, batches] = await Promise.all([
      tx.stockMovement.findMany({ where: pair }),
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
      next: Math.max(Date.now(), latest + 1),
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
        note: r.note,
        createdById: r.createdById,
        fresh: false,
        removed: false,
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

  /** Adds the new movement(s) of one input to its history, allocating an exit across batches. */
  private plan(
    state: State,
    input: ReturnType<StockLedgerService['normalise']>,
  ): Work[] {
    const { raw, quantity, unitCost } = input;
    if (raw.stockBatchId && !state.batches.has(raw.stockBatchId)) {
      throw new BadRequestException(INVALID_BATCH);
    }
    const pieces: Piece[] = quantity.gt(0)
      ? [{ batchId: raw.stockBatchId ?? null, quantity }]
      : this.exitPieces(state, {
          date: raw.date,
          needed: quantity.abs(),
          reason: raw.reason,
          batchId: raw.stockBatchId,
        });
    return this.addRows(state, pieces, {
      date: raw.date,
      type: raw.type,
      reason: raw.reason,
      sourceType: raw.sourceType ?? null,
      sourceId: raw.sourceId ?? null,
      operationId: randomUUID(),
      note: raw.note ?? null,
      createdById: raw.userId,
      unitCost,
    });
  }

  private addRows(
    state: State,
    pieces: Piece[],
    base: Pick<
      Work,
      | 'date'
      | 'type'
      | 'reason'
      | 'sourceType'
      | 'sourceId'
      | 'operationId'
      | 'note'
      | 'createdById'
      | 'unitCost'
    >,
  ): Work[] {
    return pieces.map((piece) => {
      const row: Work = {
        ...base,
        id: randomUUID(),
        farmId: state.pair.farmId,
        stockItemId: state.pair.stockItemId,
        stockBatchId: piece.batchId,
        createdAt: new Date(state.next++),
        quantity: piece.quantity,
        unitCost: piece.quantity.gt(0) ? base.unitCost : null,
        fresh: true,
        removed: false,
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
      prefer?: string | null;
    },
  ): Piece[] {
    try {
      return allocateExit({
        rows: state.rows.filter((r) => !r.removed),
        batches: [...state.batches.values()],
        date: opts.date,
        needed: opts.needed,
        consumption: CONSUMPTION_REASONS.includes(opts.reason),
        batchId: opts.batchId,
        prefer: opts.prefer,
      });
    } catch (error) {
      if (!(error instanceof AllocationError)) throw error;
      if (error.kind === 'EXPIRED') {
        throw new BadRequestException(EXPIRED_BATCH);
      }
      if (error.kind === 'PARTLY_EXPIRED') {
        throw new BadRequestException(PARTLY_EXPIRED);
      }
      throw new BadRequestException(
        `${INSUFFICIENT} pour ${state.item.name} (disponible ${error.available.toString()} ${state.item.unit})`,
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
    auditEach = true,
  ): Promise<RecordResult[]> {
    const results: RecordResult[] = [];
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
      if (auditEach && input.raw.audit) {
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

  /** Replays the live movements of a history; throws 400 when it breaks a rule (quantity, lot, expiry). */
  private validate(state: State) {
    const live = state.rows.filter((r) => !r.removed);
    for (const r of live) {
      if (r.quantity.lt(0) && CONSUMPTION_REASONS.includes(r.reason)) {
        this.assertNotExpired(
          r.stockBatchId ? state.batches.get(r.stockBatchId) : undefined,
          r.date,
        );
      }
    }
    assertBucketsNonNegative(live);
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
      timeline: this.validate(state).timeline,
    }));
    const created = new Map<string, StockMovement>();
    for (const { state, timeline } of plans) {
      for (const [id, m] of await this.flush(tx, state, timeline)) {
        created.set(id, m);
      }
    }
    return created;
  }

  /**
   * Writes the difference of a validated history: batch changes, removed rows
   * deleted, new rows created with their final cost, and only the rows whose
   * fields or cost changed updated.
   */
  private async flush(
    tx: Tx,
    state: State,
    timeline: ReturnType<typeof replay<Work>>['timeline'],
  ): Promise<Map<string, StockMovement>> {
    const created = new Map<string, StockMovement>();
    for (const [id, data] of state.batchPatches) {
      await tx.stockBatch.update({ where: { id }, data });
    }
    const gone = state.rows.filter((r) => r.removed && !r.fresh);
    if (gone.length > 0) {
      await tx.stockMovement.deleteMany({
        where: { id: { in: gone.map((r) => r.id) } },
      });
      // A batch whose last movement went with them goes too.
      const live = new Set(
        state.rows.filter((r) => !r.removed).map((r) => r.stockBatchId),
      );
      const orphans = [
        ...new Set(
          gone.flatMap((r) =>
            r.stockBatchId && !live.has(r.stockBatchId) ? [r.stockBatchId] : [],
          ),
        ),
      ];
      if (orphans.length > 0) {
        await tx.stockBatch.deleteMany({ where: { id: { in: orphans } } });
      }
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
  await tx.$executeRaw`INSERT INTO "FarmStockItem" ("id", "farmId", "stockItemId", "updatedAt")
    VALUES (${randomUUID()}, ${farmId}, ${stockItemId}, now())
    ON CONFLICT ("farmId", "stockItemId") DO NOTHING`;
  return tx.farmStockItem.findUniqueOrThrow({
    where: { farmId_stockItemId: { farmId, stockItemId } },
    select: { id: true },
  });
}
