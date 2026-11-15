import { BadRequestException, ConflictException } from '@nestjs/common';
import { migrateTestDb, resetDb } from './setup';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  assertLedgerValid,
  HerdLedgerService,
} from '../src/herd/herd-ledger.service';
import { OccupationRegistry } from '../src/herd/occupation';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('assertLedgerValid', () => {
  const ev = (
    date: string,
    type: 'MORTALITE' | 'ENTREE',
    quantity: number,
  ) => ({
    date: day(date),
    createdAt: day(date),
    type,
    quantity,
  });

  it('accepts a history that never dips below zero', () => {
    expect(() =>
      assertLedgerValid(10, day('2026-01-01'), [
        ev('2026-01-02', 'MORTALITE', 10),
        ev('2026-01-03', 'ENTREE', 5),
      ]),
    ).not.toThrow();
  });

  it('rejects a dip even when a later entry brings the final balance back above zero', () => {
    expect(() =>
      assertLedgerValid(10, day('2026-01-01'), [
        ev('2026-01-02', 'MORTALITE', 11),
        ev('2026-01-03', 'ENTREE', 50),
      ]),
    ).toThrow(new BadRequestException('Effectif insuffisant'));
  });

  it('rejects an event dated before the entry date', () => {
    expect(() =>
      assertLedgerValid(10, day('2026-01-05'), [ev('2026-01-04', 'ENTREE', 1)]),
    ).toThrow("La date est antérieure à l'entrée du lot");
  });
});

describe('HerdLedgerService (test database)', () => {
  let prisma: PrismaService;
  let ledger: HerdLedgerService;
  let farmId: string;
  let otherFarmId: string;
  let buildingId: string;
  let userId: string;
  let seq = 0;

  beforeAll(() => {
    migrateTestDb();
    prisma = new PrismaService();
    ledger = new HerdLedgerService(
      prisma,
      new OccupationRegistry(),
      new AuditService(prisma),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: 'Org' } });
    farmId = (
      await prisma.farm.create({ data: { organizationId: org.id, name: 'F1' } })
    ).id;
    otherFarmId = (
      await prisma.farm.create({ data: { organizationId: org.id, name: 'F2' } })
    ).id;
    const site = await prisma.site.create({ data: { farmId, name: 'S' } });
    buildingId = (
      await prisma.building.create({
        data: {
          farmId,
          siteId: site.id,
          name: 'B1',
          type: 'AVICOLE',
          capacity: 10000,
        },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          organizationId: org.id,
          email: 'u@test.local',
          name: 'U',
          passwordHash: 'x',
          role: 'DIRECTEUR_FERME',
        },
      })
    ).id;
  });

  async function batch(
    over: Partial<{
      initialCount: number;
      entryDate: string;
      status: 'EN_COURS' | 'CLOTURE';
      buildingId: string;
    }> = {},
  ) {
    seq += 1;
    return prisma.animalBatch.create({
      data: {
        farmId,
        code: `LC-2026-${seq}`,
        species: 'AVICOLE',
        type: 'CHAIR',
        buildingId: over.buildingId ?? buildingId,
        entryDate: day(over.entryDate ?? '2026-10-01'),
        initialCount: over.initialCount ?? 5000,
        status: over.status ?? 'EN_COURS',
      },
    });
  }

  const record = (
    batchId: string,
    date: string,
    type: 'MORTALITE' | 'VENTE' | 'ENTREE' | 'NAISSANCE' | 'REFORME',
    quantity: number,
  ) =>
    prisma.$transaction((tx) =>
      ledger.record(tx, {
        farmId,
        batchId,
        date: day(date),
        type,
        quantity,
        userId,
      }),
    );

  it('derives alive and deaths from the events: 5000 − 100 − 80 = 4820', async () => {
    const b = await batch();
    await record(b.id, '2026-10-05', 'MORTALITE', 100);
    await record(b.id, '2026-10-06', 'MORTALITE', 80);
    expect((await ledger.liveCounts([b.id])).get(b.id)).toBe(4820);
    expect((await ledger.deaths([b.id])).get(b.id)).toBe(180);
  });

  it('counts only what happened up to a given date', async () => {
    const b = await batch();
    await record(b.id, '2026-10-05', 'MORTALITE', 100);
    await record(b.id, '2026-10-10', 'MORTALITE', 80);
    expect((await ledger.liveCounts([b.id], day('2026-10-07'))).get(b.id)).toBe(
      4900,
    );
    expect((await ledger.liveCounts([b.id], day('2026-09-30'))).get(b.id)).toBe(
      0,
    );
  });

  it('refuses a death of 5000 on day 3 after 180 deaths on days 1-2', async () => {
    const b = await batch();
    await record(b.id, '2026-10-02', 'MORTALITE', 100);
    await record(b.id, '2026-10-03', 'MORTALITE', 80);
    await expect(record(b.id, '2026-10-04', 'MORTALITE', 5000)).rejects.toThrow(
      new BadRequestException('Effectif insuffisant'),
    );
    expect((await ledger.liveCounts([b.id])).get(b.id)).toBe(4820);
  });

  it('refuses a back-dated event that would make a later date negative', async () => {
    const b = await batch({ initialCount: 100 });
    await record(b.id, '2026-10-10', 'MORTALITE', 60);
    await expect(record(b.id, '2026-10-05', 'VENTE', 50)).rejects.toThrow(
      'Effectif insuffisant',
    );
  });

  it('refuses to delete the entry event a later sale depends on', async () => {
    const b = await batch({ initialCount: 100 });
    const entry = await record(b.id, '2026-10-02', 'ENTREE', 50);
    await record(b.id, '2026-10-03', 'VENTE', 120);
    await expect(
      prisma.$transaction((tx) => ledger.remove(tx, entry.id)),
    ).rejects.toThrow(new BadRequestException('Effectif insuffisant'));
    expect(await prisma.batchEvent.count({ where: { batchId: b.id } })).toBe(2);
  });

  it('refuses an update that breaks the history, and accepts one that keeps it valid', async () => {
    const b = await batch({ initialCount: 100 });
    const death = await record(b.id, '2026-10-02', 'MORTALITE', 40);
    await record(b.id, '2026-10-03', 'VENTE', 50);
    await expect(
      prisma.$transaction((tx) =>
        ledger.update(tx, death.id, { quantity: 60 }),
      ),
    ).rejects.toThrow('Effectif insuffisant');
    const { after } = await prisma.$transaction((tx) =>
      ledger.update(tx, death.id, { quantity: 50 }),
    );
    expect(after.quantity).toBe(50);
  });

  it('refuses an event dated before the batch entered', async () => {
    const b = await batch({ entryDate: '2026-10-10' });
    await expect(record(b.id, '2026-10-09', 'MORTALITE', 1)).rejects.toThrow(
      "La date est antérieure à l'entrée du lot",
    );
  });

  it('refuses a future-dated event', async () => {
    const b = await batch();
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expect(record(b.id, tomorrow, 'MORTALITE', 1)).rejects.toThrow(
      'La date ne peut pas être dans le futur',
    );
  });

  it('refuses events on a closed batch with a 409', async () => {
    const b = await batch({ status: 'CLOTURE' });
    await expect(record(b.id, '2026-10-05', 'MORTALITE', 1)).rejects.toThrow(
      new ConflictException('Ce lot est clôturé'),
    );
  });

  it("treats another farm's batch as not found", async () => {
    const b = await batch();
    await expect(
      prisma.$transaction((tx) =>
        ledger.record(tx, {
          farmId: otherFarmId,
          batchId: b.id,
          date: day('2026-10-05'),
          type: 'MORTALITE',
          quantity: 1,
          userId,
        }),
      ),
    ).rejects.toThrow('Lot introuvable');
  });

  it('lets exactly one of two parallel records through when together they exceed the live count', async () => {
    const b = await batch({ initialCount: 100 });
    const results = await Promise.allSettled([
      record(b.id, '2026-10-05', 'MORTALITE', 60),
      record(b.id, '2026-10-05', 'MORTALITE', 60),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      BadRequestException,
    );
    expect((await ledger.liveCounts([b.id])).get(b.id)).toBe(40);
  });

  it('sums the live count of two lots per building and ignores a closed one', async () => {
    const a = await batch({ initialCount: 1000 });
    const c = await batch({ initialCount: 500 });
    await batch({ initialCount: 700, status: 'CLOTURE' });
    await record(a.id, '2026-10-05', 'MORTALITE', 100);
    const occupation = await ledger.occupationByBuilding(
      [farmId],
      [buildingId],
    );
    expect(occupation.get(buildingId)).toBe(900 + c.initialCount);
  });

  it('moves a whole lot to another building and refuses a partial transfer', async () => {
    const site = await prisma.site.findFirstOrThrow({ where: { farmId } });
    const target = await prisma.building.create({
      data: {
        farmId,
        siteId: site.id,
        name: 'B2',
        type: 'AVICOLE',
        capacity: 10000,
      },
    });
    const b = await batch({ initialCount: 100 });
    await record(b.id, '2026-10-05', 'MORTALITE', 10);
    const transfer = (quantity: number) =>
      prisma.$transaction((tx) =>
        ledger.transfer(tx, {
          farmId,
          fromBatchId: b.id,
          toBuildingId: target.id,
          date: day('2026-10-06'),
          quantity,
          userId,
        }),
      );
    await expect(transfer(50)).rejects.toThrow(
      'Transfert partiel non pris en charge : créez un nouveau lot',
    );
    await expect(transfer(200)).rejects.toThrow('Effectif insuffisant');
    await transfer(90);
    expect(
      (await prisma.animalBatch.findUniqueOrThrow({ where: { id: b.id } }))
        .buildingId,
    ).toBe(target.id);
    expect(
      (
        await ledger.occupationByBuilding([farmId], [buildingId, target.id])
      ).get(target.id),
    ).toBe(90);
  });

  it('removes every event of a source together, replay-checked, and nothing when the history breaks', async () => {
    const a = await batch({ initialCount: 100 });
    const b = await batch({ initialCount: 100 });
    const from = (id: string, sourceId: string) =>
      prisma.$transaction((tx) =>
        ledger.record(tx, {
          farmId,
          batchId: id,
          date: day('2026-10-05'),
          type: 'VENTE',
          quantity: 10,
          sourceType: 'SALE',
          sourceId,
          userId,
        }),
      );
    await from(a.id, 'sale-1');
    await from(b.id, 'sale-1');
    await from(b.id, 'sale-2');
    const removed = await prisma.$transaction((tx) =>
      ledger.removeBySource(tx, 'SALE', 'sale-1', [farmId]),
    );
    expect(removed).toHaveLength(2);
    expect((await ledger.liveCounts([a.id, b.id])).get(a.id)).toBe(100);
    expect((await ledger.liveCounts([a.id, b.id])).get(b.id)).toBe(90);

    // A reversal that would leave a later sale without animals is refused whole.
    const c = await batch({ initialCount: 10 });
    await prisma.$transaction((tx) =>
      ledger.record(tx, {
        farmId,
        batchId: c.id,
        date: day('2026-10-02'),
        type: 'ENTREE',
        quantity: 5,
        sourceType: 'PURCHASE',
        sourceId: 'p1',
        userId,
      }),
    );
    await record(c.id, '2026-10-03', 'VENTE', 15);
    await expect(
      prisma.$transaction((tx) =>
        ledger.removeBySource(tx, 'PURCHASE', 'p1', [farmId]),
      ),
    ).rejects.toThrow(new BadRequestException('Effectif insuffisant'));
    expect(await prisma.batchEvent.count({ where: { batchId: c.id } })).toBe(2);
  });

  it('removeBySource does not see another farm events', async () => {
    const a = await batch();
    await prisma.$transaction((tx) =>
      ledger.record(tx, {
        farmId,
        batchId: a.id,
        date: day('2026-10-05'),
        type: 'VENTE',
        quantity: 1,
        sourceType: 'SALE',
        sourceId: 's',
        userId,
      }),
    );
    const removed = await prisma.$transaction((tx) =>
      ledger.removeBySource(tx, 'SALE', 's', [otherFarmId]),
    );
    expect(removed).toEqual([]);
    expect(await prisma.batchEvent.count()).toBe(1);
  });

  it('lockBatches takes the row locks in ascending id order: [A,B] and [B,A] do not deadlock', async () => {
    const a = await batch();
    const b = await batch();
    const slow = (
      tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    ) =>
      new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === '$queryRaw') {
            return async (...args: unknown[]) => {
              const result = await (
                target.$queryRaw as (...a: unknown[]) => Promise<unknown>
              )(...args);
              await target.$executeRaw`SELECT pg_sleep(0.05)`;
              return result;
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });
    const lock = (ids: string[]) =>
      prisma.$transaction((tx) => ledger.lockBatches(slow(tx), ids, [farmId]));
    const results = await Promise.allSettled([
      lock([a.id, b.id]),
      lock([b.id, a.id]),
      lock([a.id, b.id]),
      lock([b.id, a.id]),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
    const rows = await lock([b.id, a.id]);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id].sort());
    await expect(lock([a.id, 'missing'])).rejects.toThrow('Lot introuvable');
  });
});
