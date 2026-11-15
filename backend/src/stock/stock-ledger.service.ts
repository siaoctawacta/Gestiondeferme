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
  sourceType?: string | null;
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
  /** One per batch the stock was taken from (several when FEFO splits an exit). */
  movements: StockMovement[];
  /** The cost per unit: the running average for an exit (the same on every part), the given cost for an entry. */
  unitCost: Dec;
  /** `Σ |quantity| × unitCost`, 2 decimals. */
  cost: Dec;
}

export interface MovementPatch {
  date?: Date;
  /** Signed, same sign as the movement. */
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
 * ascending item order.
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
   * ascending item order, and either every input is written or none.
   * Results line up with `inputs`.
   */
  async recordMany(tx: Tx, inputs: RecordInput[]): Promise<RecordResult[]> {
    const normalised = inputs.map((i) => this.normalise(i));
    const states = await this.lockAndLoad(
      tx,
      normalised.map((i) => i.pair),
    );
    const planned = normalised.map((input) => {
      const state = states.get(pairKey(input.pair))!;
      return { input, rows: this.plan(state, input) };
    });
    const created = new Map<string, StockMovement>();
    for (const state of states.values()) {
      for (const [id, m] of await this.flush(tx, state)) created.set(id, m);
    }
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
      if (input.raw.audit) {
        const state = states.get(pairKey(input.pair))!;
        await this.log(
          tx,
          input.raw.audit.ctx,
          'CREATE',
          input.pair.farmId,
          movements[0].id,
          `${state.item.name} · ${input.raw.type} ${signed(movements)} ${state.item.unit}`,
          undefined,
          movements.map(toAudit),
        );
      }
    }
    return results;
  }

  /** A lot received; its quantity is the sum of the movements that carry it. */
  async createBatch(tx: Tx, batch: NewBatch): Promise<StockBatch> {
    await this.assertItem(tx, batch.farmId, batch.stockItemId);
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

  async update(
    tx: Tx,
    movementId: string,
    patch: MovementPatch,
    farmIds?: string[],
    audit?: { ctx: RequestContext },
  ): Promise<{ before: StockMovement; after: StockMovement }> {
    const found = await this.findMovement(tx, movementId, farmIds);
    const pair = { farmId: found.farmId, stockItemId: found.stockItemId };
    const state = (await this.lockAndLoad(tx, [pair])).get(pairKey(pair))!;
    const row = state.rows.find((r) => r.id === movementId);
    if (!row) throw new BadRequestException(MOVEMENT_NOT_FOUND);
    const before = await tx.stockMovement.findUniqueOrThrow({
      where: { id: movementId },
    });

    if (patch.date) {
      assertNotFuture(patch.date);
      row.date = patch.date;
      row.patch.date = patch.date;
    }
    if (patch.quantity !== undefined) {
      const quantity = D(patch.quantity);
      assertSign(row.type, quantity);
      if (quantity.isNeg() !== row.quantity.isNeg()) {
        throw new BadRequestException(
          'Le sens du mouvement ne peut pas changer',
        );
      }
      row.quantity = quantity;
      row.patch.quantity = quantity;
    }
    if (patch.unitCost !== undefined) {
      if (!isEntry(row)) {
        throw new BadRequestException(
          'Le coût d’une sortie est calculé automatiquement',
        );
      }
      row.unitCost = checkedCost(patch.unitCost);
      row.patch.unitCost = row.unitCost;
    }
    if (patch.note !== undefined) row.patch.note = patch.note;

    if (
      patch.lotNumber !== undefined ||
      patch.expiryDate !== undefined ||
      (patch.date && row.stockBatchId && isEntry(row))
    ) {
      const batch = row.stockBatchId
        ? state.batches.get(row.stockBatchId)
        : null;
      const touchesLot =
        patch.lotNumber !== undefined || patch.expiryDate !== undefined;
      if (touchesLot && (!batch || !isEntry(row))) {
        throw new BadRequestException(
          'Seule l’entrée d’un lot peut changer son numéro ou sa péremption',
        );
      }
      if (batch) {
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: {
            ...(patch.lotNumber !== undefined
              ? { lotNumber: patch.lotNumber }
              : {}),
            ...(patch.expiryDate !== undefined
              ? { expiryDate: patch.expiryDate }
              : {}),
            ...(patch.date && isEntry(row) ? { receivedDate: patch.date } : {}),
          },
        });
        const fresh = await tx.stockBatch.findUniqueOrThrow({
          where: { id: batch.id },
        });
        state.batches.set(fresh.id, fresh);
      }
    }
    if (
      !isEntry(row) &&
      row.stockBatchId &&
      CONSUMPTION_REASONS.includes(row.reason)
    ) {
      this.assertNotExpired(state.batches.get(row.stockBatchId), row.date);
    }

    await this.flush(tx, state);
    const after = await tx.stockMovement.findUniqueOrThrow({
      where: { id: movementId },
    });
    if (audit) {
      await this.log(
        tx,
        audit.ctx,
        'UPDATE',
        after.farmId,
        movementId,
        `${state.item.name} · ${after.type} ${after.quantity.toString()} ${state.item.unit}`,
        toAudit(before),
        toAudit(after),
      );
    }
    return { before, after };
  }

  async remove(
    tx: Tx,
    movementId: string,
    farmIds?: string[],
    audit?: { ctx: RequestContext },
  ): Promise<StockMovement> {
    const found = await this.findMovement(tx, movementId, farmIds);
    const pair = { farmId: found.farmId, stockItemId: found.stockItemId };
    const state = (await this.lockAndLoad(tx, [pair])).get(pairKey(pair))!;
    const row = state.rows.find((r) => r.id === movementId);
    if (!row) throw new BadRequestException(MOVEMENT_NOT_FOUND);
    const removed = await tx.stockMovement.findUniqueOrThrow({
      where: { id: movementId },
    });
    row.removed = true;
    await this.flush(tx, state);
    if (audit) {
      await this.log(
        tx,
        audit.ctx,
        'DELETE',
        removed.farmId,
        movementId,
        `${state.item.name} · ${removed.type} ${removed.quantity.toString()} ${state.item.unit}`,
        toAudit(removed),
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
    sourceType: string,
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
      select: { farmId: true, stockItemId: true },
    });
    if (found.length === 0) return [];
    const states = await this.lockAndLoad(tx, found);
    const removed: StockMovement[] = [];
    for (const state of states.values()) {
      for (const row of state.rows) {
        if (row.sourceType === sourceType && row.sourceId === sourceId) {
          row.removed = true;
        }
      }
    }
    // Everything is validated (replay of each history) before anything is written.
    for (const state of states.values()) this.validate(state);
    for (const state of states.values()) {
      const gone = state.rows.filter((r) => r.removed).map((r) => r.id);
      removed.push(
        ...(await tx.stockMovement.findMany({ where: { id: { in: gone } } })),
      );
      await this.flush(tx, state);
    }
    if (audit) {
      const first = removed[0];
      await this.log(
        tx,
        audit.ctx,
        'DELETE',
        first.farmId,
        sourceId,
        `Annulation ${sourceType} · ${removed.length} mouvement(s) de stock`,
        removed.map(toAudit),
      );
    }
    return removed;
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
      groups.set(k, [...(groups.get(k) ?? []), r]);
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
        note: r.note,
        createdById: r.createdById,
        fresh: false,
        removed: false,
        storedCost: r.unitCost,
        patch: {},
      })),
    };
  }

  private async findMovement(
    tx: Tx,
    id: string,
    farmIds?: string[],
  ): Promise<StockMovement> {
    const found = await tx.stockMovement.findFirst({
      where: { id, ...(farmIds ? { farmId: { in: farmIds } } : {}) },
    });
    if (!found) throw new NotFoundException(MOVEMENT_NOT_FOUND);
    return found;
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
    const pieces = quantity.gt(0)
      ? [{ batchId: raw.stockBatchId ?? null, quantity }]
      : this.allocate(state, raw, quantity.abs());
    return pieces.map((piece) => {
      const row: Work = {
        id: randomUUID(),
        farmId: raw.farmId,
        stockItemId: raw.stockItemId,
        stockBatchId: piece.batchId,
        date: raw.date,
        createdAt: new Date(state.next++),
        type: raw.type,
        quantity: piece.quantity,
        unitCost: piece.quantity.gt(0) ? unitCost : null,
        reason: raw.reason,
        sourceType: raw.sourceType ?? null,
        sourceId: raw.sourceId ?? null,
        note: raw.note ?? null,
        createdById: raw.userId,
        fresh: true,
        removed: false,
        storedCost: null,
        patch: {},
      };
      state.rows.push(row);
      return row;
    });
  }

  /** Where an exit of `needed` units on `raw.date` takes its stock from. */
  private allocate(
    state: State,
    raw: RecordInput,
    needed: Dec,
  ): { batchId: string | null; quantity: Dec }[] {
    const at = raw.date.getTime();
    const held = new Map<string | null, Dec>();
    for (const r of state.rows) {
      if (r.removed || r.date.getTime() > at) continue;
      held.set(
        r.stockBatchId,
        (held.get(r.stockBatchId) ?? ZERO).add(r.quantity),
      );
    }
    const total = [...held.values()].reduce((s, q) => s.add(q), ZERO);
    const consumption = CONSUMPTION_REASONS.includes(raw.reason);
    const short = (available: Dec) =>
      new BadRequestException(
        `${INSUFFICIENT} pour ${state.item.name} (disponible ${available.toString()} ${state.item.unit})`,
      );

    if (raw.stockBatchId) {
      const batch = state.batches.get(raw.stockBatchId)!;
      if (consumption) this.assertNotExpired(batch, raw.date);
      const available = held.get(batch.id) ?? ZERO;
      if (available.lt(needed)) throw short(available);
      return [{ batchId: batch.id, quantity: needed.neg() }];
    }

    const expired = (b: StockBatch) =>
      b.expiryDate !== null && b.expiryDate.getTime() < at;
    const withStock = [...state.batches.values()]
      .map((b) => ({ batch: b, quantity: held.get(b.id) ?? ZERO }))
      .filter((b) => b.quantity.gt(0));
    const byExpiry = (
      a: { batch: StockBatch },
      b: { batch: StockBatch },
    ): number =>
      (a.batch.expiryDate?.getTime() ?? Infinity) -
        (b.batch.expiryDate?.getTime() ?? Infinity) ||
      a.batch.receivedDate.getTime() - b.batch.receivedDate.getTime() ||
      a.batch.id.localeCompare(b.batch.id);
    const fresh = withStock.filter((b) => !expired(b.batch)).sort(byExpiry);
    const stale = withStock.filter((b) => expired(b.batch)).sort(byExpiry);
    const loose = held.get(null) ?? ZERO;
    const order: { batchId: string | null; quantity: Dec }[] = [
      ...fresh.map((b) => ({ batchId: b.batch.id, quantity: b.quantity })),
      { batchId: null, quantity: loose },
      ...(consumption
        ? []
        : stale.map((b) => ({ batchId: b.batch.id, quantity: b.quantity }))),
    ];
    const pieces: { batchId: string | null; quantity: Dec }[] = [];
    let remaining = needed;
    for (const source of order) {
      if (remaining.lte(0)) break;
      if (source.quantity.lte(0)) continue;
      const take = Prisma.Decimal.min(source.quantity, remaining);
      pieces.push({ batchId: source.batchId, quantity: take.neg() });
      remaining = remaining.sub(take);
    }
    if (remaining.gt(0)) {
      const usable = order.reduce(
        (s, o) => s.add(o.quantity.gt(0) ? o.quantity : ZERO),
        ZERO,
      );
      if (consumption && total.gte(needed)) {
        throw new BadRequestException(
          usable.gt(0) ? PARTLY_EXPIRED : EXPIRED_BATCH,
        );
      }
      throw short(total);
    }
    return pieces;
  }

  private assertNotExpired(batch: StockBatch | undefined, date: Date): void {
    if (batch?.expiryDate && batch.expiryDate.getTime() < date.getTime()) {
      throw new BadRequestException(EXPIRED_BATCH);
    }
  }

  /** Replays the live movements of a history; throws 400 when it dips below zero (item or batch). */
  private validate(state: State) {
    const live = state.rows.filter((r) => !r.removed);
    assertBucketsNonNegative(live);
    return replay(live);
  }

  /**
   * Validates the history, then writes the difference: removed rows deleted,
   * new rows created with their final cost, and only the rows whose fields or
   * cost changed updated. Returns the created rows by id.
   */
  private async flush(
    tx: Tx,
    state: State,
  ): Promise<Map<string, StockMovement>> {
    const { timeline } = this.validate(state);
    const created = new Map<string, StockMovement>();
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
