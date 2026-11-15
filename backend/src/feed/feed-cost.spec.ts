import { Decimal } from '@prisma/client/runtime/client';
import { assertCostFits, currentCost, type CostRow } from './feed-cost';

const D = (v: number | string) => new Decimal(v);

const row = (over: Partial<CostRow> = {}): CostRow => ({
  id: 'd1',
  quantityKg: D(100),
  unitCost: D(70),
  cost: D(7000),
  unlinkedCost: D(0),
  ...over,
});

describe('currentCost', () => {
  it('shows the snapshot when the ledger holds no exit for the distribution', () => {
    expect(currentCost(row(), undefined)).toEqual({
      cost: D(7000),
      unitCost: D(70),
    });
  });

  it('takes the ledger cost of the exits and divides it by the quantity', () => {
    const r = currentCost(row(), D('8000.3'));
    expect(r.cost.toNumber()).toBe(8000.3);
    expect(r.unitCost.toNumber()).toBe(80);
  });

  it('adds the part the ledger does not value', () => {
    const r = currentCost(row({ unlinkedCost: D('2000.5') }), D(6000));
    expect(r.cost.toNumber()).toBe(8000.5);
  });
});

describe('assertCostFits', () => {
  it('accepts the largest cost of the column and refuses the next one', () => {
    expect(() => assertCostFits(D('999999999999.99'))).not.toThrow();
    expect(() => assertCostFits(D('1000000000000'))).toThrow(
      'Le coût de la distribution est trop élevé',
    );
  });
});
