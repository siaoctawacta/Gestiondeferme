import { Decimal } from '@prisma/client/runtime/client';
import { balanceOf, creditLineAmount, documentTotal } from './sale-money';

const D = (v: number | string) => new Decimal(v);

describe('sale money', () => {
  it('totals the rounded lines, never the rounded sum of quantity × price', () => {
    expect(
      documentTotal([
        { quantity: 300, unitPrice: 3500 },
        { quantity: 10, unitPrice: 2500 },
      ]).toString(),
    ).toBe('1075000');
    // 0.005 × 3 lines: each rounds to 0.01, so the total is 0.03, not round(0.015) = 0.02.
    expect(
      documentTotal([
        { quantity: 1, unitPrice: '0.005' },
        { quantity: 1, unitPrice: '0.005' },
        { quantity: 1, unitPrice: '0.005' },
      ]).toString(),
    ).toBe('0.03');
    expect(documentTotal([]).toString()).toBe('0');
  });

  describe('balanceOf', () => {
    it('is what is left to pay', () => {
      const b = balanceOf({
        total: D(1000000),
        credited: D(0),
        paid: D(600000),
        refunded: D(0),
      });
      expect(b.net.toString()).toBe('1000000');
      expect(b.due.toString()).toBe('400000');
      expect(b.refundDue.toString()).toBe('0');
    });

    it('turns an overpayment after a credit note into an amount to refund', () => {
      const b = balanceOf({
        total: D(1050000),
        credited: D(105000),
        paid: D(1050000),
        refunded: D(0),
      });
      expect(b.net.toString()).toBe('945000');
      expect(b.due.toString()).toBe('0');
      expect(b.refundDue.toString()).toBe('105000');
      const after = balanceOf({
        total: D(1050000),
        credited: D(105000),
        paid: D(1050000),
        refunded: D(105000),
      });
      expect(after.due.toString()).toBe('0');
      expect(after.refundDue.toString()).toBe('0');
    });

    it('never goes below zero on either side', () => {
      const b = balanceOf({
        total: D(100),
        credited: D(100),
        paid: D(0),
        refunded: D(0),
      });
      expect(b.due.toString()).toBe('0');
      expect(b.refundDue.toString()).toBe('0');
    });
  });

  describe('creditLineAmount', () => {
    const line = { quantity: D(2.5), unitPrice: D(333.33), amount: D(833.33) };

    it('credits a part at the line rate, then the exact remainder of the line', () => {
      const first = creditLineAmount(
        line,
        { quantity: D(0), amount: D(0) },
        D(1.25),
      );
      expect(first.toString()).toBe('416.66');
      const second = creditLineAmount(
        line,
        { quantity: D(1.25), amount: first },
        D(1.25),
      );
      expect(second.toString()).toBe('416.67');
      expect(first.add(second).toString()).toBe('833.33');
    });

    it('credits a whole line at its stored amount', () => {
      expect(
        creditLineAmount(
          line,
          { quantity: D(0), amount: D(0) },
          D(2.5),
        ).toString(),
      ).toBe('833.33');
    });

    it('refuses to go over the line', () => {
      expect(() =>
        creditLineAmount(line, { quantity: D(0), amount: D(0) }, D(3)),
      ).toThrow();
      expect(() =>
        creditLineAmount(
          line,
          { quantity: D(1.25), amount: D(416.66) },
          D(1.5),
        ),
      ).toThrow();
    });

    it('refuses a quantity that is not above zero', () => {
      expect(() =>
        creditLineAmount(line, { quantity: D(0), amount: D(0) }, D(0)),
      ).toThrow();
    });
  });
});
