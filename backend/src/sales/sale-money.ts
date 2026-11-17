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
 *
 * The same definition is written in SQL in `receivablesTotal`
 * (receivables.ts: `GREATEST(0, net - paid + refunded)`): change both together.
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

type Credited = { quantity: Decimal; amount: Decimal };

/**
 * What is still creditable on a line after the credit notes already made: the
 * quantity and the amount left (never negative).
 */
export function creditable(
  line: { quantity: Decimal; amount: Decimal },
  already: Credited,
): Credited {
  const zero = new Decimal(0);
  return {
    quantity: Decimal.max(zero, line.quantity.sub(already.quantity)),
    amount: Decimal.max(zero, line.amount.sub(already.amount)),
  };
}

/**
 * The amount credited for `quantity` of an invoice line, given what earlier
 * credit notes already took. The credit note that completes the line's
 * quantity takes exactly what is left of the line's amount, so the parts
 * always add up to the line (2.5 × 333.33 = 833.33 is credited 416.66 then
 * 416.67, never 416.66 twice). A partial credit is the line rate rounded, but
 * never more than what is left, so a line that rounds to almost nothing can
 * neither be over-credited nor give a negative amount.
 */
export function creditLineAmount(
  line: { quantity: Decimal; unitPrice: Decimal; amount: Decimal },
  already: Credited,
  quantity: Decimal,
): Decimal {
  if (quantity.lte(0)) {
    throw new RangeError('La quantité à créditer doit être positive');
  }
  if (already.quantity.add(quantity).gt(line.quantity)) {
    throw new RangeError('La quantité dépasse celle de la ligne');
  }
  const left = creditable(line, already).amount;
  return already.quantity.add(quantity).eq(line.quantity)
    ? left
    : Decimal.min(lineAmount(quantity, line.unitPrice), left);
}
