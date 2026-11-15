export const STOCK_LEVELS = ['ok', 'faible', 'critique'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];

type Num = number | { toNumber(): number };
const n = (v: Num): number => (typeof v === 'number' ? v : v.toNumber());

/**
 * Below the minimum is `faible`, below half of it (or empty) `critique`;
 * exactly the minimum is `ok`, exactly half of it `faible`. No minimum, no alert.
 */
export function stockLevel(quantity: Num, minQty: Num): StockLevel {
  const q = n(quantity);
  const min = n(minQty);
  if (min <= 0) return 'ok';
  if (q <= 0 || q < min / 2) return 'critique';
  return q < min ? 'faible' : 'ok';
}

/** The level shown for several farms: the most severe. */
export function worstLevel(levels: StockLevel[]): StockLevel {
  return levels.reduce<StockLevel>(
    (worst, l) =>
      STOCK_LEVELS.indexOf(l) > STOCK_LEVELS.indexOf(worst) ? l : worst,
    'ok',
  );
}

export const EXPIRY_STATUSES = ['ok', 'soon', 'expired'] as const;
export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number];

/**
 * The one rule for a lot's expiry, shared by the alerts and the stock screens:
 * `expired` when its expiry day is before today, `soon` from today up to and
 * including `warningDays` days ahead, `ok` beyond that or with no expiry date.
 * `daysLeft` is the signed number of whole days from today to the expiry day
 * (null: no expiry date).
 */
export function expiryStatus(
  daysLeft: number | null,
  warningDays: number,
): ExpiryStatus {
  if (daysLeft === null) return 'ok';
  if (daysLeft < 0) return 'expired';
  return daysLeft <= warningDays ? 'soon' : 'ok';
}
