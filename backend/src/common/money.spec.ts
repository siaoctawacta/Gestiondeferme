import { Decimal } from '@prisma/client/runtime/client';
import {
  lineAmount,
  linesAmount,
  remainingOf,
  sumAmounts,
  toMoney,
} from './money';

describe('money', () => {
  it('rounds each line to 2 decimals', () => {
    expect(lineAmount(3, 1.1).toString()).toBe('3.3');
    expect(lineAmount(2800.5, 310.1).toString()).toBe('868435.05');
    expect(lineAmount('0.333', '3').toString()).toBe('1');
    expect(lineAmount(1, '0.005').toString()).toBe('0.01');
  });

  it('sums rounded lines, using the received quantity once there is one', () => {
    const lines = [
      { quantity: 3, receivedQuantity: null, unitPrice: 1.1 },
      { quantity: 3000, receivedQuantity: 2800.5, unitPrice: 310.1 },
    ];
    expect(linesAmount(lines).toString()).toBe('868438.35');
    expect(
      linesAmount([
        { quantity: 10, receivedQuantity: 0, unitPrice: 5 },
      ]).toString(),
    ).toBe('0');
  });

  it('computes the remaining amount exactly, never below zero', () => {
    expect(remainingOf(0.3, [0.1, 0.2]).toString()).toBe('0');
    expect(remainingOf(930000, [500000]).toString()).toBe('430000');
    expect(remainingOf(10, [20]).toString()).toBe('0');
  });

  it('rounds a half away from zero on the line, so 2.5 × 333.33 is 833.33', () => {
    expect(lineAmount(2.5, 333.33).toString()).toBe('833.33');
  });

  it('sums rounded lines, never rounds the raw sum: 0.5 × 0.05 twice is 0.06', () => {
    const lines = [0.5, 0.5].map((q) => ({
      quantity: q,
      receivedQuantity: null,
      unitPrice: 0.05,
    }));
    expect(linesAmount(lines).toString()).toBe('0.06');
  });

  it('settles exactly: 930 000 paid in two parts leaves nothing', () => {
    expect(remainingOf(930000, [500000, 430000]).toString()).toBe('0');
  });

  it('adds already-rounded amounts exactly', () => {
    expect(
      sumAmounts([new Decimal('0.1'), new Decimal('0.2')]).toString(),
    ).toBe('0.3');
    expect(sumAmounts([]).toString()).toBe('0');
  });

  it('converts an amount to a number at the API edge only', () => {
    expect(toMoney(new Decimal('868435.05'))).toBe(868435.05);
    expect(toMoney(new Decimal(0))).toBe(0);
  });
});
