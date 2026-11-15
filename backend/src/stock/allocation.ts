import { Decimal } from '@prisma/client/runtime/client';
import { byReplayOrder } from './valuation';

const ZERO = new Decimal(0);

/** A live movement of one (farm, item) history, reduced to what allocation needs. */
export interface AllocRow {
  id?: string;
  date: Date;
  createdAt: Date;
  stockBatchId: string | null;
  /** Signed. */
  quantity: Decimal;
}

export interface AllocBatch {
  id: string;
  expiryDate: Date | null;
  receivedDate: Date;
}

export interface Piece {
  /** null: stock held in no batch. */
  batchId: string | null;
  /** Negative. */
  quantity: Decimal;
}

/** Why an exit cannot be served; the ledger turns it into the 400 message. */
export class AllocationError extends Error {
  constructor(
    readonly kind: 'SHORT' | 'EXPIRED' | 'PARTLY_EXPIRED',
    /** What could have been taken, all lots counted. */
    readonly available: Decimal,
  ) {
    super(kind);
  }
}

/**
 * What each bucket (a lot, or `null` for stock held in no lot) can give to an
 * exit placed at the end of `date`: its lowest running balance from that point
 * to the end of the history. Taking more than that would drive the bucket
 * negative at a later movement (a later exit that already emptied the lot).
 */
export function headrooms(
  rows: AllocRow[],
  date: Date,
): Map<string | null, Decimal> {
  const balance = new Map<string | null, Decimal>();
  const lowest = new Map<string | null, Decimal>();
  const ordered = [...rows].sort(byReplayOrder);
  for (const r of ordered) {
    const next = (balance.get(r.stockBatchId) ?? ZERO).add(r.quantity);
    balance.set(r.stockBatchId, next);
    if (r.date.getTime() <= date.getTime()) {
      lowest.set(r.stockBatchId, next);
    } else {
      const low = lowest.get(r.stockBatchId) ?? ZERO;
      // The first later movement of a bucket starts from the balance at `date`.
      lowest.set(r.stockBatchId, Decimal.min(low, next));
    }
  }
  const result = new Map<string | null, Decimal>();
  for (const [k, v] of lowest) result.set(k, v.lt(0) ? ZERO : v);
  return result;
}

/**
 * Splits an exit of `needed` units at `date` across the lots. Lots are served
 * earliest expiry first (no expiry last), then the stock held in no lot. A
 * consumption never touches an expired lot (expiry before `date`); any other
 * exit writes expired lots off first. `batchId` names the only lot to use;
 * `prefer` a lot to serve first. Each bucket gives at most its headroom.
 */
export function allocateExit(opts: {
  rows: AllocRow[];
  batches: AllocBatch[];
  date: Date;
  needed: Decimal;
  consumption: boolean;
  batchId?: string | null;
  prefer?: string | null;
}): Piece[] {
  const { rows, batches, date, needed, consumption } = opts;
  const room = headrooms(rows, date);
  const roomOf = (id: string | null) => room.get(id) ?? ZERO;
  const expired = (b: AllocBatch) =>
    b.expiryDate !== null && b.expiryDate.getTime() < date.getTime();

  if (opts.batchId) {
    const batch = batches.find((b) => b.id === opts.batchId);
    const available = roomOf(opts.batchId);
    if (consumption && batch && expired(batch)) {
      throw new AllocationError('EXPIRED', available);
    }
    if (available.lt(needed)) throw new AllocationError('SHORT', available);
    return [{ batchId: opts.batchId, quantity: needed.neg() }];
  }

  const byExpiry = (a: AllocBatch, b: AllocBatch): number =>
    (a.expiryDate?.getTime() ?? Infinity) -
      (b.expiryDate?.getTime() ?? Infinity) ||
    a.receivedDate.getTime() - b.receivedDate.getTime() ||
    a.id.localeCompare(b.id);
  const live = batches.filter((b) => roomOf(b.id).gt(0));
  const fresh = live.filter((b) => !expired(b)).sort(byExpiry);
  const stale = live.filter(expired).sort(byExpiry);
  const sequence: (string | null)[] = [
    ...(consumption ? [] : stale.map((b) => b.id)),
    ...fresh.map((b) => b.id),
    null,
  ];
  if (opts.prefer && sequence.includes(opts.prefer)) {
    sequence.splice(sequence.indexOf(opts.prefer), 1);
    sequence.unshift(opts.prefer);
  }

  const pieces: Piece[] = [];
  let remaining = needed;
  for (const id of sequence) {
    if (remaining.lte(0)) break;
    const take = Decimal.min(roomOf(id), remaining);
    if (take.lte(0)) continue;
    pieces.push({ batchId: id, quantity: take.neg() });
    remaining = remaining.sub(take);
  }
  if (remaining.gt(0)) {
    const everything = [...room.values()].reduce((s, q) => s.add(q), ZERO);
    if (consumption && everything.gte(needed)) {
      const usable = [...fresh.map((b) => b.id), null].reduce(
        (s, id) => s.add(roomOf(id)),
        ZERO,
      );
      throw new AllocationError(
        usable.gt(0) ? 'PARTLY_EXPIRED' : 'EXPIRED',
        everything,
      );
    }
    throw new AllocationError('SHORT', everything);
  }
  return pieces;
}
