import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import {
  assertBucketsNonNegative,
  InsufficientStock,
  replay,
  type ReplayMovement,
} from './valuation';

const D = (v: number | string) => new Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

let seq = 0;
function mv(
  date: string,
  type: ReplayMovement['type'],
  quantity: number,
  unitCost: number | null = null,
): ReplayMovement {
  seq += 1;
  return {
    id: `m${seq}`,
    date: day(date),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    type,
    quantity: D(quantity),
    unitCost: unitCost === null ? null : D(unitCost),
  };
}

describe('replay', () => {
  it('averages entries: 1000 @ 300 then 500 @ 360 is 1500 @ 320, worth 480 000', () => {
    const r = replay([
      mv('2026-01-01', 'ENTREE', 1000, 300),
      mv('2026-01-02', 'ENTREE', 500, 360),
    ]);
    expect(r.quantity.toNumber()).toBe(1500);
    expect(r.averageCost.toNumber()).toBe(320);
    expect(r.quantity.mul(r.averageCost).toNumber()).toBe(480000);
  });

  it('values an exit at the running average and leaves the average alone', () => {
    const exit = mv('2026-01-03', 'SORTIE', -600);
    const r = replay([
      mv('2026-01-01', 'ENTREE', 1000, 300),
      mv('2026-01-02', 'ENTREE', 500, 360),
      exit,
    ]);
    const priced = r.timeline.find((t) => t.movement === exit)!;
    expect(priced.unitCost.toNumber()).toBe(320);
    expect(priced.unitCost.mul(600).toNumber()).toBe(192000);
    expect(r.quantity.toNumber()).toBe(900);
    expect(r.averageCost.toNumber()).toBe(320);
  });

  it('rejects a history where the quantity dips below zero', () => {
    expect(() =>
      replay([
        mv('2026-01-01', 'ENTREE', 1000, 300),
        mv('2026-01-02', 'ENTREE', 500, 360),
        mv('2026-01-03', 'SORTIE', -1600),
      ]),
    ).toThrow(InsufficientStock);
  });

  it('rejects a dip even when a later entry brings the final quantity back up', () => {
    expect(() =>
      replay([
        mv('2026-01-01', 'ENTREE', 100, 10),
        mv('2026-01-02', 'SORTIE', -150),
        mv('2026-01-03', 'ENTREE', 500, 10),
      ]),
    ).toThrow(new BadRequestException('Stock insuffisant'));
  });

  it('rejects the history left when the first entry is removed under later exits', () => {
    const first = mv('2026-01-01', 'ENTREE', 1000, 300);
    const history = [
      first,
      mv('2026-01-02', 'ENTREE', 500, 360),
      mv('2026-01-03', 'SORTIE', -1200),
    ];
    expect(() => replay(history)).not.toThrow();
    expect(() => replay(history.filter((m) => m !== first))).toThrow(
      InsufficientStock,
    );
  });

  it('values a negative adjustment at the average', () => {
    const adj = mv('2026-01-03', 'AJUSTEMENT', -50);
    const r = replay([mv('2026-01-01', 'ENTREE', 100, 200), adj]);
    expect(
      r.timeline.find((t) => t.movement === adj)!.unitCost.toNumber(),
    ).toBe(200);
    expect(r.quantity.toNumber()).toBe(50);
  });

  it('values a positive adjustment without a cost at the average, or 0 with no history', () => {
    const first = mv('2026-01-01', 'AJUSTEMENT', 10);
    const second = mv('2026-01-02', 'ENTREE', 10, 100);
    const third = mv('2026-01-03', 'AJUSTEMENT', 20);
    const r = replay([first, second, third]);
    const cost = (m: ReplayMovement) =>
      r.timeline.find((t) => t.movement === m)!.unitCost.toNumber();
    expect(cost(first)).toBe(0);
    expect(cost(third)).toBe(50);
    expect(r.averageCost.toNumber()).toBe(50);
  });

  it('keeps a cost given on a positive adjustment', () => {
    const r = replay([
      mv('2026-01-01', 'ENTREE', 10, 100),
      mv('2026-01-02', 'AJUSTEMENT', 10, 200),
    ]);
    expect(r.averageCost.toNumber()).toBe(150);
  });

  it('restarts the average from the new entry once the quantity reached zero', () => {
    const r = replay([
      mv('2026-01-01', 'ENTREE', 100, 300),
      mv('2026-01-02', 'SORTIE', -100),
      mv('2026-01-03', 'ENTREE', 50, 400),
    ]);
    expect(r.quantity.toNumber()).toBe(50);
    expect(r.averageCost.toNumber()).toBe(400);
  });

  it('orders by date, then creation time, whatever the input order', () => {
    const entry = mv('2026-01-02', 'ENTREE', 10, 100);
    const exit = mv('2026-01-02', 'SORTIE', -10);
    expect(() => replay([exit, entry])).not.toThrow();
    const late = mv('2026-01-05', 'ENTREE', 10, 100);
    const early = mv('2026-01-01', 'SORTIE', -5);
    expect(() => replay([late, early])).toThrow(InsufficientStock);
  });

  it('keeps full precision in the average and exposes the quantity after each step', () => {
    const r = replay([
      mv('2026-01-01', 'ENTREE', 1, 100),
      mv('2026-01-02', 'ENTREE', 2, 100.01),
    ]);
    expect(r.averageCost.toDecimalPlaces(4).toNumber()).toBe(100.0067);
    expect(r.timeline.map((t) => t.quantityAfter.toNumber())).toEqual([1, 3]);
  });
});

describe('replay on a read (strict: false)', () => {
  it('never throws on a damaged history: it reports what the movements add up to', () => {
    const damaged = [
      mv('2026-01-01', 'ENTREE', 10, 5),
      mv('2026-01-02', 'SORTIE', -15),
      mv('2026-01-03', 'ENTREE', 5, 8),
    ];
    expect(() => replay(damaged)).toThrow(InsufficientStock);
    const r = replay(damaged, { strict: false });
    expect(r.quantity.toNumber()).toBe(0);
    expect(r.averageCost.isFinite()).toBe(true);
  });
});

describe('assertBucketsNonNegative', () => {
  const batched = (
    date: string,
    quantity: number,
    stockBatchId: string | null,
  ) => ({
    ...mv(date, quantity > 0 ? 'ENTREE' : 'SORTIE', quantity, 1),
    stockBatchId,
  });

  it('accepts exits covered by their own batch', () => {
    expect(() =>
      assertBucketsNonNegative(
        [
          batched('2026-01-01', 10, 'A'),
          batched('2026-01-02', -10, 'A'),
          batched('2026-01-02', 5, null),
          batched('2026-01-03', -5, null),
        ],
        'Maïs',
      ),
    ).not.toThrow();
  });

  it('rejects a batch taken below zero even when the item has stock elsewhere', () => {
    expect(() =>
      assertBucketsNonNegative(
        [
          batched('2026-01-01', 10, 'A'),
          batched('2026-01-01', 100, 'B'),
          batched('2026-01-02', -11, 'A'),
        ],
        'Maïs',
      ),
    ).toThrow(new InsufficientStock('Maïs'));
  });

  it('names the article in the refusal', () => {
    expect(() =>
      assertBucketsNonNegative([batched('2026-01-02', -1, 'A')], 'Maïs'),
    ).toThrow('Stock insuffisant pour Maïs');
  });
});
