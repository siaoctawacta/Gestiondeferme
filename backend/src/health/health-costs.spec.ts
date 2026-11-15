import { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import { LotCostRegistry } from '../indicators/lot-cost';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthCosts } from './health-costs';

// The real service pulls in the Prisma client; only the queries matter here.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const D = (v: number | string) => new Decimal(v);
const exit = (
  sourceId: string,
  operationId: string,
  q: number,
  cost: number,
) => ({
  sourceId,
  operationId,
  quantity: D(q),
  unitCost: D(cost),
});

const fake = (
  acts: { id: string; batchId: string | null }[],
  exits: ReturnType<typeof exit>[],
) => {
  const client = {
    healthAct: { findMany: jest.fn().mockResolvedValue(acts) },
    stockMovement: { findMany: jest.fn().mockResolvedValue(exits) },
  };
  return client;
};
const make = (client: object) =>
  new HealthCosts(client as unknown as PrismaService, new LotCostRegistry());

describe('HealthCosts', () => {
  it('reads every lot with ONE query on the acts and ONE on the ledger, `sante` without a quantity', async () => {
    const client = fake(
      [
        { id: 'x1', batchId: 'a' },
        { id: 'x2', batchId: 'a' },
        { id: 'x3', batchId: 'c' },
      ],
      [
        exit('x1', 'o1', -0.5, 13363.63),
        exit('x2', 'o2', -0.5, 13363.63),
        exit('x3', 'o3', -2, 12000),
      ],
    );
    const result = await make(client).costsFor(['a', 'b', 'c']);
    expect(client.healthAct.findMany).toHaveBeenCalledTimes(1);
    expect(client.stockMovement.findMany).toHaveBeenCalledTimes(1);
    expect([...result.keys()]).toEqual(['a', 'c']);
    // Rounded per act (6 681.82 twice), not once on the lot.
    expect(result.get('a')?.[0].amount.toString()).toBe('13363.64');
    expect(result.get('c')).toEqual([{ category: 'sante', amount: D(24000) }]);
    expect(result.get('c')?.[0]).not.toHaveProperty('quantity');
  });

  it('asks nothing for no lot, and nothing of the ledger for no done act', async () => {
    const none = fake([], []);
    expect((await make(none).costsFor([])).size).toBe(0);
    expect(none.healthAct.findMany).not.toHaveBeenCalled();
    expect((await make(none).costsFor(['a'])).size).toBe(0);
    expect(none.stockMovement.findMany).not.toHaveBeenCalled();
  });

  it("reads inside the caller's transaction when given one", async () => {
    const pool = fake([], []);
    const inTx = fake([{ id: 'x1', batchId: 'a' }], [exit('x1', 'o1', -1, 5)]);
    const result = await new HealthCosts(
      pool as unknown as PrismaService,
      new LotCostRegistry(),
    ).costsFor(['a'], undefined, inTx as unknown as Prisma.TransactionClient);
    expect(pool.healthAct.findMany).not.toHaveBeenCalled();
    expect(result.get('a')).toHaveLength(1);
  });

  it('registers itself with the lot costs', () => {
    const registry = new LotCostRegistry();
    const costs = new HealthCosts({} as PrismaService, registry);
    costs.onModuleInit();
    expect(registry.all()).toContain(costs);
  });
});
