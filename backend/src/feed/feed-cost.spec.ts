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
const exit = (operationId: string, quantity: number, unitCost: number) => ({
  sourceId: 'd1',
  operationId,
  quantity: D(quantity),
  unitCost: D(unitCost),
});

describe('currentCost', () => {
  it('shows the snapshot when the ledger holds no exit for the distribution', () => {
    expect(currentCost(row(), [])).toEqual({ cost: D(7000), unitCost: D(70) });
  });

  it('sums the exits as the ledger now values them, an operation split across lots rounded once', () => {
    const r = currentCost(row(), [
      exit('op', -30, 100.005),
      exit('op', -30, 100.005),
      exit('other', -40, 50),
    ]);
    // op: 60 x 100.005 = 6000.30; other: 2000.
    expect(r.cost.toNumber()).toBe(8000.3);
    expect(r.unitCost.toNumber()).toBe(80);
  });

  it('adds the part the ledger does not value', () => {
    const r = currentCost(row({ unlinkedCost: D('2000.5') }), [
      exit('op', -60, 100),
    ]);
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
