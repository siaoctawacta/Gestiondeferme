import { Decimal } from '@prisma/client/runtime/client';
import {
  balanceOf,
  creditable,
  creditLineAmount,
  documentTotal,
} from './sale-money';

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

describe('credit of a line that rounds to almost nothing', () => {
  // 0.04 × 0.55 = 0.022 -> a line of 0.02; 0.01 × 0.55 = 0.0055 -> 0.01 each time.
  const line = { quantity: D(0.04), unitPrice: D(0.55), amount: D(0.02) };

  it('never credits more than is left of the line, nor a negative amount', () => {
    let already = { quantity: D(0), amount: D(0) };
    const credited: string[] = [];
    for (let i = 0; i < 4; i++) {
      const amount = creditLineAmount(line, already, D(0.01));
      credited.push(amount.toString());
      already = {
        quantity: already.quantity.add(0.01),
        amount: already.amount.add(amount),
      };
    }
    expect(credited).toEqual(['0.01', '0.01', '0', '0']);
    expect(already.amount.toString()).toBe('0.02');
  });

  it('caps a partial credit at the amount left, and the completing one takes exactly that', () => {
    const l = { quantity: D(3), unitPrice: D(0.33), amount: D(0.99) };
    // Earlier credits were rounded up: 1 + 1 credited 0.34 + 0.34, 0.32 is left for the last unit.
    const already = { quantity: D(2), amount: D(0.68) };
    expect(creditLineAmount(l, already, D(1)).toString()).toBe('0.31');
    expect(
      creditLineAmount(l, { quantity: D(1), amount: D(0.98) }, D(1)).toString(),
    ).toBe('0.01');
    expect(
      creditLineAmount(l, { quantity: D(1), amount: D(0.98) }, D(1)).gte(0),
    ).toBe(true);
  });
});

describe('creditable', () => {
  const line = { quantity: D(2.5), amount: D(833.33) };

  it('is the whole line before any credit note', () => {
    const c = creditable(line, { quantity: D(0), amount: D(0) });
    expect(c.quantity.toString()).toBe('2.5');
    expect(c.amount.toString()).toBe('833.33');
  });

  it('is what is left after earlier credit notes', () => {
    const c = creditable(line, { quantity: D(1.25), amount: D(416.66) });
    expect(c.quantity.toString()).toBe('1.25');
    expect(c.amount.toString()).toBe('416.67');
  });

  it('is nothing once the line is fully credited, never negative', () => {
    const c = creditable(line, { quantity: D(2.5), amount: D(833.33) });
    expect(c.quantity.toString()).toBe('0');
    expect(c.amount.toString()).toBe('0');
    const over = creditable(line, { quantity: D(3), amount: D(900) });
    expect(over.quantity.toString()).toBe('0');
    expect(over.amount.toString()).toBe('0');
  });
});
