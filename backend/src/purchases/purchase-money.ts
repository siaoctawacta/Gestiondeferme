import { Decimal } from '@prisma/client/runtime/client';

type Dec = Decimal;
type Num = number | string | Dec;

const D = (v: Num): Dec => new Decimal(v);

/** One line: quantity × unit price, rounded to 2 decimals (the screens round per line, then sum). */
export const lineAmount = (quantity: Num, unitPrice: Num): Dec =>
  D(quantity).mul(D(unitPrice)).toDecimalPlaces(2);

interface Priced {
  quantity: Num;
  receivedQuantity: Num | null;
  unitPrice: Num;
}

/** Σ of the rounded lines; a line counts at its received quantity once the purchase is received. */
export const linesAmount = (lines: Priced[]): Dec =>
  lines.reduce(
    (sum, l) =>
      sum.add(lineAmount(l.receivedQuantity ?? l.quantity, l.unitPrice)),
    D(0),
  );

/** What is still to pay, exact to the cent and never negative. */
export const remainingOf = (amount: Num, payments: Num[]): Dec => {
  const left = D(amount).sub(payments.reduce<Dec>((s, p) => s.add(D(p)), D(0)));
  return left.isNeg() ? D(0) : left;
};
