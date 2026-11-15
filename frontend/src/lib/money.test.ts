import { describe, expect, it } from 'vitest';
import { lineAmount, linesTotal } from './money';

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
});
