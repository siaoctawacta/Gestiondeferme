import { Decimal } from '@prisma/client/runtime/client';

/**
 * The lowest the running balance gets: `start`, then each of `deltas` (signed,
 * in the order they happen) added in turn. What a sale dated at the start can
 * take without leaving any later day negative is this minimum (one rule for
 * lots, eggs' sibling `eggAvailable` and stock).
 */
export function lowestBalance(
  start: Decimal.Value,
  deltas: Decimal.Value[],
): Decimal {
  let balance = new Decimal(start);
  let lowest = balance;
  for (const delta of deltas) {
    balance = balance.add(delta);
    if (balance.lt(lowest)) lowest = balance;
  }
  return lowest;
}
