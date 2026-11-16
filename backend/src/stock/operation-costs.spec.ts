import { Decimal } from '@prisma/client/runtime/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  exitCostsByItem,
  firstSoldLots,
  operationCost,
  operationCosts,
} from './operation-costs';

const D = (v: number | string) => new Decimal(v);
const piece = (operationId: string, quantity: number, unitCost: number) => ({
  operationId,
  quantity: D(quantity),
  unitCost: D(unitCost),
});

describe('operationCost', () => {
  it('is Σ |quantity| × unitCost of the pieces, rounded once to the cent (half up)', () => {
    expect(
      operationCost([
        piece('op', -30, 100.005),
        piece('op', -30, 100.005),
      ]).toString(),
    ).toBe('6000.3');
    expect(operationCost([piece('op', -0.5, 13363.63)]).toString()).toBe(
      '6681.82',
    );
  });
});

describe('operationCosts', () => {
  const clientWith = (rows: object[]) => ({
    stockMovement: { findMany: jest.fn().mockResolvedValue(rows) },
  });
  const row = (sourceId: string, p: ReturnType<typeof piece>) => ({
    sourceId,
    ...p,
  });

  it('rounds each operation, then sums per source, in one query', async () => {
    const client = clientWith([
      row('a', piece('op1', -0.5, 13363.63)),
      row('a', piece('op2', -0.5, 13363.63)),
      row('b', piece('op3', -30, 100.005)),
      row('b', piece('op3', -30, 100.005)),
    ]);
    const costs = await operationCosts(client as unknown as PrismaService, {
      sourceType: 'HEALTH_ACT',
      sourceIds: ['a', 'b', 'c'],
    });
    expect(client.stockMovement.findMany).toHaveBeenCalledTimes(1);
    // Exits only: a source that also writes entries (a credit note's return) is not charged for them.
    expect(client.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ quantity: { lt: 0 } }) as unknown,
      }),
    );
    expect(costs.get('a')?.toString()).toBe('13363.64');
    expect(costs.get('b')?.toString()).toBe('6000.3');
    expect(costs.has('c')).toBe(false);
  });

  it('asks nothing for no source', async () => {
    const client = clientWith([]);
    const costs = await operationCosts(client as unknown as PrismaService, {
      sourceType: 'HEALTH_ACT',
      sourceIds: [],
    });
    expect(client.stockMovement.findMany).not.toHaveBeenCalled();
    expect(costs.size).toBe(0);
  });
});

describe('exitCostsByItem', () => {
  const row = (
    stockItemId: string,
    operationId: string,
    quantity: number,
    unitCost: number,
  ) => ({
    stockItemId,
    operationId,
    quantity: D(quantity),
    unitCost: D(unitCost),
  });
  const clientWith = (rows: object[]) => ({
    stockMovement: { findMany: jest.fn().mockResolvedValue(rows) },
  });

  it('gives the quantity and the cost of each article, rounding every operation then summing, in one query on the exits of the source', async () => {
    const client = clientWith([
      // article a: one operation split over two lots (same unit cost on every piece)
      row('a', 'op1', -30, 100.005),
      row('a', 'op1', -30, 100.005),
      // article a again, a second line of the same invoice
      row('a', 'op2', -0.5, 13363.63),
      // article b
      row('b', 'op3', -100, 320),
    ]);
    const costs = await exitCostsByItem(client as unknown as PrismaService, {
      sourceType: 'SALE',
      sourceId: 'inv',
    });
    expect(client.stockMovement.findMany).toHaveBeenCalledTimes(1);
    expect(client.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceType: 'SALE',
          sourceId: 'inv',
          quantity: { lt: 0 },
        },
      }),
    );
    expect(costs.get('a')?.quantity.toString()).toBe('60.5');
    // 6000.30 + 6681.82 (each operation rounded to the cent, then summed)
    expect(costs.get('a')?.cost.toString()).toBe('12682.12');
    expect(costs.get('b')?.quantity.toString()).toBe('100');
    expect(costs.get('b')?.cost.toString()).toBe('32000');
    expect(costs.size).toBe(2);
  });

  it('is empty for a source with no exit', async () => {
    const costs = await exitCostsByItem(
      clientWith([]) as unknown as PrismaService,
      { sourceType: 'SALE', sourceId: 'none' },
    );
    expect(costs.size).toBe(0);
  });
});

describe('firstSoldLots', () => {
  const lot = (
    id: string,
    lotNumber: string,
    expiry: string | null,
    received: string,
  ) => ({
    id,
    lotNumber,
    expiryDate: expiry ? new Date(expiry) : null,
    receivedDate: new Date(received),
  });
  const client = (rows: object[]) =>
    ({
      stockMovement: { findMany: jest.fn().mockResolvedValue(rows) },
    }) as unknown as PrismaService;
  const of = {
    sourceType: 'SALE' as const,
    sourceId: 's1',
    stockItemIds: ['a', 'b'],
  };

  it('takes the lot FEFO draws first (expiry, received date, id), whatever the order the pieces come in', async () => {
    const rows = [
      { stockItemId: 'a', stockBatch: lot('l3', 'NOEXP', null, '2026-01-01') },
      {
        stockItemId: 'a',
        stockBatch: lot('l2', 'LATE', '2099-01-01', '2026-01-01'),
      },
      {
        stockItemId: 'a',
        stockBatch: lot('l1', 'SOON', '2090-01-01', '2026-05-01'),
      },
      {
        stockItemId: 'b',
        stockBatch: lot('l5', 'B2', '2090-01-01', '2026-03-01'),
      },
      {
        stockItemId: 'b',
        stockBatch: lot('l4', 'B1', '2090-01-01', '2026-02-01'),
      },
    ];
    const found = await firstSoldLots(client(rows), of);
    expect(found.get('a')?.lotNumber).toBe('SOON');
    expect(found.get('b')?.lotNumber).toBe('B1');
  });

  it('maps an article whose first piece sat in no lot to null, and leaves out an article not sold', async () => {
    const rows = [
      { stockItemId: 'a', stockBatch: null },
      {
        stockItemId: 'a',
        stockBatch: lot('l1', 'X', '2090-01-01', '2026-01-01'),
      },
    ];
    const found = await firstSoldLots(client(rows), of);
    expect(found.get('a')).toEqual({
      lotNumber: 'X',
      expiryDate: new Date('2090-01-01'),
    });
    expect(found.has('b')).toBe(false);
    expect(
      (
        await firstSoldLots(
          client([{ stockItemId: 'a', stockBatch: null }]),
          of,
        )
      ).get('a'),
    ).toBeNull();
  });
});
