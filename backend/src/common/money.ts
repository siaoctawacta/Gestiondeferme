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

/** Σ of amounts that are already rounded (line amounts): exact, no rounding of its own. */
export const sumAmounts = (amounts: Dec[]): Dec =>
  amounts.reduce<Dec>((sum, a) => sum.add(a), D(0));

/** Σ of the rounded lines; a line counts at its received quantity once the purchase is received. */
export const linesAmount = (lines: Priced[]): Dec =>
  sumAmounts(
    lines.map((l) => lineAmount(l.receivedQuantity ?? l.quantity, l.unitPrice)),
  );

/** What is still to pay, exact to the cent and never negative. */
export const remainingOf = (amount: Num, payments: Num[]): Dec => {
  const left = D(amount).sub(sumAmounts(payments.map(D)));
  return left.isNeg() ? D(0) : left;
};

/** The ONLY Decimal → number conversion of an amount: at the API edge, never in between. */
export const toMoney = (amount: Dec): number => amount.toNumber();

/** A fresh zero amount. */
export const zero = (): Dec => D(0);
