import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { StockMovementType } from '../generated/prisma/enums';

export const INSUFFICIENT = 'Stock insuffisant';

/** The running quantity (of an item, or of one of its batches) would dip below zero. */
export class InsufficientStock extends BadRequestException {
  constructor(article?: string) {
    super(article ? `${INSUFFICIENT} pour ${article}` : INSUFFICIENT);
  }
}

export interface ReplayMovement {
  id?: string;
  date: Date;
  createdAt: Date;
  type: StockMovementType;
  /** Signed: positive in, negative out. */
  quantity: Decimal;
  /**
   * The cost of an entry. `null` on a positive adjustment means "value it at
   * the running average" (0 when there is none). Ignored on exits: they are
   * always valued at the running average.
   */
  unitCost: Decimal | null;
}

export interface TimelineStep<T extends ReplayMovement> {
  movement: T;
  /** The cost this movement carries: its own for an entry, the running average for an exit. */
  unitCost: Decimal;
  quantityAfter: Decimal;
}

export interface Replay<T extends ReplayMovement> {
  quantity: Decimal;
  averageCost: Decimal;
  /** The steps in replay order. */
  timeline: TimelineStep<T>[];
}

/** Replay order: date, then creation time, then id. */
export function byReplayOrder(
  a: { date: Date; createdAt: Date; id?: string },
  b: { date: Date; createdAt: Date; id?: string },
): number {
  return (
    a.date.getTime() - b.date.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id ?? '').localeCompare(b.id ?? '')
  );
}

const ZERO = new Decimal(0);

/**
 * Replays the history of one (farm, item): entries move the weighted-average
 * cost, exits are valued at the running average and leave it alone. Throws
 * `InsufficientStock` as soon as the running quantity dips below zero, even if
 * a later entry would bring it back. A read (`strict: false`) never throws: it
 * reports what the history adds up to, so a damaged history cannot turn a
 * page into a 500.
 */
export function replay<T extends ReplayMovement>(
  movements: T[],
  { strict = true }: { strict?: boolean } = {},
): Replay<T> {
  let quantity = ZERO;
  let average = ZERO;
  const timeline: TimelineStep<T>[] = [];
  for (const movement of [...movements].sort(byReplayOrder)) {
    let unitCost: Decimal;
    if (movement.quantity.gt(0)) {
      // A cost left to the average is frozen at 2 decimals, as it is stored.
      unitCost = movement.unitCost ?? average.toDecimalPlaces(2);
      const total = quantity.add(movement.quantity);
      // Only a lenient read of a damaged history can reach a total at or below 0.
      average = total.gt(0)
        ? quantity.mul(average).add(movement.quantity.mul(unitCost)).div(total)
        : unitCost;
      quantity = total;
    } else {
      unitCost = average;
      quantity = quantity.add(movement.quantity);
      if (strict && quantity.lt(0)) throw new InsufficientStock();
    }
    timeline.push({ movement, unitCost, quantityAfter: quantity });
  }
  return { quantity, averageCost: average, timeline };
}

/**
 * The quantity of each bucket (a batch, or the stock held in no batch) may
 * never dip below zero either: an exit names the batch it takes from. The
 * refusal names the article.
 */
export function assertBucketsNonNegative(
  movements: (ReplayMovement & { stockBatchId: string | null })[],
  article: string,
): void {
  const balance = new Map<string | null, Decimal>();
  for (const m of [...movements].sort(byReplayOrder)) {
    const next = (balance.get(m.stockBatchId) ?? ZERO).add(m.quantity);
    if (next.lt(0)) throw new InsufficientStock(article);
    balance.set(m.stockBatchId, next);
  }
}
