/**
 * The money of a document line, shared by purchases and sales: a line is rounded on its own, a total is the sum of the
 * rounded lines (never the rounding of the sum), like the API.
 */

/** Amount of one line: quantity × unit price, rounded to 2 decimals (`3 × 1.1` is `3.3`, not `3.3000000000000003`). */
export const lineAmount = (quantity: number, unitPrice: number): number =>
  Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;

/** Σ of the rounded line amounts of rows as edited (empty cells count as 0). */
export const linesTotal = (rows: { quantity?: string; unitPrice?: string }[]): number =>
  Math.round(rows.reduce((sum, r) => sum + lineAmount(Number(r.quantity || 0), Number(r.unitPrice || 0)), 0) * 100) / 100;
