import { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthCosts } from './health-costs';

// The real service pulls in the Prisma client; only the query count matters here.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const fake = (rows: { batchId: string; amount: Decimal }[]) => {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  return { queryRaw, client: { $queryRaw: queryRaw } };
};

describe('HealthCosts', () => {
  it('reads every lot in ONE query and reports `sante` without a quantity', async () => {
    const { queryRaw, client } = fake([
      { batchId: 'a', amount: new Decimal('24000') },
      { batchId: 'c', amount: new Decimal('26727.27') },
    ]);
    const costs = new HealthCosts(client as unknown as PrismaService);
    const result = await costs.costsFor(['a', 'b', 'c']);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect([...result.keys()]).toEqual(['a', 'c']);
    expect(result.get('a')).toEqual([
      { category: 'sante', amount: new Decimal('24000') },
    ]);
    expect(result.get('c')?.[0].amount.toString()).toBe('26727.27');
    expect(result.get('c')?.[0]).not.toHaveProperty('quantity');
  });

  it('asks nothing for no lot', async () => {
    const { queryRaw, client } = fake([]);
    const result = await new HealthCosts(
      client as unknown as PrismaService,
    ).costsFor([]);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("reads inside the caller's transaction when given one", async () => {
    const pool = fake([]);
    const inTx = fake([{ batchId: 'a', amount: new Decimal(5) }]);
    const result = await new HealthCosts(
      pool.client as unknown as PrismaService,
    ).costsFor(
      ['a'],
      undefined,
      inTx.client as unknown as Prisma.TransactionClient,
    );
    expect(pool.queryRaw).not.toHaveBeenCalled();
    expect(inTx.queryRaw).toHaveBeenCalledTimes(1);
    expect(result.get('a')).toHaveLength(1);
  });
});
