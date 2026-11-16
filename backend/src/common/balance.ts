import { Decimal } from '@prisma/client/runtime/client';

/**
 * The lowest the running balance gets: `start`, then each of `deltas` (signed,
 * in the order they happen) added in turn. What a sale dated at the start can
 * take without leaving any later day negative is this minimum: the rule of the
 * headcount of a lot (`HerdLedgerService.availableAt`). Eggs apply the same
 * idea day by day (`eggShortfall`, `eggAvailable`) and stock per lot
 * (`headrooms`): they have their own pure functions, not this one.
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
