import { Decimal } from '@prisma/client/runtime/client';

type Dec = Decimal;

/**
 * Splits `quantityKg` (2 decimals) between the ingredients of a formula, in
 * hundredths of a kg, so the shares add up to the quantity exactly: percentages
 * are normalised by their total, each share is rounded down, and the leftover
 * hundredths go to the largest remainders (ties: item order). A share of 0
 * moves no stock and costs nothing, which is then exact.
 */
export function formulaShares(
  quantityKg: Decimal.Value,
  percentages: Decimal.Value[],
): Dec[] {
  const total = percentages.reduce<Dec>((sum, p) => sum.add(p), new Decimal(0));
  const hundredths = new Decimal(quantityKg).mul(100).round();
  const exact = percentages.map((p) =>
    total.isZero() ? new Decimal(0) : hundredths.mul(p).div(total),
  );
  const floors = exact.map((e) => e.floor());
  let residual = hundredths.sub(
    floors.reduce((s, f) => s.add(f), new Decimal(0)),
  );
  const byRemainder = exact
    .map((e, index) => ({ index, remainder: e.sub(e.floor()) }))
    .sort((a, b) => b.remainder.cmp(a.remainder) || a.index - b.index);
  for (const { index } of byRemainder) {
    if (residual.lte(0)) break;
    floors[index] = floors[index].add(1);
    residual = residual.sub(1);
  }
  return floors.map((f) => f.div(100));
}
