/**
 * The money of a document line, shared by purchases and sales: a line is rounded on its own, a total is the sum of the
 * rounded lines (never the rounding of the sum), like the API. These are LIVE PREVIEWS for forms; a saved document shows
 * the amounts the API stored.
 *
 * Exact like the API's Decimal (half away from zero) for quantities and prices of at most 2 decimals: both are scaled
 * to integers, multiplied as BigInt, and rounded at the cent. Guaranteed while a line amount stays under 2^53 / 100
 * (about 9 × 10^13 FCFA); a non-finite input counts as 0.
 */

/** A number of at most 2 decimals as integer hundredths; 0 for NaN / Infinity. */
const hundredths = (value: number): bigint => (Number.isFinite(value) ? BigInt(Math.round(value * 100)) : 0n);

/** Amount of one line in cents: quantity × unit price, half away from zero. */
function lineCents(quantity: number, unitPrice: number): number {
  const product = hundredths(quantity) * hundredths(unitPrice); // in 10^-4
  const half = product < 0n ? -50n : 50n;
  return Number((product + half) / 100n);
}

/** Amount of one line: quantity × unit price, rounded to 2 decimals (`3 × 1.1` is `3.3`, `0.7 × 12.25` is `8.58`). */
export const lineAmount = (quantity: number, unitPrice: number): number => lineCents(quantity, unitPrice) / 100;

/** Σ of the rounded line amounts of rows as edited (empty cells count as 0), summed in integer cents. */
export const linesTotal = (rows: { quantity?: string; unitPrice?: string }[]): number =>
  rows.reduce((sum, r) => sum + lineCents(Number(r.quantity || 0), Number(r.unitPrice || 0)), 0) / 100;

/** Σ of amounts already rounded to cents, summed in integer cents (no float drift: `0.1 + 0.2` is `0.3`). */
export const sumAmounts = (amounts: number[]): number => amounts.reduce((sum, a) => sum + (Number.isFinite(a) ? Math.round(a * 100) : 0), 0) / 100;
