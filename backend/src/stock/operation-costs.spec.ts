import { Decimal } from '@prisma/client/runtime/client';
import type { PrismaService } from '../prisma/prisma.service';
import { operationCost, operationCosts } from './operation-costs';

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
