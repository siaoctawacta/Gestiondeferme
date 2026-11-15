import { Decimal } from '@prisma/client/runtime/client';
import {
  allocateExit,
  AllocationError,
  type AllocBatch,
  type AllocRow,
} from './allocation';

const D = (v: number) => new Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

let seq = 0;
const row = (
  date: string,
  batch: string | null,
  quantity: number,
): AllocRow => {
  seq += 1;
  return {
    id: `r${seq}`,
    date: day(date),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    stockBatchId: batch,
    quantity: D(quantity),
  };
};
const batch = (
  id: string,
  expiry: string | null,
  received = '2026-01-01',
): AllocBatch => ({
  id,
  expiryDate: expiry ? day(expiry) : null,
  receivedDate: day(received),
});
const take = (p: { batchId: string | null; quantity: Decimal }[]) =>
  p.map((x) => [x.batchId, x.quantity.toNumber()]);

describe('allocateExit', () => {
  const A = batch('A', '2026-06-01');
  const B = batch('B', '2026-12-01');
  const N = batch('N', null);

  it('takes the earliest expiry first, batches without expiry last, then stock held in no batch', () => {
    const rows = [
      row('2026-01-01', 'N', 10),
      row('2026-01-01', 'B', 10),
      row('2026-01-01', 'A', 10),
      row('2026-01-01', null, 10),
    ];
    const pieces = allocateExit({
      rows,
      batches: [N, B, A],
      date: day('2026-01-10'),
      needed: D(35),
      consumption: true,
    });
    expect(take(pieces)).toEqual([
      ['A', -10],
      ['B', -10],
      ['N', -10],
      [null, -5],
    ]);
  });

  it('does not pick a lot that a later exit empties, and takes from the others (back-dated exit)', () => {
    const rows = [
      row('2026-01-01', 'A', 100),
      row('2026-01-01', 'B', 100),
      row('2026-01-11', 'A', -100),
    ];
    const pieces = allocateExit({
      rows,
      batches: [A, B],
      date: day('2026-01-10'),
      needed: D(20),
      consumption: true,
    });
    expect(take(pieces)).toEqual([['B', -20]]);
  });

  it('limits a lot to the lowest balance it reaches after the exit date', () => {
    const rows = [
      row('2026-01-01', 'A', 100),
      row('2026-01-11', 'A', -70),
      row('2026-01-12', 'A', 500),
    ];
    const pieces = allocateExit({
      rows,
      batches: [A],
      date: day('2026-01-10'),
      needed: D(30),
      consumption: true,
    });
    expect(take(pieces)).toEqual([['A', -30]]);
    expect(() =>
      allocateExit({
        rows,
        batches: [A],
        date: day('2026-01-10'),
        needed: D(31),
        consumption: true,
      }),
    ).toThrow(AllocationError);
  });

  it('skips expired lots for a consumption, and says why when nothing else is left', () => {
    const rows = [row('2026-01-01', 'A', 10), row('2026-01-01', 'B', 5)];
    const expired = batch('A', '2026-01-05');
    const kind = (needed: number) => {
      try {
        allocateExit({
          rows,
          batches: [expired, B],
          date: day('2026-01-10'),
          needed: D(needed),
          consumption: true,
        });
      } catch (e) {
        return (e as AllocationError).kind;
      }
      return 'ok';
    };
    expect(kind(5)).toBe('ok');
    expect(kind(8)).toBe('PARTLY_EXPIRED');
    expect(kind(20)).toBe('SHORT');
    const onlyExpired = () =>
      allocateExit({
        rows: [row('2026-01-01', 'A', 10)],
        batches: [expired],
        date: day('2026-01-10'),
        needed: D(1),
        consumption: true,
      });
    expect(onlyExpired).toThrow(AllocationError);
    try {
      onlyExpired();
    } catch (e) {
      expect((e as AllocationError).kind).toBe('EXPIRED');
    }
  });

  it('writes expired lots off first when the exit is not a consumption, then FEFO', () => {
    const rows = [
      row('2026-01-01', 'A', 10),
      row('2026-01-01', 'B', 10),
      row('2026-01-01', 'N', 10),
    ];
    const expired = batch('A', '2026-01-05');
    const pieces = allocateExit({
      rows,
      batches: [B, N, expired],
      date: day('2026-01-10'),
      needed: D(25),
      consumption: false,
    });
    expect(take(pieces)).toEqual([
      ['A', -10],
      ['B', -10],
      ['N', -5],
    ]);
  });

  it('takes from a named lot only, within its headroom', () => {
    const rows = [row('2026-01-01', 'A', 10), row('2026-01-01', 'B', 10)];
    expect(
      take(
        allocateExit({
          rows,
          batches: [A, B],
          date: day('2026-01-10'),
          needed: D(4),
          consumption: true,
          batchId: 'B',
        }),
      ),
    ).toEqual([['B', -4]]);
    expect(() =>
      allocateExit({
        rows,
        batches: [A, B],
        date: day('2026-01-10'),
        needed: D(11),
        consumption: true,
        batchId: 'B',
      }),
    ).toThrow(AllocationError);
  });

  it('allocates at the exit position: a lot received later the same day does not exist yet there', () => {
    const rows = [
      row('2026-01-01', null, 100),
      {
        ...row('2026-01-05', 'B', 50),
        createdAt: new Date('2026-01-05T15:00:00Z'),
      },
    ];
    const morning = new Date('2026-01-05T08:00:00Z');
    const args = {
      rows,
      batches: [B],
      date: day('2026-01-05'),
      needed: D(10),
      consumption: true,
    };
    // At the end of the day lot B is there and FEFO takes it; at the morning position it is not.
    expect(take(allocateExit(args))).toEqual([['B', -10]]);
    expect(take(allocateExit({ ...args, anchor: morning }))).toEqual([
      [null, -10],
    ]);
  });

  it('names no lot that is not yet received at the position, and keeps an explicit lot strict', () => {
    const rows = [
      row('2026-01-01', 'A', 5),
      {
        ...row('2026-01-05', 'B', 50),
        createdAt: new Date('2026-01-05T15:00:00Z'),
      },
    ];
    expect(() =>
      allocateExit({
        rows,
        batches: [A, B],
        date: day('2026-01-05'),
        needed: D(10),
        consumption: true,
        batchId: 'B',
        anchor: new Date('2026-01-05T08:00:00Z'),
      }),
    ).toThrow(AllocationError);
  });

  it('reports what is available when the stock is short', () => {
    try {
      allocateExit({
        rows: [row('2026-01-01', 'A', 10)],
        batches: [A],
        date: day('2026-01-10'),
        needed: D(50),
        consumption: true,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AllocationError);
      expect((e as AllocationError).kind).toBe('SHORT');
      expect((e as AllocationError).available.toNumber()).toBe(10);
    }
  });
});
