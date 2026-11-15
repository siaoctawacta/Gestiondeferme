import { Decimal } from '@prisma/client/runtime/client';
import { lineAmount, sumAmounts } from '../common/money';

type Num = number | string | Decimal;

/** The total of a document: the sum of its ROUNDED lines (never the rounded sum of quantity × price). */
export const documentTotal = (
  lines: { quantity: Num; unitPrice: Num }[],
): Decimal => sumAmounts(lines.map((l) => lineAmount(l.quantity, l.unitPrice)));

/**
 * What an invoice is worth now: `net` (after credit notes), `due` (still to
 * collect) and `refundDue` (collected beyond the net and not yet given back).
 */
export function balanceOf(b: {
  total: Decimal;
  credited: Decimal;
  paid: Decimal;
  refunded: Decimal;
}): { net: Decimal; due: Decimal; refundDue: Decimal } {
  const net = b.total.sub(b.credited);
  const zero = new Decimal(0);
  return {
    net,
    due: Decimal.max(zero, net.sub(b.paid).add(b.refunded)),
    refundDue: Decimal.max(zero, b.paid.sub(b.refunded).sub(net)),
  };
}

/**
 * The amount credited for `quantity` of an invoice line, given what earlier
 * credit notes already took. Part of a line is credited at the line rate;
 * the credit note that completes the line takes exactly what is left of the
 * line's amount, so the parts always add up to the line (2.5 × 333.33 = 833.33
 * is credited 416.66 then 416.67, never 416.66 twice).
 */
export function creditLineAmount(
  line: { quantity: Decimal; unitPrice: Decimal; amount: Decimal },
  already: { quantity: Decimal; amount: Decimal },
  quantity: Decimal,
): Decimal {
  if (quantity.lte(0)) {
    throw new RangeError('La quantité à créditer doit être positive');
  }
  const total = already.quantity.add(quantity);
  if (total.gt(line.quantity)) {
    throw new RangeError('La quantité dépasse celle de la ligne');
  }
  return total.eq(line.quantity)
    ? line.amount.sub(already.amount)
    : lineAmount(quantity, line.unitPrice);
}
