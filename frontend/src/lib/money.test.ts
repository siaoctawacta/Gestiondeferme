import { describe, expect, it } from 'vitest';
import { lineAmount, linesTotal, sumAmounts } from './money';

describe('money', () => {
  it('rounds a line on its own', () => {
    expect(lineAmount(3, 1.1)).toBe(3.3);
    expect(lineAmount(2.5, 333.33)).toBe(833.33);
  });

  it('sums the rounded lines, not the rounding of the sum', () => {
    // 0.333 × 1 rounds to 0.33 three times: 0.99, where the sum rounded once would be 1.
    expect(linesTotal([{ quantity: '1', unitPrice: '0.333' }, { quantity: '1', unitPrice: '0.333' }, { quantity: '1', unitPrice: '0.333' }])).toBe(0.99);
    expect(linesTotal([{ quantity: '', unitPrice: '10' }, {}])).toBe(0);
  });

  it('equals the API (Decimal, half away from zero) on two-decimal inputs', () => {
    expect(lineAmount(0.7, 12.25)).toBe(8.58);
    expect(lineAmount(3, 1.1)).toBe(3.3);
    expect(lineAmount(2800.5, 310.1)).toBe(868435.05);
    expect(lineAmount(0.5, 0.05)).toBe(0.03);
    expect(lineAmount(1.005, 1)).toBe(1);
    expect(lineAmount(-2.5, 333.33)).toBe(-833.33);
  });

  it('sums in cents: 0.5 × 0.05 twice is 0.06', () => {
    const row = { quantity: '0.5', unitPrice: '0.05' };
    expect(linesTotal([row, row])).toBe(0.06);
    expect(linesTotal([{ quantity: '2.5', unitPrice: '333.33' }, { quantity: '0.7', unitPrice: '12.25' }])).toBe(841.91);
  });

  it('stays exact for large values (guaranteed while the amount stays under 2^53 / 100, about 9 × 10^13)', () => {
    expect(lineAmount(999999.99, 999999.99)).toBe(999999980000);
    expect(lineAmount(123456.78, 87654.32)).toBe(10821520100.29);
    expect(linesTotal([{ quantity: '999999.99', unitPrice: '999999.99' }, { quantity: '999999.99', unitPrice: '999999.99' }])).toBe(1999999960000);
  });

  it('counts a missing or non-finite input as 0', () => {
    expect(lineAmount(NaN, 5)).toBe(0);
    expect(lineAmount(3, Infinity)).toBe(0);
    expect(linesTotal([{ quantity: 'abc', unitPrice: '5' }])).toBe(0);
  });
});

describe('sumAmounts', () => {
  it('sums amounts in integer cents (no float drift)', () => {
    expect(sumAmounts([416.66, 416.67])).toBe(833.33);
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([])).toBe(0);
  });
});
