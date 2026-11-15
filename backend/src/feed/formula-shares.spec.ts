import { formulaShares } from './formula-shares';

const kg = (quantity: number, percentages: number[]) =>
  formulaShares(quantity, percentages).map(Number);
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100);

describe('formulaShares (largest remainder, 2 decimals)', () => {
  it('shares 10.01 kg between two halves without creating a hundredth', () => {
    expect(kg(10.01, [50, 50])).toEqual([5.01, 5]);
  });

  it('gives 0.01 kg to one ingredient of three thirds: the others get 0', () => {
    expect(kg(0.01, [33.33, 33.33, 33.34])).toEqual([0, 0, 0.01]);
    expect(kg(0.01, [33.33, 33.33, 33.33])).toEqual([0.01, 0, 0]);
  });

  it('normalises percentages that total 99.99 or 100.01', () => {
    expect(kg(100, [60, 39.99])).toEqual([60.01, 39.99]);
    expect(kg(100, [60, 40.01])).toEqual([59.99, 40.01]);
  });

  it('a single ingredient takes everything', () => {
    expect(kg(12.34, [100])).toEqual([12.34]);
  });

  it('always sums to the quantity and breaks ties in item order', () => {
    for (const q of [0.01, 0.07, 1, 9.99, 10.01, 333.33, 1000]) {
      for (const pcts of [
        [50, 50],
        [33.33, 33.33, 33.34],
        [25, 25, 25, 25],
        [70, 30],
        [0.01, 99.99],
      ]) {
        const shares = kg(q, pcts);
        expect(sum(shares)).toBe(Math.round(q * 100));
        expect(shares.every((s) => s >= 0)).toBe(true);
      }
    }
    expect(kg(0.02, [25, 25, 25, 25])).toEqual([0.01, 0.01, 0, 0]);
  });
});
