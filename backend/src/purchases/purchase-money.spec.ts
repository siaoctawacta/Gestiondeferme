import { lineAmount, linesAmount, remainingOf } from './purchase-money';

describe('purchase money', () => {
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
});
