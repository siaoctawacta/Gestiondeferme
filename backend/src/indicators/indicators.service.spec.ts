import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import type { BatchPerformanceRegistry } from '../herd/batch-performance';
import type { BatchesService } from '../herd/batches.service';
import type { PrismaService } from '../prisma/prisma.service';
import { LotCostRegistry } from './lot-cost';
import { IndicatorsService } from './indicators.service';

// The real services pull in the Prisma client; only their shape matters here.
jest.mock('../herd/batches.service', () => ({ BatchesService: class {} }));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('IndicatorsService.batchPerformance', () => {
  const ctx = { farmIds: ['f1'] } as RequestContext;
  const day = (d: string) => new Date(`${d}T00:00:00Z`);

  function service(
    weighings: { date: Date; averageWeightG: number }[],
    costs = new LotCostRegistry(),
  ) {
    const prisma = {
      weighing: { findMany: () => Promise.resolve(weighings) },
    } as unknown as PrismaService;
    const batches = {
      get: () =>
        Promise.resolve({
          ageDays: 10,
          alive: 100,
          deaths: 0,
          mortalityRate: 0,
        }),
    } as unknown as BatchesService;
    return new IndicatorsService(
      prisma,
      batches,
      costs,
      {} as BatchPerformanceRegistry,
    );
  }

  it('has no daily gain for two weighings on the same date', async () => {
    const p = await service([
      { date: day('2026-11-01'), averageWeightG: 500 },
      { date: day('2026-11-01'), averageWeightG: 520 },
    ]).batchPerformance(ctx, 'b1');
    expect(p).toMatchObject({
      firstWeightG: 500,
      lastWeightG: 520,
      dailyGainG: null,
      feedConversion: null,
    });
  });

  it('takes feedKg and feedCost from the aliment category of the lot costs', async () => {
    const costs = new LotCostRegistry();
    costs.register({
      costsFor: (ids) =>
        Promise.resolve(
          new Map([
            [
              ids[0],
              [
                {
                  category: 'aliment',
                  amount: new Decimal(300),
                  quantity: 100,
                },
                { category: 'aliment', amount: new Decimal(50), quantity: 20 },
                { category: 'sante', amount: new Decimal(999), quantity: 5 },
              ],
            ],
          ]),
        ),
    });
    const p = await service(
      [
        { date: day('2026-11-01'), averageWeightG: 500 },
        { date: day('2026-11-11'), averageWeightG: 1500 },
      ],
      costs,
    ).batchPerformance(ctx, 'b1');
    expect(p).toMatchObject({ feedKg: 120, feedCost: 350 });
    expect(p.feedConversion).toBe(1.2);
  });

  it('reports no feed when no source knows the lot', async () => {
    const p = await service([]).batchPerformance(ctx, 'b1');
    expect(p).toMatchObject({ feedKg: 0, feedCost: 0, feedConversion: null });
  });

  it('has no daily gain with a single weighing', async () => {
    const p = await service([
      { date: day('2026-11-01'), averageWeightG: 500 },
    ]).batchPerformance(ctx, 'b1');
    expect(p.dailyGainG).toBeNull();
  });
});
